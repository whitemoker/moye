import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
const root = await fs.mkdtemp(path.resolve('test-results/context-'))
const env = { ...process.env, MOYE_TEST: '1', MOYE_USER_DATA: path.join(root, 'profile') }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ ...(process.env.MOYE_EXECUTABLE ? { executablePath: process.env.MOYE_EXECUTABLE, args: [] } : { args: ['.'] }), env })
const page = await app.firstWindow(), errors = [], passed = []
page.on('pageerror', e => errors.push(e.message))
const context = page.getByRole('menu', { name: '文稿右键菜单' })
async function check(name, action) { await action(); passed.push(name); console.log('PASS', name) }
async function capture(name) {
  await app.evaluate(async ({ BrowserWindow }) => { await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }) })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'))
  await fs.writeFile(path.join(root, name), Buffer.from(png, 'base64'))
}
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false))
  const p = page.locator('.ProseMirror blockquote p').first()
  await p.waitFor(); await page.locator('.editor-loading').waitFor({ state: 'detached' })
  await p.scrollIntoViewIfNeeded()
  let box = await p.boundingBox(), selected
  await check('鼠标拖选后不出现格式工具栏', async () => {
    await page.mouse.move(box.x + 2, box.y + box.height / 2); await page.mouse.down()
    await page.mouse.move(box.x + 230, box.y + box.height / 2, { steps: 18 }); await page.mouse.up()
    selected = await page.evaluate(() => getSelection().toString())
    assert.ok(selected.length > 3)
    assert.equal(await page.locator('.milkdown-toolbar').count(), 0)
    assert.equal(await context.count(), 0)
  })
  await check('右键打开格式菜单且保留原选区', async () => {
    await page.mouse.click(box.x + 50, box.y + box.height / 2, { button: 'right' })
    await context.waitFor()
    assert.equal(await page.evaluate(() => getSelection().toString()), selected)
    assert.equal(await context.getByRole('menuitemcheckbox').count(), 6)
  })
  await check('右键加粗只影响原选中的文字，并显示启用状态', async () => {
    await context.getByRole('menuitemcheckbox', { name: /加粗/ }).click()
    await context.waitFor({ state: 'detached' })
    assert.equal(await p.locator('strong').innerText(), selected)
    box = await p.boundingBox()
    await page.mouse.click(box.x + 50, box.y + box.height / 2, { button: 'right' }); await context.waitFor()
    assert.equal(await context.getByRole('menuitemcheckbox', { name: /加粗/ }).getAttribute('aria-checked'), 'true')
    await page.keyboard.press('Escape'); await context.waitFor({ state: 'detached' })
    await page.keyboard.press('Control+z')
    assert.equal(await p.locator('strong').count(), 0)
  })
  await check('插入链接沿用所选文字，取消后不改文稿', async () => {
    await page.mouse.click(box.x + 50, box.y + box.height / 2, { button: 'right' }); await context.waitFor()
    await context.getByRole('menuitemcheckbox', { name: /插入链接/ }).click()
    assert.equal(await page.getByLabel('显示文字', { exact: true }).inputValue(), selected)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal(await p.locator('a').count(), 0)
  })
  await check('右键斜体、删除线、代码与公式作用于所选文字', async () => {
    for (const [label, tag] of [['斜体', 'em'], ['删除线', 'del'], ['行内代码', 'code'], ['行内公式', '[data-type="math_inline"]']]) {
      box = await p.boundingBox()
      await page.mouse.move(box.x + 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + 230, box.y + box.height / 2, { steps: 12 }); await page.mouse.up()
      const expected = await page.evaluate(() => getSelection().toString())
      await page.mouse.click(box.x + 50, box.y + box.height / 2, { button: 'right' }); await context.waitFor()
      await context.getByRole('menuitemcheckbox', { name: new RegExp(label) }).click()
      await p.locator(tag).waitFor()
      if (label === '行内公式') assert.equal(await p.locator(tag).getAttribute('data-value'), expected)
      else assert.equal(await p.locator(tag).innerText(), expected)
      await page.keyboard.press('Escape'); await page.keyboard.press('Control+z')
      assert.equal(await p.locator(tag).count(), 0)
    }
  })
  await check('表格右键同时保留格式和增删行列操作', async () => {
    const table = page.locator('.ProseMirror table.children').first(), cell = table.locator('td').first()
    await cell.scrollIntoViewIfNeeded(); await cell.click(); await cell.click({ button: 'right' }); await context.waitFor()
    assert.ok(await context.getByRole('menuitemcheckbox', { name: /加粗/ }).isVisible())
    const count = await table.locator('tr').count()
    await context.getByRole('menuitem', { name: '下方插入行', exact: false }).click()
    assert.equal(await table.locator('tr').count(), count + 1)
    await page.keyboard.press('Control+z')
  })
  await check('源码选区右键加粗插入 Markdown 标记', async () => {
    await page.keyboard.press('Control+/'); await page.locator('.source-editor .cm-content').waitFor()
    const source = page.locator('.source-editor .cm-content')
    await source.click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight')
    await page.keyboard.down('Shift'); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift')
    const text = await page.evaluate(() => getSelection().toString())
    assert.ok(text.length > 0)
    const point = await page.evaluate(() => { const rect = getSelection().getRangeAt(0).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } })
    await page.mouse.click(point.x, point.y, { button: 'right' })
    await context.waitFor(); await context.getByRole('menuitemcheckbox', { name: /加粗/ }).click()
    assert.ok((await source.innerText()).includes(`**${text}**`))
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+/')
    await p.waitFor()
  })
  await check('右键菜单在深色主题可见，点击正文可关闭', async () => {
    await page.getByRole('button', { name: '写作设置' }).click()
    await page.locator('.theme-card-dark').click()
    await page.getByRole('button', { name: '关闭面板' }).click()
    await p.scrollIntoViewIfNeeded(); box = await p.boundingBox()
    await page.mouse.move(box.x + 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + 220, box.y + box.height / 2, { steps: 10 }); await page.mouse.up()
    await page.mouse.click(box.x + 50, box.y + box.height / 2, { button: 'right' }); await context.waitFor()
    const bounds = await context.boundingBox(), viewport = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    assert.ok(bounds.y + bounds.height <= viewport.height)
    await capture('context-dark.png')
    await p.click(); await context.waitFor({ state: 'detached' })
    assert.equal(await page.locator('.milkdown-toolbar').count(), 0)
    await page.getByRole('button', { name: '写作设置' }).click()
    await page.locator('.theme-card-light').click()
    await page.getByRole('button', { name: '关闭面板' }).click()
    await page.mouse.click(box.x + 50, box.y + box.height / 2, { button: 'right' }); await context.waitFor()
    await capture('context-light.png')
  })
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ version: await app.evaluate(({ app }) => app.getVersion()), passed, errors }, null, 2))
  console.log('CONTEXT PASSED:', root)
} catch (error) {
  console.error(error); process.exitCode = 1
  await capture('failure.png').catch(() => {})
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ passed, errors, failure: String(error) }, null, 2))
} finally { await app.evaluate(({ app }) => app.exit(0)) }
