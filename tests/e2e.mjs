import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
const root = await fs.mkdtemp(path.resolve('test-results/e2e-'))
const profile = path.join(root, 'profile')
await fs.mkdir(profile, { recursive: true })
await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ autoSave: false }))
const fixture = path.join(root, '中文测试.md')
const original = '# 中文测试\r\n\r\n这是一段 **加粗** 和 *斜体* 文字。\r\n\r\n## 清单\r\n\r\n- [ ] 第一件事\r\n- [x] 已完成\r\n\r\n| 名称 | 数量 |\r\n| --- | --- |\r\n| 苹果 | 3 |\r\n\r\n```javascript\r\nconst answer = 42;\r\n```\r\n\r\n行内公式 $x^2$。\r\n'
await fs.writeFile(fixture, original)
const env = { ...process.env, MOYE_TEST: '1', MOYE_USER_DATA: profile }
delete env.ELECTRON_RUN_AS_NODE
const results = [], errors = []
let app, page
async function launch(args = []) {
  app = await electron.launch({ ...(process.env.MOYE_EXECUTABLE ? { executablePath: process.env.MOYE_EXECUTABLE } : {}), args: process.env.MOYE_EXECUTABLE ? args : ['.', ...args], env, timeout: 60000 })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })
  await page.locator('.ProseMirror').waitFor({ timeout: 60000 })
  await ready()
}
async function ready() { await page.locator('.editor-loading').waitFor({ state: 'detached', timeout: 60000 }) }
async function waitForFile(file, predicate) {
  const start = Date.now()
  while (Date.now() - start < 10000) { try { const text = await fs.readFile(file, 'utf8'); if (predicate(text)) return text } catch {} await new Promise(r => setTimeout(r, 100)) }
  throw new Error('Timed out waiting for file: ' + file)
}
async function menu(label, item) { await page.getByRole('navigation', { name: '主菜单' }).getByRole('button', { name: label, exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: false }).click() }
async function setSavePath(file) { await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, file) }
async function quit() { await app.evaluate(({ app }) => app.exit(0)) }
async function test(name, fn) { await fn(); results.push(name); console.log('PASS', name) }
try {
  await launch()
  await app.evaluate(async ({ dialog }, { fixture, original }) => {
    const fs = process.getBuiltinModule('fs').promises
    await fs.writeFile(fixture, original, 'utf8')
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] })
  }, { fixture, original })
  await page.evaluate(() => window.moye.settings({ autoSave: false }))
  await page.getByRole('button', { name: '写作设置' }).click()
  const auto = page.getByRole('switch', { name: '自动保存', exact: true })
  if (await auto.getAttribute('aria-checked') === 'true') await auto.click()
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.keyboard.press('Control+o')
  await ready()
  await page.locator('.ProseMirror h1').filter({ hasText: '中文测试' }).waitFor()
  await test('读取中文文档、GFM 表格/任务、代码和公式', async () => {
    assert.equal(await page.locator('.ProseMirror strong').innerText(), '加粗')
    assert.equal(await page.locator('.ProseMirror table tbody tr').count() + await page.locator('.ProseMirror table thead tr').count(), 2)
    assert.equal(await page.locator('.milkdown-code-block').count(), 1)
    assert.ok(await page.locator('.katex').count() >= 1)
    assert.ok((await page.locator('.outline').innerText()).includes('清单'))
  })
  await test('只打开和切换源码不重写原文件', async () => {
    await page.keyboard.press('Control+/'); await ready()
    await page.locator('.source-editor .cm-content').waitFor()
    await page.keyboard.press('Control+/'); await ready()
    assert.equal(await fs.readFile(fixture, 'utf8'), original)
    assert.equal(await page.locator('.dirty-dot').count(), 0, 'Mode switches must not mark CRLF documents dirty')
  })
  await test('中文输入、撤销/重做和立即保存', async () => {
    await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter')
    await page.keyboard.insertText('新增中文段落，保存不会丢字。')
    await page.keyboard.press('Control+s')
    await waitForFile(fixture, t => t.includes('新增中文段落，保存不会丢字。'))
    await page.keyboard.insertText('临时内容')
    await page.keyboard.press('Control+z')
    assert.equal((await page.locator('.ProseMirror').innerText()).includes('临时内容'), false)
    await page.keyboard.press('Control+y')
    assert.equal((await page.locator('.ProseMirror').innerText()).includes('临时内容'), true)
  })
  await test('查找与全部替换写回文稿', async () => {
    await page.keyboard.press('Control+h')
    await page.getByRole('textbox', { name: '查找内容', exact: true }).fill('临时内容')
    await page.getByRole('textbox', { name: '替换内容', exact: true }).fill('替换成功')
    await page.getByRole('button', { name: '全部替换', exact: true }).click()
    assert.ok((await page.locator('.ProseMirror').innerText()).includes('替换成功'))
    await page.getByRole('button', { name: '关闭查找' }).click()
    await page.keyboard.press('Control+s'); await waitForFile(fixture, t => t.includes('替换成功'))
  })
  await test('外部修改与未保存内容冲突，不自动覆盖', async () => {
    await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('本地未保存')
    await fs.writeFile(fixture, '# 外部新版本\n\n必须保留。\n')
    await page.locator('.conflict-banner').waitFor()
    await page.keyboard.press('Control+s')
    assert.equal(await fs.readFile(fixture, 'utf8'), '# 外部新版本\n\n必须保留。\n')
    await page.getByRole('button', { name: '覆盖保存', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '覆盖保存', exact: true }).click()
    await waitForFile(fixture, t => t.includes('本地未保存'))
    await page.locator('.conflict-banner').waitFor({ state: 'detached' })
  })
  await test('源码编辑与撤销再切回即时编辑', async () => {
    await page.keyboard.press('Control+/'); await ready()
    await page.locator('.source-editor .cm-content').click(); await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n\n## 源码新增\n\n源码内容。\n')
    await page.keyboard.press('Control+/'); await ready()
    await page.locator('.ProseMirror h2').filter({ hasText: '源码新增' }).waitFor()
    await page.keyboard.press('Control+s'); await waitForFile(fixture, t => t.includes('## 源码新增'))
  })
  await test('本地图片插入、显示、保存', async () => {
    const png = path.join(root, '测试图片.png')
    await fs.writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+End')
    await page.locator('input[type=file]').setInputFiles(png)
    await page.waitForFunction(() => [...document.querySelectorAll('.ProseMirror img')].some(i => i.complete && i.naturalWidth > 0))
    await page.keyboard.press('Control+s'); await waitForFile(fixture, t => t.includes('.assets/'))
  })
  await test('关闭文稿后重新打开保存文件，内容与图片保留', async () => {
    await page.keyboard.press('Control+n'); await ready()
    await page.keyboard.press('Control+o'); await ready()
    await page.locator('.ProseMirror').filter({ hasText: '源码新增' }).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.ProseMirror img')].some(i => i.complete && i.naturalWidth > 0))
  })
  await test('导出自包含 HTML 和实际 PDF 文件', async () => {
    const htmlFile = path.join(root, '导出.html'), pdfFile = path.join(root, '导出.pdf')
    await setSavePath(htmlFile); await menu('文件', '导出 HTML…')
    const html = await waitForFile(htmlFile, t => t.includes('</html>'))
    assert.ok(html.includes('data:image/png;base64,')); assert.ok(html.includes('源码新增')); assert.ok(html.includes('<math'))
    await setSavePath(pdfFile); await menu('文件', '导出 PDF…')
    await waitForFile(pdfFile, t => t.startsWith('%PDF'))
    assert.ok((await fs.stat(pdfFile)).size > 5000)
  })
  await test('主题与写作设置持久化', async () => {
    await page.getByRole('button', { name: '写作设置' }).click()
    await page.locator('.theme-card-dark').click()
    assert.ok(await page.locator('.theme-dark').count())
    await page.getByRole('switch', { name: '自动保存', exact: true }).click()
    await page.getByRole('button', { name: '关闭面板' }).click()
    const prefs = await waitForFile(path.join(profile, 'settings.json'), t => JSON.parse(t).autoSave === true && JSON.parse(t).theme === 'dark')
    assert.equal(JSON.parse(prefs).theme, 'dark')
  })
  await test('自动保存实际写入磁盘', async () => {
    await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('自动保存测试')
    await waitForFile(fixture, t => t.includes('自动保存测试'))
  })
  await page.screenshot({ path: path.join(root, 'dark.png') })
  await test('新文稿关闭取消与崩溃恢复', async () => {
    await page.keyboard.press('Control+n'); await ready()
    await page.locator('.ProseMirror').click(); await page.keyboard.insertText('崩溃恢复的中文草稿')
    await waitForFile(path.join(profile, 'draft.json'), t => t.includes('崩溃恢复的中文草稿'))
    await page.keyboard.press('Control+w')
    await page.getByRole('dialog', { name: '保存这篇文稿？' }).waitFor()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    assert.ok((await page.locator('.ProseMirror').innerText()).includes('崩溃恢复的中文草稿'))
    await quit(); await launch()
    await page.getByRole('dialog', { name: '找回上次的文稿' }).waitFor()
    await page.getByRole('button', { name: '恢复文稿', exact: true }).click(); await ready()
    await page.locator('.ProseMirror').filter({ hasText: '崩溃恢复的中文草稿' }).waitFor()
    assert.ok(await page.locator('.theme-dark').count())
  })
  assert.deepEqual(errors, [])
  console.log(`E2E ${results.length} passed; artifacts: ${root}`)
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ passed: results, errors }, null, 2))
} catch (error) {
  console.error(error)
  if (page) { await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {}); console.log((await page.locator('body').innerText()).slice(-8000)) }
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ passed: results, errors, failure: String(error) }, null, 2))
  process.exitCode = 1
} finally { if (app) await quit().catch(() => {}) }
