import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
await fs.mkdir('test-results', { recursive: true })
const root = await fs.mkdtemp(path.resolve('test-results/format-toggle-')), profile = path.join(root, 'profile')
const fixture = path.join(root, '格式切换验收.md')
const original = '# 格式切换验收\n\n标题切换中文😀\n\n列表转换保留原文\n\n引用保留 **加粗** 文字\n\n源码甲\n\n源码乙\n\n```js\nconst protectedText = 1;\n```\n'
await fs.mkdir(profile, { recursive: true }); await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ autoSave: false, theme: 'paper', sidebar: true })); await fs.writeFile(fixture, original)
const env = { ...process.env, MOYE_TEST: '1', MOYE_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.MOYE_DEV_URL
const app = await electron.launch({ ...(process.env.MOYE_EXECUTABLE ? { executablePath: process.env.MOYE_EXECUTABLE, args: [fixture] } : { args: ['.', fixture] }), env, timeout: 60000 })
const page = await app.firstWindow(), results = [], errors = []
page.on('pageerror', e => errors.push(e.message))
const ready = () => page.locator('.editor-loading').waitFor({ state: 'detached', timeout: 60000 })
const pause = () => page.waitForTimeout(100)
async function test(name, action) { await action(); results.push(name); console.log('PASS', name) }
async function menu(group, name) { await page.getByRole('navigation', { name: '主菜单' }).getByRole('button', { name: group, exact: true }).click(); await page.getByRole('menuitem', { name, exact: false }).click(); await pause() }
async function select(text, cursor = false) {
  await page.evaluate(({ text, cursor }) => {
    const root = document.querySelector('.ProseMirror'); root.focus()
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while(walker.nextNode()) { const node = walker.currentNode, start = node.textContent.indexOf(text); if(start >= 0) { const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + (cursor ? 0 : text.length)); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); return } }
    throw new Error('Selection missing: ' + text)
  }, { text, cursor }); await pause()
}
async function sourceMode() { await page.keyboard.press('Control+/'); await ready(); await pause() }
const richText = () => page.locator('.ProseMirror').innerText()
const sourceText = () => page.locator('.source-editor .cm-content').innerText()
async function capture(name) {
  let image
  for(let i = 0; i < 3; i++) { image = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64')); await pause() }
  await fs.writeFile(path.join(root, name + '.png'), Buffer.from(image, 'base64'))
}
try {
  await ready(); await page.locator('.ProseMirror h1').filter({ hasText: '格式切换验收' }).waitFor()
  await test('实际 Ctrl+1–6 同级取消、跨级切换、菜单 H5/H6 与撤销', async () => {
    for(let level = 1; level <= 6; level++) {
      await select('标题切换中文😀', true); await page.keyboard.press(`Control+${level}`)
      await page.locator(`.ProseMirror h${level}`).filter({ hasText: '标题切换中文😀' }).waitFor()
      if (level === 1) await capture('heading-applied')
      await page.keyboard.press(`Control+${level}`); await page.locator('.ProseMirror > p').filter({ hasText: '标题切换中文😀' }).waitFor()
      await page.keyboard.press('Control+z'); await page.locator(`.ProseMirror h${level}`).filter({ hasText: '标题切换中文😀' }).waitFor()
      await page.keyboard.press('Control+0')
    }
    await select('标题切换中文😀'); await menu('段落', '五级标题'); assert.equal(await page.locator('.ProseMirror h5').innerText(), '标题切换中文😀')
    await menu('段落', '六级标题'); assert.equal(await page.locator('.ProseMirror h6').innerText(), '标题切换中文😀')
    await menu('段落', '六级标题'); assert.equal(await page.locator('.ProseMirror h6').count(), 0)
    await capture('heading-cancelled')
  })
  await test('列表菜单转换、同类取消和任务清单保留原文', async () => {
    await select('转换保留'); const before = await richText()
    await menu('段落', '无序列表'); assert.equal(await page.locator('.ProseMirror li').count(), 1)
    await menu('段落', '有序列表'); assert.equal(await page.locator('.ProseMirror ol li').count(), 1); assert.equal(await page.locator('.ProseMirror li li').count(), 0)
    await menu('段落', '任务清单'); assert.equal(await page.locator('.ProseMirror li .label.unchecked').count(), 1)
    assert.ok(!(await richText()).includes('待办事项')); assert.ok((await richText()).includes('列表转换保留原文'))
    await menu('段落', '任务清单'); assert.equal(await page.locator('.ProseMirror li').count(), 0); assert.equal(await richText(), before)
    await page.keyboard.press('Control+z'); assert.equal(await page.locator('.ProseMirror li .label.unchecked').count(), 1)
    await menu('段落', '无序列表'); await menu('段落', '无序列表'); assert.equal(await page.locator('.ProseMirror li').count(), 0)
  })
  await test('引用取消保留加粗，标题/引用/列表操作后的评论仍定位原文', async () => {
    await select('引用保留'); await page.keyboard.press('Control+Alt+m')
    await page.getByRole('textbox', { name: '新评论内容', exact: true }).fill('格式切换后仍应关联这句话'); await page.keyboard.press('Control+Enter'); await page.locator('.comment-card').waitFor()
    await select('引用保留'); await menu('段落', '引用'); assert.equal(await page.locator('.ProseMirror blockquote').count(), 1)
    await menu('段落', '引用'); assert.equal(await page.locator('.ProseMirror blockquote').count(), 0)
    assert.equal(await page.locator('.ProseMirror strong').innerText(), '加粗')
    await page.keyboard.press('Control+2'); await page.keyboard.press('Control+2')
    await menu('段落', '任务清单'); await menu('段落', '任务清单')
    assert.equal(await page.locator('.comment-mark').innerText(), '引用保留')
    await page.keyboard.press('Control+s'); await pause()
    const saved = JSON.parse(await fs.readFile(fixture + '.moye-comments.json', 'utf8'))
    assert.equal(saved.threads[0].anchor.state, 'attached'); assert.equal(saved.threads[0].anchor.currentQuote, '引用保留')
    await capture('comments-retained')
  })
  await test('查找、快速打开、评论输入和中文组合输入不改变正文；长按不反复切换', async () => {
    await select('标题切换中文😀', true); const before = await richText()
    await page.keyboard.press('Control+f'); const find = page.getByRole('textbox', { name: '查找内容', exact: true }); await find.fill('标题'); await page.keyboard.press('Control+1'); await page.keyboard.press('Control+b'); assert.equal(await richText(), before)
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+p'); await page.getByRole('textbox', { name: '快速打开搜索' }).fill('不存在'); await page.keyboard.press('Control+2'); assert.equal(await richText(), before); await page.keyboard.press('Escape')
    const reply = page.getByRole('textbox', { name: '回复内容', exact: true }); await reply.fill('评论输入'); await page.keyboard.press('Control+1'); assert.equal(await richText(), before); await reply.fill('')
    await select('标题切换中文😀', true)
    await page.locator('.ProseMirror').dispatchEvent('keydown', { key: '1', ctrlKey: true, isComposing: true }); assert.equal(await page.locator('.ProseMirror > p').filter({ hasText: '标题切换中文😀' }).count(), 1)
    await page.keyboard.press('Control+1'); await page.locator('.ProseMirror').dispatchEvent('keydown', { key: '1', ctrlKey: true, repeat: true }); assert.equal(await page.locator('.ProseMirror h1').filter({ hasText: '标题切换中文😀' }).count(), 1); await page.keyboard.press('Control+1')
  })
  await test('代码编辑区域中标题快捷键与菜单不改代码', async () => {
    const content = page.locator('.milkdown-code-block .cm-content'); await content.click(); const before = await content.innerText()
    await page.keyboard.press('Control+1'); await menu('段落', '一级标题'); assert.equal(await content.innerText(), before); assert.equal(await page.locator('.milkdown-code-block').count(), 1)
  })
  await test('源码 H5/H6、加粗重复取消和撤销；选中多行列表逐行处理', async () => {
    await sourceMode(); const source = page.locator('.source-editor .cm-content'); await source.click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Control+6')
    assert.match(await sourceText(), /^###### 格式切换验收/); await page.keyboard.press('Control+6'); assert.match(await sourceText(), /^格式切换验收/)
    await page.keyboard.press('Control+z'); assert.match(await sourceText(), /^###### 格式切换验收/); await page.keyboard.press('Control+0')
    await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); await page.keyboard.press('Control+b'); assert.match(await sourceText(), /^\*\*格式切换验收\*\*/); await page.keyboard.press('Control+b'); assert.match(await sourceText(), /^格式切换验收\n/)
    await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.down('Shift'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('End'); await page.keyboard.up('Shift')
    const before = await sourceText(); await menu('段落', '无序列表'); const after = await sourceText(); assert.ok(after.includes('- 标题切换中文😀')); assert.ok(after.includes('- 列表转换保留原文'))
    await menu('段落', '无序列表'); assert.equal(await sourceText(), before); await page.keyboard.press('Control+z'); assert.equal(await sourceText(), after); await menu('段落', '无序列表')
    await page.keyboard.press('Control+Home'); await page.keyboard.press('Control+1'); await sourceMode(); await page.locator('.ProseMirror h1').filter({ hasText: '格式切换验收' }).waitFor()
  })
  assert.deepEqual(errors, [])
  const executable = process.env.MOYE_EXECUTABLE || null, archive = executable ? path.join(path.dirname(executable), 'resources/app.asar') : null
  await fs.writeFile(path.join(root, 'format-results.json'), JSON.stringify({ version: await app.evaluate(({ app }) => app.getVersion()), executable, asarSha256: archive ? createHash('sha256').update(await fs.readFile(archive)).digest('hex') : null, results, errors, productAcceptance: 'pending' }, null, 2))
  console.log('FORMAT PASSED:', root)
} catch(error) { console.error(error); await fs.writeFile(path.join(root, 'failure.txt'), String(error.stack || error)); await capture('failure').catch(() => {}); process.exitCode = 1 }
finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
