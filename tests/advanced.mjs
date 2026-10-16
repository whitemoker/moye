import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
const root = await fs.mkdtemp(path.resolve('test-results/advanced-'))
const env = { ...process.env, MOYE_TEST: '1', MOYE_USER_DATA: path.join(root, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ ...(process.env.MOYE_EXECUTABLE ? { executablePath: process.env.MOYE_EXECUTABLE } : {}), args: process.env.MOYE_EXECUTABLE ? [] : ['.'], env })
const page = await app.firstWindow(), results = [], errors = []
let currentCheck = 'startup'
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR during', currentCheck, e.stack) })
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })
const ready = () => page.locator('.editor-loading').waitFor({ state: 'detached' })
const menu = async (label, name) => { await page.getByRole('navigation').getByRole('button', { name: label, exact: true }).click(); await page.getByRole('menuitem', { name, exact: false }).click() }
const saveTo = p => app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }) }, p)
async function readWhen(p, needle) { for (let i = 0; i < 100; i++) { try { const t = await fs.readFile(p, 'utf8'); if (t.includes(needle)) return t } catch {} await new Promise(r => setTimeout(r, 100)) } throw new Error('File did not contain ' + needle) }
async function check(name, fn) { currentCheck = name; await fn(); results.push(name); console.log('PASS', name) }
try {
  await page.locator('.ProseMirror').waitFor(); await ready()
  await page.getByRole('button', { name: '写作设置' }).click()
  if (await page.getByRole('switch', { name: '自动保存', exact: true }).getAttribute('aria-checked') === 'true') await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.keyboard.press('Control+n'); await ready()
  await check('标题 Markdown 输入规则与中文输入法组合事件', async () => {
    await page.locator('.ProseMirror').click(); await page.keyboard.type('# '); await page.keyboard.insertText('输入测试')
    await page.locator('.ProseMirror h1').filter({ hasText: '输入测试' }).waitFor()
    await page.keyboard.press('Enter')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 })
    await cdp.send('Input.insertText', { text: '中文输入法' })
    await page.keyboard.insertText(' 正常提交')
    const text = await page.locator('.ProseMirror').innerText()
    assert.ok(text.includes('中文输入法 正常提交')); assert.equal(text.includes('zhongwen'), false)
  })
  await check('表格插入、编辑单元格、快捷键增行与右键增列', async () => {
    await page.keyboard.press('Enter'); await menu('段落', '表格…')
    await page.getByRole('button', { name: '插入表格', exact: true }).click()
    const table = page.locator('.ProseMirror table.children')
    await table.waitFor(); assert.equal(await table.locator('tr').count(), 4)
    await table.locator('td').first().click(); await page.keyboard.insertText('单元格编辑')
    await page.keyboard.press('Control+Enter'); assert.equal(await table.locator('tr').count(), 5)
    await table.locator('td').first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: '右侧插入列', exact: true }).click()
    assert.equal(await table.locator('tr').first().locator('th').count(), 4)
  })
  const savedPath = path.join(root, '新建保存.md')
  await check('新文稿另存为并重新打开', async () => {
    await saveTo(savedPath); await page.keyboard.press('Control+s'); await readWhen(savedPath, '单元格编辑')
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, savedPath)
    await page.keyboard.press('Control+n'); await ready(); await page.keyboard.press('Control+o'); await ready()
    await page.locator('.ProseMirror h1').filter({ hasText: '输入测试' }).waitFor()
  })
  await check('YAML 属性、HTML 与图片说明在编辑后保留', async () => {
    await page.keyboard.press('Control+/'); await ready(); await page.locator('.source-editor .cm-content').click(); await page.keyboard.press('Control+Home')
    await page.keyboard.insertText('---\ntitle: 测试标题\ntags: [写作, 测试]\n---\n\n')
    await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n\n<span>保留的HTML</span>\n\n![示例图片说明](images/test.svg "图片标题")\n')
    await app.evaluate(async (_, root) => { const fs = process.getBuiltinModule('fs').promises; await fs.mkdir(root + '/images', { recursive: true }); await fs.writeFile(root + '/images/test.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" rx="10" fill="#e8f1ed"/><text x="120" y="56" text-anchor="middle" fill="#3e786b" font-size="20">Moye image test</text></svg>') }, root)
    await page.keyboard.press('Control+/'); await ready()
    await page.locator('.frontmatter').waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.ProseMirror img')].some(i => i.naturalWidth === 240))
    await page.locator('.ProseMirror h1').click(); await page.keyboard.press('End'); await page.keyboard.insertText('已编辑')
    await page.keyboard.press('Control+s')
    const content = await readWhen(savedPath, '已编辑')
    assert.ok(content.startsWith('---\r\n') || content.startsWith('---\n')); assert.ok(content.includes('title: 测试标题')); assert.ok(content.includes('<span>保留的HTML</span>')); assert.ok(content.includes('![示例图片说明]'))
  })
  await check('另存到新目录时复制相对图片，重新打开后仍显示', async () => {
    const newPath = path.join(root, 'new-folder', '副本.md'); await fs.mkdir(path.dirname(newPath), { recursive: true })
    await saveTo(newPath); await page.keyboard.press('Control+Shift+s'); await readWhen(newPath, '示例图片说明')
    assert.ok((await fs.readFile(path.join(root, 'new-folder', 'images', 'test.svg'), 'utf8')).includes('Moye image test'))
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, newPath)
    await page.keyboard.press('Control+n'); await ready(); await page.keyboard.press('Control+o'); await ready()
    await page.waitForFunction(() => [...document.querySelectorAll('.ProseMirror img')].some(i => i.naturalWidth === 240))
  })
  await check('文件夹、筛选和快速打开', async () => {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, root)
    await page.keyboard.press('Control+Shift+o')
    await page.locator('.file-list').getByText('副本.md', { exact: true }).waitFor()
    await page.getByRole('textbox', { name: '筛选文件', exact: true }).fill('新建保存')
    assert.equal(await page.locator('.file-list .file-row').count(), 1)
    await page.keyboard.press('Control+p'); await page.getByRole('textbox', { name: '快速打开搜索' }).fill('副本')
    await page.locator('.quick-list button').first().click(); await ready()
  })
  await check('粘贴图片事件保存为本地素材', async () => {
    await page.keyboard.press('Control+/'); await ready(); await page.locator('.source-editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n\n粘贴图片测试\n')
    await page.keyboard.press('Control+/'); await ready(); await page.locator('.ProseMirror > p').last().click()
    const before = await page.locator('.ProseMirror img').count()
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#3e786b"/></svg>'], 'paste.svg', { type: 'image/svg+xml' }))
      document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
    await page.waitForFunction(count => document.querySelectorAll('.ProseMirror img').length > count, before)
    await page.waitForFunction(() => [...document.querySelectorAll('.ProseMirror img')].some(i => i.naturalWidth === 120))
    await page.keyboard.press('Control+s'); await readWhen(path.join(root, 'new-folder', '副本.md'), '.assets/')
  })
  await check('拖入 Markdown 文件打开', async () => {
    const dropped = path.join(root, '拖入.md')
    await app.evaluate(async (_, p) => { await process.getBuiltinModule('fs').promises.writeFile(p, '# 拖入的文稿\n\n文件拖放成功。') }, dropped)
    await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'test-drop'; input.hidden = true; document.body.append(input) })
    await page.locator('#test-drop').setInputFiles(dropped)
    await page.evaluate(() => { const data = new DataTransfer(); data.items.add(document.querySelector('#test-drop').files[0]); document.querySelector('.app').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })); document.querySelector('#test-drop').remove() })
    await page.locator('.ProseMirror h1').filter({ hasText: '拖入的文稿' }).waitFor()
  })
  await check('专注与打字机模式切换，设置面板截图', async () => {
    await page.getByRole('button', { name: '写作设置' }).click()
    await page.getByRole('switch', { name: '专注模式', exact: true }).click()
    await page.getByRole('switch', { name: '打字机模式', exact: true }).click()
    assert.ok(await page.locator('.focus-mode.typewriter-mode').count())
    await page.screenshot({ path: path.join(root, 'settings.png') })
    await page.getByRole('button', { name: '关闭面板' }).click()
    await page.locator('.ProseMirror h1').click(); await page.keyboard.press('End'); await page.keyboard.insertText(' ')
  })
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ passed: results, errors }, null, 2))
  console.log(`ADVANCED ${results.length} passed: ${root}`)
} catch (error) {
  console.error(error)
  await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {})
  console.log((await page.locator('body').innerText()).slice(-7000))
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ passed: results, errors, failure: String(error) }, null, 2))
  process.exitCode = 1
} finally { await app.evaluate(({ app }) => app.exit(0)) }
