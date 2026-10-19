const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');

const hash = (content) => crypto.createHash('sha256').update(content).digest('hex');
async function readDocument(filePath) {
  const bytes = await fs.readFile(filePath);
  if (bytes.length > 20 * 1024 * 1024) throw new Error('文件超过 20 MB，第一版暂不支持。');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('无法读取为 UTF-8 文本：可能是其他编码，或文件受本机文档加密策略保护。原文件未改动。'); }
  if (content.includes('\0')) throw new Error('此文件包含二进制数据，无法作为 Markdown 打开。');
  return { path: filePath, content, hash: hash(bytes), bom: bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])), eol: content.includes('\r\n') ? '\r\n' : '\n' };
}

async function atomicWrite(filePath, bytes, options = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temp, 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    // OneDrive / virus scanners can briefly hold the destination. Never unlink
    // the original: a failed replacement must leave its bytes recoverable.
    for (let attempt = 0; ; attempt++) {
      await options.beforeReplace?.();
      try { await fs.rename(temp, filePath); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 40 * 2 ** attempt));
      }
    }
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}

async function saveDocument(filePath, content, expectedHash, options = {}) {
  let existing;
  try { existing = await fs.readFile(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const currentHash = existing ? hash(existing) : null;
  if (expectedHash !== currentHash && !options.force) return { conflict: true, diskHash: currentHash };
  const normalized = content.replace(/\r\n/g, '\n').replace(/\n/g, options.eol || '\n');
  const bytes = Buffer.from(`${options.bom ? '\uFEFF' : ''}${normalized}`, 'utf8');
  await atomicWrite(filePath, bytes);
  return { path: filePath, hash: hash(bytes), content, bom: !!options.bom, eol: options.eol || '\n' };
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function listMarkdown(root, depth = 0) {
  if (depth > 8) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'target', '$RECYCLE.BIN'].includes(entry.name) || entry.isSymbolicLink()) continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      let children = [];
      try { children = await listMarkdown(entryPath, depth + 1); } catch { /* unreadable folders are omitted */ }
      if (children.length) result.push({ name: entry.name, path: entryPath, children });
    } else if (/\.(md|markdown|mdown|txt)$/i.test(entry.name)) result.push({ name: entry.name, path: entryPath });
    if (result.length >= 2000) break;
  }
  return result.sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name, 'zh-CN'));
}

async function copyRelativeImages(oldDocument, newDocument, sources) {
  const oldDir = path.dirname(oldDocument), newDir = path.dirname(newDocument);
  if (oldDir === newDir) return;
  for (const src of new Set(sources || [])) {
    if (/^(https?:|data:|blob:|[a-z]:[\\/])/i.test(src)) continue;
    let decoded; try { decoded = decodeURIComponent(src); } catch { decoded = src; }
    const source = path.resolve(oldDir, decoded), target = path.resolve(newDir, decoded);
    if (source === target) continue;
    if (!isInside(oldDir, source) || !isInside(newDir, target)) throw new Error('图片使用了上级目录的相对路径。请将文稿另存到原文件夹，或先把图片放入文稿旁的素材文件夹。');
    const bytes = await fs.readFile(source);
    if (bytes.length > 20 * 1024 * 1024) throw new Error('图片超过 20 MB');
    try {
      const existing = await fs.readFile(target);
      if (!existing.equals(bytes)) throw new Error(`目标位置已有不同的同名图片：${decoded}。请选择其他文件夹。`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes, { flag: 'wx' });
    }
  }
}

module.exports = { hash, readDocument, saveDocument, atomicWrite, isInside, listMarkdown, copyRelativeImages };
