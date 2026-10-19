import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
await fs.mkdir('test-results', { recursive: true })
const root = await fs.mkdtemp(path.resolve('test-results/comments-e2e-')), profile = path.join(root, 'profile'), fixture = path.join(root, '批注验收.md')
const original = '\uFEFF---\r\ntitle: 批注测试\r\n---\r\n\r\n# 一起把文字写好\r\n\r\n这是需要仔细考虑的句子。中文😀与 **格式** 一起保留。\r\n\r\n第二段作为跨段落测试。\r\n\r\n- 列表也可以批注\r\n\r\n```\r\n代码不建立范围批注\r\n```\r\n'
await fs.mkdir(profile, { recursive: true }); await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ autoSave: false, theme: 'paper', sidebar: true })); await fs.writeFile(fixture, original)
const env = { ...process.env, MOYE_TEST: '1', MOYE_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.MOYE_DEV_URL
let app, page; const results = [], errors = [], colors = []
const ready = () => page.locator('.editor-loading').waitFor({ state: 'detached', timeout: 60000 })
const wait = async (fn, message) => { const start = Date.now(); while (Date.now() - start < 15000) { try { if (await fn()) return } catch {} await new Promise(r => setTimeout(r, 80)) } throw new Error(message) }
const disk = () => fs.readFile(fixture + '.moye-comments.json', 'utf8').then(JSON.parse)
const test = async (name, fn) => { await fn(); results.push(name); console.log('PASS', name) }
async function launch() {
  const flags = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', fixture]
  app = await electron.launch({ ...(process.env.MOYE_EXECUTABLE ? { executablePath: process.env.MOYE_EXECUTABLE, args: flags } : { args: ['.', ...flags] }), env, timeout: 60000 })
  page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message)); await ready()
}
async function select(text) {
  await page.evaluate(text => {
    const root = document.querySelector('.ProseMirror'); root.focus()
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while(walker.nextNode()) { const node = walker.currentNode, start = node.textContent.indexOf(text); if(start >= 0) { const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); return } }
    throw new Error('Selection missing: ' + text)
  }, text)
  await page.waitForTimeout(80)
}
async function post(text) { await page.getByRole('textbox', { name: '新评论内容', exact: true }).fill(text); await page.keyboard.press('Control+Enter') }
async function capture(name) { const image = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')); await fs.writeFile(path.join(root, name + '.png'), Buffer.from(image, 'base64')) }
try {
  await launch(); await page.locator('.ProseMirror h1').filter({ hasText: '一起把文字写好' }).waitFor()
  await test('范围评论发布与独立保存，原文 BOM/CRLF 字节不变', async () => {
    await select('需要仔细考虑的句子'); await page.keyboard.press('Control+Alt+m'); await post('这一句需要补充论据。')
    await wait(async () => (await disk()).threads.length === 1, 'First comment missing')
    assert.equal(await fs.readFile(fixture, 'utf8'), original)
    assert.equal((await disk()).threads[0].anchor.currentQuote, '需要仔细考虑的句子')
    assert.equal(Math.round((await page.locator('.comment-sidebar').boundingBox()).width), 300)
    assert.equal(await page.locator('.sidebar').count(), 1); assert.ok(await page.locator('.comment-mark').count())
  })
  await test('评论输入快捷键不改变正文，回复与解决/重开保存', async () => {
    const box = page.getByRole('textbox', { name: '回复内容', exact: true }); await box.fill('同意，添加一个例子。'); await page.keyboard.press('Control+b'); await page.keyboard.press('Control+Enter')
    await wait(async () => (await disk()).threads[0].messages.length === 2, 'Reply missing'); assert.equal(await fs.readFile(fixture, 'utf8'), original)
    await page.getByRole('button', { name: '解决评论', exact: true }).click(); await wait(async () => (await disk()).threads[0].status === 'resolved', 'Resolve missing')
    await page.getByLabel('评论筛选').selectOption('resolved'); await page.getByRole('button', { name: '重新打开评论', exact: true }).click(); await page.getByLabel('评论筛选').selectOption('open')
    await wait(async () => (await disk()).threads[0].status === 'open', 'Reopen missing')
  })
  await test('修改与删除评论可撤销，发布组合输入不误触', async () => {
    await page.getByRole('button', { name: '评论操作', exact: true }).first().click(); await page.locator('.comment-sidebar').getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByRole('textbox', { name: '编辑评论内容' }).fill('补充可验证的论据。'); await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await wait(async () => (await disk()).threads[0].messages[0].body === '补充可验证的论据。', 'Edit missing')
    await page.getByRole('textbox', { name: '回复内容', exact: true }).fill('删除时的未发送回复')
    await page.getByRole('button', { name: '评论操作', exact: true }).first().click(); await page.getByRole('button', { name: '删除整条评论', exact: true }).click(); await page.getByRole('button', { name: '撤销删除' }).click()
    assert.equal(await page.locator('.comment-card').count(), 1)
    assert.equal(await page.getByRole('textbox', { name: '回复内容', exact: true }).inputValue(), '删除时的未发送回复'); await page.getByRole('textbox', { name: '回复内容', exact: true }).fill('')
  })
  await test('前方输入跟随，整段删除失联，撤销恢复；自动保存关闭时不偷存正文', async () => {
    await select('这是'); await page.keyboard.press('ArrowLeft'); await page.keyboard.insertText('新加的开头。')
    await select('需要仔细考虑的句子'); await page.keyboard.press('Backspace'); await page.getByText('原文已变化，需要重新关联', { exact: true }).waitFor()
    assert.equal(await fs.readFile(fixture, 'utf8'), original)
    await page.keyboard.press('Control+z'); await page.waitForFunction(() => !document.querySelector('.comment-detached')); assert.ok(await page.locator('.comment-mark').count())
    await page.keyboard.press('Control+s'); await wait(async () => (await fs.readFile(fixture, 'utf8')).includes('新加的开头。'), 'Body not saved')
  })
  await test('高亮点开，收起保留草稿，重启恢复未发送输入', async () => {
    await page.getByRole('button', { name: '收起评论栏', exact: true }).click(); assert.equal(await page.locator('.comment-sidebar').isVisible(), false)
    await page.locator('.comment-mark').first().click(); await page.locator('.comment-sidebar').waitFor({ state: 'visible' })
    await select('第二段作为跨段落测试'); await page.keyboard.press('Control+Alt+m'); await page.getByRole('textbox', { name: '新评论内容', exact: true }).fill('还没有发送的想法')
    await page.getByRole('textbox', { name: '新评论内容' }).dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true }); assert.equal(await page.locator('.comment-card').count(), 1)
    await page.getByRole('button', { name: '收起评论栏' }).click(); await page.getByRole('button', { name: '评论栏', exact: true }).click(); assert.equal(await page.getByRole('textbox', { name: '新评论内容' }).inputValue(), '还没有发送的想法')
    await wait(async () => JSON.parse(await fs.readFile(path.join(profile, 'draft.json'), 'utf8')).commentDraft.text === '还没有发送的想法', 'Recovery draft missing')
    await app.evaluate(({ app }) => app.exit(0)); await launch(); await page.getByRole('button', { name: '恢复文稿', exact: true }).click(); await ready()
    assert.equal(await page.getByRole('textbox', { name: '新评论内容' }).inputValue(), '还没有发送的想法'); await page.getByRole('textbox', { name: '新评论内容' }).fill(''); await page.getByRole('button', { name: '收起新评论输入' }).click(); await page.keyboard.press('Control+s')
  })
  await test('源码模式全文评论与模式往返、另存为复制和取消', async () => {
    await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+/'); await ready(); await page.getByRole('button', { name: '添加评论', exact: true }).first().click(); await post('全文备忘。')
    await page.locator('.source-editor').click(); await page.keyboard.press('Control+/'); await ready()
    await page.keyboard.press('Control+s'); await wait(async () => (await disk()).threads.length === 2, 'Whole comment missing')
    const copy = path.join(root, '批注副本.md'); await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, copy)
    await page.keyboard.press('Control+Shift+s'); await wait(async () => !!(await fs.stat(copy + '.moye-comments.json')), 'Save as missing')
    const copied = JSON.parse(await fs.readFile(copy + '.moye-comments.json', 'utf8')); assert.notEqual(copied.documentId, (await disk()).documentId); assert.equal(copied.threads.length, 2)
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }) }); await page.keyboard.press('Control+Shift+s')
    assert.equal((await disk()).threads.length, 2)
  })
  await test('实际 IPC 部分保存失败可重试，保存时继续编辑保留新快照', async () => {
    const copy = path.join(root, '批注副本.md'), sidecar = copy + '.moye-comments.json'
    await select('第二段'); await page.keyboard.press('ArrowRight'); await page.keyboard.insertText('正文保存成功')
    await app.evaluate(() => {
      const fs = process.getBuiltinModule('fs').promises
      globalThis.originalRename = fs.rename
      fs.rename = async (from, to) => { if (to.endsWith('.moye-comments.json')) { const e = new Error('模拟评论文件只读'); e.code = 'EACCES'; throw e } return globalThis.originalRename(from, to) }
    })
    await page.keyboard.press('Control+s'); await page.getByText('正文已保存，评论待重试', { exact: true }).waitFor()
    assert.ok((await fs.readFile(copy, 'utf8')).includes('正文保存成功')); assert.ok(await fs.stat(path.join(profile, 'draft.json')))
    await app.evaluate(() => { process.getBuiltinModule('fs').promises.rename = globalThis.originalRename })
    await page.keyboard.press('Control+s'); await wait(async () => JSON.parse(await fs.readFile(sidecar, 'utf8')).markdownHash === createHash('sha256').update(await fs.readFile(copy)).digest('hex'), 'Retry not acknowledged')
    // Delay only the sidecar rename, then type while the captured body is saving.
    await app.evaluate(() => {
      const fs = process.getBuiltinModule('fs').promises
      globalThis.renameWaiting = false
      fs.rename = async (from, to) => { if (to.endsWith('.moye-comments.json')) { globalThis.renameWaiting = true; await new Promise(resolve => { globalThis.releaseRename = resolve }) } return globalThis.originalRename(from, to) }
    })
    await select('第二段'); await page.keyboard.press('ArrowRight'); await page.keyboard.insertText('快照甲')
    await page.keyboard.press('Control+s'); await wait(() => app.evaluate(() => globalThis.renameWaiting), 'Delayed rename not reached')
    await page.keyboard.insertText('较新的乙')
    await app.evaluate(() => { process.getBuiltinModule('fs').promises.rename = globalThis.originalRename; globalThis.releaseRename() })
    await wait(async () => (await fs.readFile(path.join(profile, 'draft.json'), 'utf8')).includes('较新的乙'), 'Newer recovery snapshot lost')
    assert.ok(!(await fs.readFile(copy, 'utf8')).includes('较新的乙')); assert.ok(await page.locator('.dirty-dot').count())
    await page.keyboard.press('Control+s'); await wait(async () => (await fs.readFile(copy, 'utf8')).includes('较新的乙'), 'Newer edit missing after save')
  })
  await test('评论外部变化与损坏不静默覆盖，明确载入磁盘版本', async () => {
    const copy = path.join(root, '批注副本.md'), sidecar = copy + '.moye-comments.json'
    await page.waitForTimeout(700)
    let value = JSON.parse(await fs.readFile(sidecar, 'utf8')); value.threads[0].messages[0].body = '外部修改的评论'
    await fs.writeFile(sidecar, JSON.stringify(value)); await page.getByText('外部修改的评论', { exact: true }).waitFor()
    await select('第二段'); await page.keyboard.press('ArrowRight'); await page.keyboard.insertText('尚未保存的冲突文本')
    value.threads[0].messages[0].body = '应保留的外部批注'; const external = JSON.stringify(value); await fs.writeFile(sidecar, external)
    await page.locator('.conflict-banner').waitFor(); await page.keyboard.press('Control+s'); await page.waitForTimeout(300)
    assert.equal(await fs.readFile(sidecar, 'utf8'), external); assert.ok(!(await fs.readFile(copy, 'utf8')).includes('尚未保存的冲突文本'))
    await page.locator('.conflict-banner').getByRole('button', { name: '载入磁盘版本', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '载入磁盘版本', exact: true }).click(); await ready(); await page.getByText('应保留的外部批注', { exact: true }).waitFor()
    await fs.writeFile(sidecar, '{ damaged json'); await page.locator('.comment-error').waitFor()
    await page.keyboard.press('Control+s'); await page.waitForTimeout(300); assert.equal(await fs.readFile(sidecar, 'utf8'), '{ damaged json')
    await fs.writeFile(sidecar, external); await page.locator('.comment-error').waitFor({ state: 'detached' }); await ready()
  })
  await test('三种主题、300–440 宽度及最小窗口抽屉', async () => {
    for (const [name, label] of [['paper', '暖纸'], ['light', '素白'], ['dark', '深夜']]) {
      await page.getByRole('navigation', { name: '主菜单' }).getByRole('button', { name: '主题', exact: true }).click(); await page.getByRole('menuitemradio', { name: label, exact: true }).click(); await page.locator('.dropdown').waitFor({ state: 'detached' }); await page.waitForTimeout(100); await capture(name)
      const measured = await page.evaluate(() => {
        const rgb = s => s.match(/[\d.]+/g).map(Number), lum = a => a.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)
        return ['.comment-body','.comment-quote','.comment-byline time','.comment-avatar','.comment-footer','.comment-filter button'].map(selector => {
          const el=document.querySelector(selector), style=getComputedStyle(el); let bg
          for(let n=el;n;n=n.parentElement){const value=rgb(getComputedStyle(n).backgroundColor);if((value[3]??1)===1){bg=value;break}}
          const fg=rgb(style.color), a=lum(fg), b=lum(bg);return {selector,foreground:style.color,background:bg.slice(0,3),contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
        })
      }); colors.push({theme:name, samples:measured}); assert.ok(measured.every(s=>s.contrast>=4.5), JSON.stringify(measured))
    }
    const separator = page.getByRole('separator', { name: '评论栏宽度' }); await separator.focus(); await page.keyboard.press('ArrowLeft'); assert.equal(await separator.getAttribute('aria-valuenow'), '310')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 600)); await page.waitForFunction(() => document.querySelector('.comment-sidebar').classList.contains('as-drawer')); await capture('narrow')
    await page.getByRole('button', { name: '收起评论栏' }).focus(); await page.keyboard.press('Escape'); assert.equal(await page.getByRole('button', { name: '评论栏', exact: true }).evaluate(el => el === document.activeElement), true)
  })
  assert.deepEqual(errors, [])
  console.log(`PASS ${results.length} comments scenarios; artifacts: ${root}`)
} catch (error) { console.error(error); console.log((await page?.locator('body').innerText())?.slice(-9000)); await capture('failure').catch(() => {}); process.exitCode = 1 }
finally { await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ passed: results, errors, colors }, null, 2)); await app?.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
