import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
const root = path.resolve('test-results/smoke')
await fs.mkdir(root, { recursive: true })
const env = { ...process.env, MOYE_TEST: '1', MOYE_USER_DATA: path.join(root, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env, timeout: 60000 })
try {
  const page = await app.firstWindow()
  page.on('pageerror', e => console.log('PAGE ERROR', e.stack))
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR', m.text()) })
  await page.locator('.ProseMirror').waitFor({ timeout: 60000 })
  await page.locator('.editor-loading').waitFor({ state: 'detached', timeout: 60000 })
  console.log('INIT', await page.evaluate(async () => { try { return await window.moye.init() } catch (e) { return String(e) } }))
  await page.screenshot({ path: path.join(root, 'welcome.png') })
  console.log(await page.locator('body').innerText())
  console.log('SMOKE OK')
} finally { await app.evaluate(({ app }) => app.exit(0)) }
