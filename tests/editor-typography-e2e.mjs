import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const baseline = process.argv.includes('--baseline')
await fs.mkdir('test-results', { recursive: true })
const root = await fs.mkdtemp(path.resolve(`test-results/typography-${baseline ? 'before' : 'after'}-`))
const profile = path.join(root, 'profile'), fixture = path.join(root, '清单与标题验收.md')
const original = '# 一级标题：写作计划\n\n## 二级标题：安排本周工作\n\n### 三级标题：整理需求\n\n#### 四级标题：检查细节\n\n##### 五级标题：保留记录\n\n###### 六级标题：完成验收\n\n正文保持原来的字号和颜色。\n\n- [ ] 这一项可以试试取消任务清单。\n- [x] 已完成的事项也与文字对齐。\n- [ ] 多行任务：这里是一段较长的合成文字，用来检查任务框是否始终与第一行对齐，而不是随着整个段落的高度居中。继续补充一些文字，确保在较小字号下也会自然换行。\n  - [ ] 嵌套任务：检查下一层的方框位置。\n\n- 普通无序列表与第一行对齐。\n\n1. 普通有序列表与第一行对齐。\n\n末尾正文。\n'
await fs.mkdir(profile, { recursive: true })
await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ autoSave: false, theme: 'paper', sidebar: false, fontSize: 16, width: 820, serif: false }))
await fs.writeFile(fixture, original)
const env = { ...process.env, MOYE_TEST: '1', MOYE_USER_DATA: profile }
delete env.ELECTRON_RUN_AS_NODE; delete env.MOYE_DEV_URL
const flags = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
const app = await electron.launch({ ...(process.env.MOYE_EXECUTABLE ? { executablePath: process.env.MOYE_EXECUTABLE, args: [fixture, ...flags] } : { args: ['.', fixture, ...flags] }), env, timeout: 60000 })
const page = await app.firstWindow(), results = [], errors = [], checks = []
page.on('pageerror', error => errors.push(error.message))
const pause = () => page.waitForTimeout(100)
async function capture(name, clip) {
  let image
  for (let i = 0; i < 3; i++) {
    image = await app.evaluate(async ({ BrowserWindow }, clip) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(clip, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'), clip)
    await pause()
  }
  await fs.writeFile(path.join(root, name + '.png'), Buffer.from(image, 'base64'))
}
async function settings(theme, fontSize, serif) {
  await page.getByRole('button', { name: '写作设置', exact: true }).click()
  await page.locator(`.theme-card-${theme}`).click()
  await page.locator('#font-size').fill(String(fontSize))
  const toggle = page.locator('.toggle-row').filter({ hasText: '衬线字体' }).locator('.toggle')
  if ((await toggle.getAttribute('class')).includes('on') !== serif) await toggle.click()
  await page.keyboard.press('Escape')
  await pause()
}
async function inspect(theme, fontSize, serif) {
  const facts = await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror')
    const center = rect => rect.top + rect.height / 2
    const headings = [...editor.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(el => ({ level: el.tagName, size: parseFloat(getComputedStyle(el).fontSize) }))
    const items = [...editor.querySelectorAll('li.list-item')].map(li => {
      const paragraph = li.querySelector(':scope > .children > .content-dom > p')
      const label = li.querySelector(':scope > .label-wrapper .label')
      const svg = label.querySelector('svg')
      const range = document.createRange(); range.setStart(paragraph.firstChild, 0); range.setEnd(paragraph.firstChild, 1)
      const textRect = range.getBoundingClientRect(), paragraphRect = paragraph.getBoundingClientRect()
      const css = getComputedStyle(paragraph), lineHeight = parseFloat(css.lineHeight)
      const firstLineCenter = paragraphRect.top + parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop) + lineHeight / 2
      let markerRect
      if (svg) markerRect = svg.getBoundingClientRect()
      else { const labelRange = document.createRange(); labelRange.selectNodeContents(label); markerRect = labelRange.getBoundingClientRect() }
      return {
        text: paragraph.textContent, kind: label.className, markerCenter: center(markerRect), textCenter: center(textRect), firstLineCenter,
        lineDelta: center(markerRect) - firstLineCenter, glyphDelta: center(markerRect) - center(textRect),
        lineHeight, paragraphHeight: paragraphRect.height, markerWidth: markerRect.width,
        paragraphMargin: css.marginTop, paragraphPadding: css.paddingTop,
        labelHeight: getComputedStyle(label).height, wrapperHeight: getComputedStyle(label.parentElement).height,
      }
    })
    return { headings, items }
  })
  results.push({ theme, fontSize, serif, ...facts })
  console.log(theme, fontSize, serif ? 'serif' : 'sans', JSON.stringify({ headings: facts.headings.map(x => x.size), lineDelta: facts.items.map(x => Number(x.lineDelta.toFixed(2))), glyphDelta: facts.items.map(x => Number(x.glyphDelta.toFixed(2))) }))
  if (!baseline) {
    assert.equal(facts.items.length, 6)
    assert.ok(facts.items[2].paragraphHeight > facts.items[2].lineHeight * 1.5, 'Long task must wrap')
    for (const item of facts.items) {
      assert.ok(Math.abs(item.lineDelta) <= 1.5, `Marker must align with first line: ${JSON.stringify(item)}`)
      assert.ok(Math.abs(item.glyphDelta) <= 2.5, `Marker must visually align with glyphs: ${JSON.stringify(item)}`)
    }
    assert.ok(facts.headings[0].size / facts.headings[1].size <= 1.2, 'H1/H2 gap exceeds 20%')
    for (let i = 1; i < facts.headings.length; i++) assert.ok(facts.headings[i].size < facts.headings[i - 1].size, 'Headings must get smaller at each level')
    assert.ok(facts.headings.at(-1).size >= fontSize, 'H6 must not be smaller than body')
  }
}
try {
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setSize(1240, 1000) })
  await page.locator('.editor-loading').waitFor({ state: 'detached', timeout: 60000 })
  await page.locator('.ProseMirror h6').waitFor()
  for (const theme of ['paper', 'light', 'dark']) {
    for (const serif of [false, true]) {
      for (const fontSize of [13, 16, 24]) {
        await settings(theme, fontSize, serif)
        await inspect(theme, fontSize, serif)
        if (fontSize === 16 && !serif) {
          await page.locator('.rich-editor').evaluate(el => el.scrollTop = 0)
          await capture(`${theme}-headings`)
          await page.locator('.ProseMirror li.list-item').first().scrollIntoViewIfNeeded()
          await capture(`${theme}-lists`)
          if (theme === 'paper') {
            const bounds = await page.locator('.ProseMirror li.list-item').first().boundingBox()
            const clip = { x: Math.floor(bounds.x - 10), y: Math.floor(bounds.y - 10), width: Math.ceil(bounds.width + 20), height: Math.ceil(bounds.height + 20) }
            await capture('paper-task-detail', clip)
          }
        }
      }
    }
  }
  if (!baseline) {
    await settings('paper', 16, false)
    const first = page.locator('.ProseMirror li.list-item').first()
    const before = await first.innerText()
    await first.locator(':scope > .label-wrapper').click()
    await first.locator(':scope > .label-wrapper .checked').waitFor()
    assert.equal(await first.innerText(), before)
    await page.keyboard.press('Control+z')
    await first.locator(':scope > .label-wrapper .unchecked').waitFor()
    assert.equal(await first.innerText(), before)
    checks.push('Checkbox toggles and one undo restores state without changing text')
    await page.keyboard.press('Control+/')
    await page.locator('.source-editor .cm-content').waitFor()
    assert.match(await page.locator('.source-editor .cm-content').innerText(), /- \[ \] 这一项可以试试取消任务清单。/)
    await page.keyboard.press('Control+/')
    await page.locator('.ProseMirror h6').waitFor()
    await inspect('paper-roundtrip', 16, false)
    checks.push('Source/rich round trip preserves task state and typography')
  }
  assert.equal(await fs.readFile(fixture, 'utf8'), original, 'Original fixture must not be rewritten')
  assert.deepEqual(errors, [])
  const executable = process.env.MOYE_EXECUTABLE || null, archive = executable ? path.join(path.dirname(executable), 'resources/app.asar') : null
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ baseline, version: await app.evaluate(({ app }) => app.getVersion()), executable, asarSha256: archive ? createHash('sha256').update(await fs.readFile(archive)).digest('hex') : null, results, checks, errors, productAcceptance: 'pending' }, null, 2))
  console.log('TYPOGRAPHY PASSED:', root)
} catch (error) {
  console.error(error); await fs.writeFile(path.join(root, 'failure.json'), JSON.stringify({ results, errors, failure: String(error.stack || error) }, null, 2)); await capture('failure').catch(() => {}); process.exitCode = 1
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
