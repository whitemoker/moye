import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

const root = await fs.mkdtemp(path.resolve('test-results/writing-modes-'))
const profile = path.join(root, 'profile'), fixture = path.join(root, '写作模式.md')
const original = '# 写作模式检查\n\n当前段落保持清晰，其他段落柔和淡化。\n\n第二段也应能正常选择与编辑。\n\n- 第一条列表文字\n- 第二条列表文字\n\n> 引用里的第一段。\n>\n> 引用里的第二段。\n\n| 项目 | 说明 |\n| --- | --- |\n| 表格单元格 | 整组高亮 |\n| 下一行 | 整组保持清晰 |\n\n```js\nconst answer = 42;\nconsole.log(answer);\n```\n\n' + Array.from({ length: 24 }, (_, i) => `## 章节 ${i + 1}\n\n第 ${i + 1} 段：开始写作后，当前输入行保持在编辑区域中间。鼠标拖选和滚轮阅读不应被打断。\n`).join('\n')
const env = { ...process.env, MOYE_TEST: '1', MOYE_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
let app, page
const passed = [], errors = [], observations = {}
async function launch() {
  const flags = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
  app = await electron.launch({ ...(process.env.MOYE_EXECUTABLE ? { executablePath: process.env.MOYE_EXECUTABLE, args: flags } : { args: ['.', ...flags] }), env, timeout: 60000 })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false))
  await page.locator('.ProseMirror').waitFor()
  await ready()
}
async function ready() { await page.locator('.editor-loading').waitFor({ state: 'detached' }) }
async function settle() { await page.waitForTimeout(100); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function check(name, action) { if (process.env.MOYE_CHECK && !name.includes(process.env.MOYE_CHECK)) return; const start = Date.now(); console.log('CHECK', name); await action(); passed.push(name); console.log('PASS', name, Date.now() - start) }
async function mode(name) { await page.getByRole('button', { name, exact: true }).click(); await settle() }
async function theme(label) {
  await page.getByRole('button', { name: '写作设置', exact: true }).click()
  await page.locator('.theme-card').filter({ hasText: label }).click()
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await settle()
}
async function capture(name) {
  await app.evaluate(async ({ BrowserWindow }) => { await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }) })
  await settle()
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'))
  await fs.writeFile(path.join(root, name), Buffer.from(png, 'base64'))
}
async function centerFacts(source = false) {
  await settle()
  return page.evaluate(source => {
    const scroll = document.querySelector(source ? '.source-editor .cm-scroller' : '.rich-editor')
    const range = getSelection()?.rangeCount ? getSelection().getRangeAt(0) : null
    const cursor = source ? document.querySelector('.source-editor .cm-cursor')?.getBoundingClientRect() : range?.getBoundingClientRect()
    if (!cursor) throw new Error('No visible caret')
    const bounds = scroll.getBoundingClientRect()
    return { delta: (cursor.top + cursor.bottom) / 2 - bounds.top - scroll.clientHeight / 2, scroll: scroll.scrollTop, selected: getSelection()?.toString(), padding: getComputedStyle(document.querySelector(source ? '.source-editor .cm-content' : '.ProseMirror')).paddingTop }
  }, source)
}
async function assertCentered(source = false) { const facts = await centerFacts(source); assert.ok(Math.abs(facts.delta) < 4, JSON.stringify(facts)); return facts }
try {
  await launch()
  await app.evaluate(async ({ dialog }, { fixture, original }) => {
    await process.getBuiltinModule('fs').promises.writeFile(fixture, original)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] })
  }, { fixture, original })
  await page.getByRole('button', { name: '写作设置', exact: true }).click()
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await page.keyboard.press('Control+o'); await page.locator('.ProseMirror h1').filter({ hasText: '写作模式检查' }).waitFor(); await ready()
  await check('去掉月亮快捷入口和固定离线文案，两个模式有名称及开关状态', async () => {
    assert.equal(await page.getByRole('button', { name: '切换明暗主题' }).count(), 0)
    assert.equal(await page.getByText('本地写作 · 无需联网').count(), 0)
    for (const name of ['专注模式', '打字机模式']) assert.equal(await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'false')
    assert.ok((await page.getByRole('button', { name: '打字机模式', exact: true }).innerText()).includes('打字机'))
  })
  await check('暖纸主题与主菜单同步，切换模式不会改变主题', async () => {
    await theme('暖纸')
    await page.getByRole('navigation', { name: '主菜单' }).getByRole('button', { name: '主题', exact: true }).click()
    assert.equal(await page.getByRole('menuitemradio', { name: '暖纸', exact: true }).getAttribute('aria-checked'), 'true')
    await page.keyboard.press('Escape')
    await page.locator('.ProseMirror > p').first().click()
    await mode('专注模式'); await mode('专注模式')
    assert.equal(await page.locator('.theme-paper').count(), 1)
  })
  await check('专注保留整组列表高亮，周围文字保留八成不透明度', async () => {
    const items = page.locator('.ProseMirror li p')
    await items.first().click(); await mode('专注模式')
    assert.equal(await items.first().evaluate(el => getComputedStyle(el).opacity), '1')
    assert.equal(await items.first().evaluate(el => getComputedStyle(el.closest('.ProseMirror > *')).opacity), '1')
    assert.equal(await page.locator('.ProseMirror > p').first().evaluate(el => getComputedStyle(el).opacity), '0.8')
    await items.nth(1).hover(); await settle()
    assert.equal(await items.nth(1).evaluate(el => getComputedStyle(el.closest('.ProseMirror > *')).opacity), '1')
  })
  await check('引用与表格保留整组高亮，周围段落仍可阅读', async () => {
    if (process.env.MOYE_CHECK) { await theme('暖纸'); await mode('专注模式') }
    const quote = page.locator('.ProseMirror blockquote p')
    await quote.first().click(); await settle()
    assert.equal(await quote.first().evaluate(el => getComputedStyle(el).opacity), '1')
    assert.equal(await quote.nth(1).evaluate(el => getComputedStyle(el.closest('.ProseMirror > *')).opacity), '1')
    const cells = page.locator('.ProseMirror table.children td p')
    await cells.first().click(); await settle()
    assert.equal(await cells.first().evaluate(el => getComputedStyle(el).opacity), '1')
    assert.equal(await cells.nth(1).evaluate(el => getComputedStyle(el.closest('.ProseMirror > *')).opacity), '1')
    assert.equal(await page.locator('.ProseMirror > p').first().evaluate(el => getComputedStyle(el).opacity), '0.8')
    await capture('focus-table.png')
  })
  await check('专注不影响多段选择，关闭后恢复全部文字亮度', async () => {
    const paragraphs = page.locator('.ProseMirror > p')
    await paragraphs.first().click(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Shift+ArrowDown'); await settle()
    assert.ok((await page.evaluate(() => getSelection().toString())).length > 5)
    await mode('专注模式')
    assert.equal(await paragraphs.nth(1).evaluate(el => getComputedStyle(el).opacity), '1')
  })
  await check('打字机开启即居中，首行、末行和输入后均保持居中', async () => {
    await page.locator('.ProseMirror > p').first().click(); await page.keyboard.press('Home')
    await mode('打字机模式'); observations.richEnabled = await assertCentered()
    await page.keyboard.press('Control+Home'); observations.richFirst = await assertCentered()
    await page.keyboard.press('Control+End'); observations.richLast = await assertCentered()
    await page.keyboard.press('Enter'); await page.keyboard.insertText('新的输入行'); await assertCentered()
    await capture('typewriter-centered.png')
  })
  await check('代码块输入和调整窗口后，打字机仍跟随当前输入行', async () => {
    if (await page.getByRole('button', { name: '打字机模式', exact: true }).getAttribute('aria-pressed') !== 'true') await mode('打字机模式')
    await page.locator('.milkdown-code-block').first().scrollIntoViewIfNeeded(); await settle()
    const content = page.locator('.milkdown-code-block .cm-content').first()
    await content.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' // 代码输入')
    await assertCentered()
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760))
    await assertCentered()
    await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setSize(bounds.width, bounds.height), bounds)
    await page.locator('.ProseMirror > p').first().click(); await settle()
  })
  await check('打字机拖选不跳动，鼠标滚动阅读不会被拉回', async () => {
    await page.keyboard.press('Control+Home'); await assertCentered()
    const h1 = page.locator('.ProseMirror h1'), box = await h1.boundingBox()
    const before = await page.locator('.rich-editor').evaluate(el => el.scrollTop)
    await page.mouse.move(box.x + 2, box.y + box.height / 2); await page.mouse.down()
    await page.mouse.move(box.x + 185, box.y + box.height / 2, { steps: 12 }); await settle()
    assert.ok(Math.abs(await page.locator('.rich-editor').evaluate(el => el.scrollTop) - before) < 2)
    await page.mouse.up(); await settle()
    assert.ok((await page.evaluate(() => getSelection().toString())).length > 2)
    assert.ok(Math.abs(await page.locator('.rich-editor').evaluate(el => el.scrollTop) - before) < 2)
    await page.mouse.wheel(0, 250); await settle()
    const readScroll = await page.locator('.rich-editor').evaluate(el => el.scrollTop)
    await page.waitForTimeout(300)
    assert.equal(await page.locator('.rich-editor').evaluate(el => el.scrollTop), readScroll)
    assert.ok(readScroll > before + 100)
  })
  await check('快捷键与菜单勾选同步，关闭打字机恢复普通页边距', async () => {
    await page.keyboard.press('F9'); await settle()
    assert.equal(await page.getByRole('button', { name: '打字机模式', exact: true }).getAttribute('aria-pressed'), 'false')
    assert.equal(await page.locator('.ProseMirror').evaluate(el => getComputedStyle(el).paddingTop), '40px')
    await page.keyboard.press('F8')
    await page.getByRole('navigation', { name: '主菜单' }).getByRole('button', { name: '视图', exact: true }).click()
    assert.equal(await page.getByRole('menuitemcheckbox', { name: /专注模式/ }).getAttribute('aria-checked'), 'true')
    assert.equal(await page.getByRole('menuitemcheckbox', { name: /打字机模式/ }).getAttribute('aria-checked'), 'false')
    await page.keyboard.press('Escape'); await page.keyboard.press('F8')
  })
  await check('源码切换主题不重建编辑器，不丢光标和撤销历史', async () => {
    await page.keyboard.press('Control+/'); await ready(); await page.locator('.source-editor .cm-content').click(); await page.keyboard.press('Control+End')
    await page.keyboard.insertText('保留撤销标记')
    await page.evaluate(() => { window.__sourceNode = document.querySelector('.source-editor .cm-content') })
    await theme('深夜')
    assert.equal(await page.evaluate(() => window.__sourceNode === document.querySelector('.source-editor .cm-content')), true)
    await page.keyboard.insertText('接在光标处')
    assert.ok((await page.locator('.source-editor .cm-content').innerText()).includes('保留撤销标记接在光标处'))
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z')
    assert.equal((await page.locator('.source-editor .cm-content').innerText()).includes('保留撤销标记'), false)
    await theme('暖纸')
  })
  await check('源码专注仅轻微淡化，打字机首末行与输入后居中', async () => {
    if (!await page.locator('.source-editor .cm-content').count()) { await page.keyboard.press('Control+/'); await ready(); await page.locator('.source-editor .cm-content').click() }
    await page.keyboard.press('Control+Home'); await page.keyboard.press('F8')
    await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Shift+ArrowDown'); await settle()
    const readable = await page.locator('.source-editor .cm-line').evaluateAll(lines => lines.every(el => Number(getComputedStyle(el).opacity) >= 0.8))
    assert.equal(readable, true)
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('F9'); observations.sourceFirst = await assertCentered(true)
    await page.keyboard.press('Control+End'); observations.sourceLast = await assertCentered(true)
    await page.keyboard.press('Enter'); await page.keyboard.insertText('源码模式输入'); await assertCentered(true)
    const sourceScroll = page.locator('.source-editor .cm-scroller'), frame = await sourceScroll.boundingBox()
    const beforeRead = await sourceScroll.evaluate(el => el.scrollTop)
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2); await page.mouse.wheel(0, -200); await settle()
    const afterRead = await sourceScroll.evaluate(el => el.scrollTop)
    assert.ok(afterRead < beforeRead - 100, JSON.stringify({ beforeRead, afterRead }))
    await page.waitForTimeout(300)
    assert.equal(await sourceScroll.evaluate(el => el.scrollTop), afterRead)
    await page.keyboard.press('ArrowLeft'); await assertCentered(true)
    const line = page.locator('.source-editor .cm-line').last(), box = await line.boundingBox()
    const scroll = await page.locator('.source-editor .cm-scroller').evaluate(el => el.scrollTop)
    await page.mouse.move(box.x + 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + 70, box.y + box.height / 2, { steps: 5 }); await page.mouse.up(); await settle()
    assert.ok(Math.abs(await page.locator('.source-editor .cm-scroller').evaluate(el => el.scrollTop) - scroll) < 2)
    await page.keyboard.press('F8'); await page.keyboard.press('F9')
  })
  await check('设置重启后持久化，界面操作没有自动改写测试文件', async () => {
    const unchanged = await app.evaluate(async (_, { fixture, original }) => await process.getBuiltinModule('fs').promises.readFile(fixture, 'utf8') === original, { fixture, original })
    assert.equal(unchanged, true)
    await page.keyboard.press('Control+s'); await page.waitForFunction(() => document.querySelector('.save-status').textContent.includes('已保存'))
    await app.evaluate(({ app }) => app.exit(0)); app = null
    await launch()
    await page.waitForFunction(() => document.querySelector('.app.theme-paper'))
    assert.equal(await page.getByRole('button', { name: '专注模式', exact: true }).getAttribute('aria-pressed'), 'false')
    assert.equal(await page.getByRole('button', { name: '打字机模式', exact: true }).getAttribute('aria-pressed'), 'false')
    await capture('clean-paper-interface.png')
  })
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ passed, errors, observations }, null, 2))
  console.log(`WRITING MODES ${passed.length} passed: ${root}`)
} catch (error) {
  console.error(error)
  if (page) await capture('failure.png').catch(() => {})
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ passed, errors, observations, failure: String(error) }, null, 2))
  process.exitCode = 1
} finally { if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
