import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
const root = await fs.mkdtemp(path.resolve('test-results/saving-windows-'))
const profile = path.join(root, 'profile'), documents = path.join(root, 'documents'), other = path.join(root, 'chosen-folder')
const env = { ...process.env, MOYE_TEST: '1', MOYE_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: process.env.MOYE_EXECUTABLE, args: ['--disable-backgrounding-occluded-windows'], env, timeout: 60000 })
const page = await app.firstWindow(), passed = [], errors = [], observations = {}
page.on('pageerror', error => errors.push(error.message))
async function check(name, action) { await action(); passed.push(name); console.log('PASS', name) }
async function ready() { await page.locator('.editor-loading').waitFor({ state: 'detached' }) }
async function saveOptions() { return app.evaluate(() => globalThis.moyeSaveOptions) }
async function source(text) { await page.locator('.source-editor .cm-content').click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(text); await page.waitForTimeout(100) }
async function capture(name) {
  await app.evaluate(async ({ BrowserWindow }) => { await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }) })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'))
  await fs.writeFile(path.join(root, name), Buffer.from(png, 'base64'))
}
async function registry() {
  return app.evaluate(async () => {
    const child = process.getBuiltinModule('child_process'), util = process.getBuiltinModule('util')
    const script = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $choice=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\UserChoice'); $ext=[Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey('.md'); $icon=[Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey('.md\\DefaultIcon'); $open=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Classes\\Moye.Markdown\\shell\\open\\command'); [pscustomobject]@{choice=if($choice){$choice.GetValue('ProgId')}else{$null}; default=if($ext){$ext.GetValue('')}else{$null}; icon=if($icon){$icon.GetValue('')}else{$null}; command=if($open){$open.GetValue('')}else{$null}} | ConvertTo-Json -Compress`
    const result = await util.promisify(child.execFile)('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true })
    return JSON.parse(result.stdout.trim())
  })
}
try {
  await app.evaluate(async ({ app, dialog, BrowserWindow }, { documents, other }) => {
    const fs = process.getBuiltinModule('fs').promises
    await fs.mkdir(documents, { recursive: true }); await fs.mkdir(other, { recursive: true })
    app.setPath('documents', documents)
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
    globalThis.moyeSaveOptions = []
    dialog.showSaveDialog = async (_, options) => {
      globalThis.moyeSaveOptions.push(options)
      if (globalThis.moyeCancelSave) return { canceled: true }
      return { canceled: false, filePath: globalThis.moyeNextSavePath || options.defaultPath }
    }
  }, { documents, other })
  await page.locator('.ProseMirror').waitFor(); await ready(); await page.keyboard.press('Control+n'); await page.keyboard.press('Control+/'); await ready()
  await check('首次保存以标题建议文件名，并实际保存到该文件', async () => {
    await source('# Archery MCP 协作备忘录\n\n这是一篇测试文稿。')
    await page.keyboard.press('Control+s')
    await page.waitForFunction(() => document.querySelector('.save-status').textContent.includes('已保存'))
    const options = await saveOptions(); observations.heading = options.at(-1).defaultPath
    assert.equal(options.at(-1).defaultPath, path.join(documents, 'Archery MCP 协作备忘录.md'))
    assert.equal(await fs.readFile(options.at(-1).defaultPath, 'utf8'), '# Archery MCP 协作备忘录\n\n这是一篇测试文稿。')
    await capture('saved-title.png')
  })
  await check('修改标题后另存为仍保留原文件名，取消不写文件', async () => {
    await source('# 修改后的标题\n\n新的内容。')
    await app.evaluate(() => { globalThis.moyeCancelSave = true })
    await page.keyboard.press('Control+Shift+s'); await page.waitForTimeout(150)
    const options = await saveOptions(); observations.saveAs = options.at(-1).defaultPath
    assert.equal(options.at(-1).defaultPath, path.join(documents, 'Archery MCP 协作备忘录.md'))
    assert.ok((await fs.readFile(options.at(-1).defaultPath, 'utf8')).includes('这是一篇测试文稿。'))
    await app.evaluate(() => { globalThis.moyeCancelSave = false })
    await source('# Archery MCP 协作备忘录\n\n这是一篇测试文稿。')
    await page.keyboard.press('Control+s'); await page.waitForFunction(() => document.querySelector('.save-status').textContent.includes('已保存'))
  })
  await check('同名新文稿建议编号，原文件不被覆盖', async () => {
    await page.keyboard.press('Control+n'); await ready(); await source('# Archery MCP 协作备忘录\n\n第二份。')
    await page.keyboard.press('Control+s'); await page.waitForFunction(() => document.querySelector('.save-status').textContent.includes('已保存'))
    const options = await saveOptions(); observations.collision = options.at(-1).defaultPath
    assert.equal(options.at(-1).defaultPath, path.join(documents, 'Archery MCP 协作备忘录 (2).md'))
    assert.ok((await fs.readFile(path.join(documents, 'Archery MCP 协作备忘录.md'), 'utf8')).includes('这是一篇测试文稿。'))
  })
  await check('记住用户上次保存的目录，无标题时取首段文字', async () => {
    await app.evaluate((_, filePath) => { globalThis.moyeNextSavePath = filePath }, path.join(other, '另一处.md'))
    await page.keyboard.press('Control+Shift+s'); await page.waitForTimeout(150)
    await app.evaluate(() => { globalThis.moyeNextSavePath = null })
    await page.keyboard.press('Control+n'); await ready(); await source('项目会议记录\n\n没有标题的文稿。')
    await page.keyboard.press('Control+s'); await page.waitForFunction(() => document.querySelector('.save-status').textContent.includes('已保存'))
    const options = await saveOptions(); observations.firstParagraph = options.at(-1).defaultPath
    assert.equal(options.at(-1).defaultPath, path.join(other, '项目会议记录.md'))
  })
  await check('空文稿仍提供可用默认名，帮助中包含保存命名说明', async () => {
    await page.keyboard.press('Control+n'); await ready()
    await app.evaluate(() => { globalThis.moyeCancelSave = true })
    await page.keyboard.press('Control+s'); await page.waitForTimeout(150)
    assert.equal(path.basename((await saveOptions()).at(-1).defaultPath), '未命名.md')
    await page.getByRole('navigation', { name: '主菜单' }).getByRole('button', { name: '帮助', exact: true }).click()
    await page.getByRole('menuitem', { name: '快捷键与使用说明', exact: true }).click()
    await page.getByText('首次保存会根据文稿标题或首段建议文件名', { exact: false }).waitFor()
    await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  })
  await check('注册 Windows 文稿图标与打开方式，默认打开程序保持原设置', async () => {
    observations.windowsBefore = await registry()
    await page.getByRole('button', { name: '写作设置', exact: true }).click()
    await page.getByRole('button', { name: '注册图标与打开方式', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '文件图标和打开方式已注册' }).waitFor({ timeout: 45000 })
    observations.windowsAfter = await registry()
    assert.equal(observations.windowsAfter.choice, observations.windowsBefore.choice)
    assert.equal(observations.windowsAfter.default, observations.windowsBefore.default)
    assert.ok(observations.windowsAfter.command.includes(process.env.MOYE_EXECUTABLE))
    if (!observations.windowsBefore.choice && !observations.windowsBefore.default && !observations.windowsBefore.icon) assert.ok(observations.windowsAfter.icon.includes('document.ico'))
    await capture('windows-integration.png')
    await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  })
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ version: await app.evaluate(({ app }) => app.getVersion()), passed, errors, observations }, null, 2))
  console.log(`SAVING WINDOWS ${passed.length} passed: ${root}`)
} catch (error) {
  console.error(error)
  await capture('failure.png').catch(() => {})
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ passed, errors, observations, failure: String(error) }, null, 2))
  process.exitCode = 1
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
