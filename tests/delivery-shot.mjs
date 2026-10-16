import { _electron as electron } from 'playwright'
import path from 'node:path'
import fs from 'node:fs/promises'
const profile = await fs.mkdtemp(path.resolve('test-results/preview-'))
const env = { ...process.env, MOYE_TEST: '1', MOYE_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.resolve('../../outputs/Moye-win32-x64/Moye.exe'), args: [], env })
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false))
  await page.locator('.ProseMirror').waitFor()
  await page.locator('.editor-loading').waitFor({ state: 'detached' })
  const capture = async file => { const bytes = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64')); await fs.writeFile(path.resolve('../../outputs', file), Buffer.from(bytes, 'base64')) }
  await app.evaluate(async ({ BrowserWindow }) => { await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }) })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await capture('Moye-preview.png')
  await page.getByRole('button', { name: '切换明暗主题' }).click()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.outline-title')).backgroundColor === 'rgb(41, 61, 54)')
  await capture('Moye-dark.png')
  console.log('Packaged screenshots saved')
} finally { await app.evaluate(({ app }) => app.exit(0)) }
