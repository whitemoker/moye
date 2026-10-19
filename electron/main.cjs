const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const { pathToFileURL } = require('node:url');
const { hash, readDocument, saveDocument, atomicWrite, isInside, listMarkdown, copyRelativeImages } = require('./storage.cjs');
const { readComments, readCommentFile, saveBundle, recoverBundle, sidecarPath, journalPath } = require('./comments.cjs');
const { suggestedSavePath } = require('./save-name.cjs');
const { registerWindowsIntegration } = require('./windows-integration.cjs');

if (process.env.MOYE_USER_DATA) app.setPath('userData', process.env.MOYE_USER_DATA);
app.setName('Moye');
protocol.registerSchemesAsPrivileged([{ scheme: 'moye-image', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win, watcher, watchedFile, closeApproved = false, prefs = {}, writeQueue = Promise.resolve();
const grants = new Set(), roots = new Set();
const dataPath = name => path.join(app.getPath('userData'), name);
const registerWindows = () => registerWindowsIntegration({ executablePath: process.execPath, iconPath: app.isPackaged ? path.join(process.resourcesPath, 'document.ico') : path.join(__dirname, '../assets/document.ico'), appData: app.getPath('appData') });
const send = (name, data) => { if (win && !win.isDestroyed()) win.webContents.send(`moye:${name}`, data); };
const serialized = action => { const next = writeQueue.then(action); writeQueue = next.catch(() => {}); return next; };
const allowed = p => typeof p === 'string' && (grants.has(path.resolve(p)) || [...roots].some(root => isInside(root, p)));
const assertPath = p => { if (!allowed(p)) throw new Error('请先通过打开文件或文件夹选择此路径。'); return path.resolve(p); };
const remember = async p => { prefs.recent = [p, ...(prefs.recent || []).filter(x => x !== p)].slice(0, 15); await atomicWrite(dataPath('settings.json'), JSON.stringify(prefs)); };
async function openDocument(p) {
  const doc = await readDocument(p);
  grants.add(path.resolve(p)); roots.add(path.dirname(path.resolve(p)));
  let recoveryWarning;
  try { await recoverBundle(p, app.getPath('userData')); } catch (error) { recoveryWarning = error.message; }
  const comments = await readComments(p);
  const commentDraft = await readJSON(inputName(p), undefined);
  await remember(p); monitor(p); return { ...doc, ...comments, ...(recoveryWarning ? { commentsError: recoveryWarning } : {}), commentDraft };
}
function monitor(p) {
  watcher?.close(); watchedFile = p;
  let timer;
  try { watcher = watch(path.dirname(p), (_, filename) => {
    if (filename && ![path.basename(p), path.basename(sidecarPath(p))].includes(filename.toString())) return;
    clearTimeout(timer); timer = setTimeout(async () => {
      try { const comments = await readComments(p); send('externalChange', { path: p, hash: hash(await fs.readFile(p)), commentsHash: comments.commentsError ? 'invalid' : comments.commentsHash }); }
      catch (e) { if (e.code === 'ENOENT') send('externalChange', { path: p, hash: null }); }
    }, 250);
  }); watcher.on('error', () => {}); } catch { /* Save still checks the file hash. */ }
}
const inputName = p => `comment-input-${hash(p || 'untitled')}.json`;
async function readJSON(name, fallback) { try { return JSON.parse(await fs.readFile(dataPath(name), 'utf8')); } catch { return fallback; } }
function handle(name, fn) { ipcMain.handle(`moye:${name}`, async (event, ...args) => {
  if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unknown sender');
  return fn(...args);
}); }

handle('init', async () => ({ settings: prefs, recovery: await readJSON('draft.json', null), recent: prefs.recent || [], initialPath: process.argv.slice(app.isPackaged ? 1 : 2).find(arg => /\.(md|markdown|mdown|txt)$/i.test(arg) && !arg.startsWith('-')) || null }));
handle('open', async () => {
  const result = await dialog.showOpenDialog(win, { title: '打开 Markdown', filters: [{ name: 'Markdown / 文本', extensions: ['md', 'markdown', 'mdown', 'txt'] }], properties: ['openFile'] });
  return result.canceled ? null : openDocument(result.filePaths[0]);
});
handle('openPath', async p => {
  if (!allowed(p) && !(prefs.recent || []).includes(p) && !process.argv.includes(p)) throw new Error('请通过文件对话框打开此文件。');
  return openDocument(p);
});
handle('folder', async () => {
  const result = await dialog.showOpenDialog(win, { title: '打开写作文件夹', properties: ['openDirectory'] });
  if (result.canceled) return null;
  const root = result.filePaths[0]; roots.add(root); prefs.folder = root;
  await atomicWrite(dataPath('settings.json'), JSON.stringify(prefs));
  return { path: root, items: await listMarkdown(root) };
});
handle('openDropped', p => {
  if (typeof p !== 'string' || !/\.(md|markdown|mdown|txt)$/i.test(p)) throw new Error('请拖入 Markdown 或文本文件。');
  return openDocument(p);
});
handle('tree', async p => ({ path: assertPath(p), items: await listMarkdown(p) }));
handle('save', request => serialized(async () => {
  if (typeof request.content !== 'string' || request.content.length > 25 * 1024 * 1024) throw new Error('文档内容无效或过大。');
  let target = request.path, expectedHash = request.hash;
  if (!target || request.saveAs) {
    const defaultPath = await suggestedSavePath(request.content, prefs.folder || prefs.lastSaveDirectory || app.getPath('documents'), target);
    const result = await dialog.showSaveDialog(win, { title: '保存 Markdown', defaultPath, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled) return null;
    target = result.filePath; grants.add(path.resolve(target)); roots.add(path.dirname(path.resolve(target)));
    try { expectedHash = hash(await fs.readFile(target)); } catch (e) { if (e.code !== 'ENOENT') throw e; expectedHash = null; }
  } else assertPath(target);
  if (request.path && request.path !== target && request.saveAs) {
    assertPath(request.path);
    await copyRelativeImages(request.path, target, request.imageSources);
  }
  const newDocument = target !== request.path;
  const result = await saveBundle({ ...request, path: target, hash: expectedHash, commentsHash: newDocument ? null : request.commentsHash, newDocument }, app.getPath('userData'));
  if (!result.conflict) { prefs.lastSaveDirectory = path.dirname(target); await remember(target); if (watchedFile !== target) monitor(target); }
  return result;
}));
handle('draft', draft => serialized(async () => {
  if (!draft || typeof draft.content !== 'string') throw new Error('无效草稿');
  await atomicWrite(dataPath('draft.json'), JSON.stringify({ ...draft, updatedAt: Date.now() }));
  return true;
}));
handle('commentDraft', request => serialized(async () => {
  if (request.path) assertPath(request.path);
  const value = JSON.stringify(request.draft);
  if (value.length > 1024 * 1024) throw new Error('评论草稿超过 1 MB');
  await atomicWrite(dataPath(inputName(request.path)), value);
}));
handle('discardRecovery', p => serialized(() => fs.rm(journalPath(app.getPath('userData'), assertPath(p)), { force: true })));
handle('importComments', async documentPath => {
  assertPath(documentPath);
  const result = await dialog.showOpenDialog(win, { title: '导入评论配套文件', filters: [{ name: '墨页评论', extensions: ['json'] }], properties: ['openFile'] });
  if (result.canceled) return null;
  return (await readCommentFile(result.filePaths[0])).comments;
});
handle('clearDraft', () => serialized(() => fs.rm(dataPath('draft.json'), { force: true })));
handle('settings', delta => serialized(async () => {
  for (const key of ['theme', 'fontSize', 'width', 'autoSave', 'sidebar', 'focus', 'typewriter', 'serif', 'commentsOpen', 'commentsWidth', 'commentAuthor', 'commentAuthorId']) if (key in delta) prefs[key] = delta[key];
  await atomicWrite(dataPath('settings.json'), JSON.stringify(prefs)); return prefs;
}));
handle('windowsIntegration', () => serialized(async () => {
  const result = await registerWindows();
  prefs.windowsIntegration = true; await atomicWrite(dataPath('settings.json'), JSON.stringify(prefs));
  return result;
}));
handle('image', async ({ documentPath, name, bytes }) => {
  assertPath(documentPath);
  if (!Array.isArray(bytes) || bytes.length > 20 * 1024 * 1024) throw new Error('图片不能超过 20 MB');
  const ext = path.extname(name).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp'].includes(ext)) throw new Error('不支持此图片格式');
  const buffer = Buffer.from(bytes);
  const relative = `${path.basename(documentPath, path.extname(documentPath))}.assets/${hash(buffer).slice(0, 16)}${ext}`;
  await atomicWrite(path.join(path.dirname(documentPath), relative), buffer);
  return relative.split('/').map(encodeURIComponent).join('/');
});
handle('imageUrl', async ({ src, documentPath }) => {
  if (/^(https?:|data:|blob:|moye-image:)/i.test(src)) return src;
  if (!documentPath) return src;
  assertPath(documentPath);
  let decoded; try { decoded = decodeURIComponent(src); } catch { decoded = src; }
  const resolved = path.resolve(path.dirname(documentPath), decoded);
  if (!/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(resolved)) return '';
  grants.add(resolved);
  return `moye-image://local/image?path=${encodeURIComponent(resolved)}`;
});
handle('reveal', p => { shell.showItemInFolder(assertPath(p)); });
handle('imageData', async ({ src, documentPath }) => {
  if (!documentPath) throw new Error('请先保存文稿，再导出本地图片。');
  assertPath(documentPath);
  let decoded; try { decoded = decodeURIComponent(src); } catch { decoded = src; }
  const p = path.resolve(path.dirname(documentPath), decoded);
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp' }[path.extname(p).toLowerCase()];
  if (!mime) throw new Error('无法导出不支持的图片类型');
  const bytes = await fs.readFile(p); if (bytes.length > 20 * 1024 * 1024) throw new Error('图片超过 20 MB');
  return `data:${mime};base64,${bytes.toString('base64')}`;
});
handle('external', url => { if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return shell.openExternal(url); });
handle('export', async ({ kind, html, title }) => {
  if (!['pdf', 'html'].includes(kind) || typeof html !== 'string') throw new Error('无效导出请求');
  const result = await dialog.showSaveDialog(win, { title: `导出 ${kind.toUpperCase()}`, defaultPath: `${title || '未命名'}.${kind}`, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] });
  if (result.canceled) return null;
  if (kind === 'html') await atomicWrite(result.filePath, html);
  else {
    const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
    try {
      await printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const bytes = await printer.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } });
      await atomicWrite(result.filePath, bytes);
    } finally { printer.destroy(); }
  }
  return result.filePath;
});
handle('window', command => {
  if (command === 'minimize') win.minimize();
  else if (command === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (command === 'close') win.close();
  else if (command === 'close-approved') { closeApproved = true; win.close(); }
  else if (command === 'fullscreen') win.setFullScreen(!win.isFullScreen());
});

if (process.argv.includes('--register-windows')) {
  app.whenReady().then(registerWindows).then(async result => {
    const settings = await readJSON('settings.json', {});
    await atomicWrite(dataPath('settings.json'), JSON.stringify({ ...settings, windowsIntegration: true }));
    await atomicWrite(dataPath('windows-integration.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result)); app.quit();
  }).catch(error => { console.error(error); app.exit(1); });
} else if (!(process.env.MOYE_TEST || app.requestSingleInstanceLock())) app.quit();
else {
  app.on('second-instance', (_, argv) => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); const p = argv.find(a => /\.(md|markdown)$/i.test(a)); if (p) { grants.add(path.resolve(p)); send('open-request', p); } } });
  app.whenReady().then(async () => {
    prefs = await readJSON('settings.json', {});
    if (prefs.windowsIntegration && app.isPackaged && !process.env.MOYE_TEST) await registerWindows().catch(error => console.error('Windows integration:', error.message));
    if (prefs.folder) roots.add(prefs.folder);
    const draft = await readJSON('draft.json', null);
    if (draft?.path) { grants.add(path.resolve(draft.path)); roots.add(path.dirname(path.resolve(draft.path))); }
    protocol.handle('moye-image', request => {
      const params = new URL(request.url).searchParams;
      let p = params.get('path');
      if (params.has('document')) {
        const doc = params.get('document'), src = params.get('src');
        if (!allowed(doc) || !src) return new Response('', { status: 403 });
        let decoded; try { decoded = decodeURIComponent(src); } catch { decoded = src; }
        p = path.resolve(path.dirname(doc), decoded);
      } else if (!allowed(p)) return new Response('', { status: 403 });
      if (!p || !/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(p)) return new Response('', { status: 403 });
      return net.fetch(pathToFileURL(p).href);
    });
    Menu.setApplicationMenu(null);
    win = new BrowserWindow({ width: 1240, height: 860, minWidth: 760, minHeight: 500, show: !process.env.MOYE_TEST, title: '墨页', icon: path.join(__dirname, '../assets/icon.png'), backgroundColor: '#ffffff', titleBarStyle: 'hidden', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } });
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('close', event => { if (!closeApproved) { event.preventDefault(); send('command', 'close'); } });
    if (process.env.MOYE_DEV_URL) await win.loadURL(process.env.MOYE_DEV_URL); else await win.loadFile(path.join(__dirname, '../dist/index.html'));
  });
}
app.on('window-all-closed', () => { watcher?.close(); app.quit(); });
