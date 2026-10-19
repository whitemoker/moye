import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

// Measure rendered colors in the actual app, including focus-group opacity.
const baseline = process.argv.includes('--baseline')
await fs.mkdir('test-results', { recursive: true })
const root = await fs.mkdtemp(path.resolve(`test-results/code-contrast-${baseline ? 'before' : 'after'}-`))
const profile = path.join(root, 'profile'), fixture = path.join(root, '代码块验收.md')
const original = '# 代码块可读性\n\n普通正文：代码块里的文字也应清晰可读。\n\n```\n一个性价比很高的离线做法（我的建议）：\n让 LLM 定期扫描代码仓库中的日志打印语句。\n合并重复日志，保留业务含义与真实严重程度。\n```\n\n```python\n# 合并重复日志，保留原始记录\ndef merge_logs(items):\n    count = 42\n    message = "清晰的文字 / readable code"\n    return [item for item in items if item != None]\n```\n\n```javascript\n// 保留语法高亮和编辑能力\nconst message = "hello";\nconsole.log(message, 42, true);\n```\n\n末尾正文用于检查专注模式。\n'
await fs.mkdir(profile, { recursive: true })
await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ theme:'paper', autoSave:false, sidebar:false, focus:false, typewriter:false }))
await fs.writeFile(fixture, original)
const env = { ...process.env, MOYE_TEST:'1', MOYE_USER_DATA:profile }
delete env.ELECTRON_RUN_AS_NODE
delete env.MOYE_DEV_URL
const flags = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
const results = [], errors = []
let app, page
const ready = () => page.locator('.editor-loading').waitFor({ state:'detached' })
async function theme(label) {
  await page.getByRole('navigation', { name:'主菜单' }).getByRole('button', { name:'主题', exact:true }).click()
  await page.getByRole('menuitemradio', { name:label, exact:true }).click()
  await page.waitForFunction(() => !document.querySelector('.dropdown'))
}
async function inspect(block, name) {
  await block.scrollIntoViewIfNeeded()
  await block.locator('.cm-content').waitFor()
  // Language loading and focus decorations settle on the next paints.
  await page.waitForTimeout(150)
  const facts = await block.evaluate(el => {
    const rgb = s => s.match(/[\d.]+/g).map(Number)
    const blend = (fg,bg,a) => fg.slice(0,3).map((v,i)=>v*a+bg[i]*(1-a))
    const luminance = c => c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)
    const contrast = (a,b) => { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
    const appStyle=getComputedStyle(el.closest('.app')), bg=rgb(getComputedStyle(el).backgroundColor), pageBg=rgb(appStyle.backgroundColor)
    let opacity=1
    for(let n=el;n;n=n.parentElement)opacity*=Number(getComputedStyle(n).opacity)
    const walker=document.createTreeWalker(el.querySelector('.cm-content'),NodeFilter.SHOW_TEXT), samples=[]
    while(walker.nextNode()){
      const node=walker.currentNode;if(!node.textContent.trim())continue
      const fg=rgb(getComputedStyle(node.parentElement).color)
      const ancestors=[];for(let n=node.parentElement;n&&n!==el;n=n.parentElement)ancestors.unshift(n)
      let localBg=bg
      for(const n of ancestors){const layer=rgb(getComputedStyle(n).backgroundColor);localBg=blend(layer,localBg,layer[3]??1)}
      samples.push({ text:node.textContent, color:getComputedStyle(node.parentElement).color, ratio:contrast(blend(fg,pageBg,opacity),blend(localBg,pageBg,opacity)) })
    }
    const cm=el.querySelector('.cm-editor'), gutter=el.querySelector('.cm-gutters')
    return { color:getComputedStyle(cm).color, background:getComputedStyle(el).backgroundColor, opacity, gutter:getComputedStyle(gutter).color, activeGutter:getComputedStyle(el.querySelector('.cm-activeLineGutter')||gutter).backgroundColor, caret:getComputedStyle(el.querySelector('.cm-content')).caretColor, samples, minContrast:Math.min(...samples.map(x=>x.ratio)) }
  })
  results.push({ name,...facts })
  console.log(name, JSON.stringify({color:facts.color,background:facts.background,opacity:facts.opacity,minContrast:Number(facts.minContrast.toFixed(2))}))
  if(!baseline)assert.ok(facts.minContrast>=4.5, `${name}: low contrast ${JSON.stringify(facts.samples.filter(x=>x.ratio<4.5))}`)
  return facts
}
try {
  app=await electron.launch({ ...(process.env.MOYE_EXECUTABLE ? {executablePath:process.env.MOYE_EXECUTABLE,args:[fixture,...flags]} : {args:['.',fixture,...flags]}),env,timeout:60000 })
  page=await app.firstWindow()
  page.on('pageerror',e=>errors.push(e.message))
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.webContents.setBackgroundThrottling(false);win.setSize(1240,1000)})
  await page.locator('.ProseMirror h1').filter({hasText:'代码块可读性'}).waitFor()
  await ready()
  const blocks=page.locator('.milkdown-code-block')
  for(const [key,label] of [['paper','暖纸'],['light','素白'],['dark','深夜']]){
    await theme(label)
    for(let i=0;i<3;i++)await inspect(blocks.nth(i),`${key}/normal/${['plain','python','javascript'][i]}`)
    await blocks.first().scrollIntoViewIfNeeded()
    await blocks.first().locator('.cm-content').click()
    await page.keyboard.press('F8')
    const focused=await inspect(blocks.first(),`${key}/focused/plain`)
    if(!baseline)assert.equal(focused.opacity,1)
    await page.locator('.ProseMirror > p').first().click()
    for(let i=0;i<3;i++)await inspect(blocks.nth(i),`${key}/inactive/${['plain','python','javascript'][i]}`)
    await page.keyboard.press('F8')
    await page.locator('.rich-editor').evaluate(el=>el.scrollTop=0)
    await app.evaluate(async({BrowserWindow})=>{await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})})
    await page.screenshot({path:path.join(root,`${key}.png`)})
    // Hidden Electron windows may not produce the stable frames required by
    // locator.screenshot. Capture the actual block bounds through Electron.
    const bounds=await blocks.first().boundingBox()
    const clip=Object.fromEntries(Object.entries(bounds).map(([key,value])=>[key,Math.round(value)]))
    const crop=await app.evaluate(async({BrowserWindow},clip)=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage(clip,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'),clip)
    await fs.writeFile(path.join(root,`${key}-plain.png`),Buffer.from(crop,'base64'))
  }
  if(!baseline){
    await theme('暖纸')
    await blocks.first().locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('【验收编辑】')
    await page.evaluate(()=>{window.__contrastNode=document.querySelector('.milkdown-code-block .cm-content')})
    await theme('深夜')
    assert.equal(await page.evaluate(()=>window.__contrastNode===document.querySelector('.milkdown-code-block .cm-content')),true)
    await page.keyboard.insertText('【光标保留】')
    assert.match(await blocks.first().innerText(),/【验收编辑】【光标保留】/)
    await page.keyboard.press('Control+z');await page.keyboard.press('Control+z')
    assert.ok(!(await blocks.first().innerText()).includes('【验收编辑】'))
    await theme('暖纸')
    await page.keyboard.press('Control+/');await ready()
    await page.locator('.source-editor .cm-content').waitFor()
    await page.keyboard.press('Control+/');await ready()
    await inspect(page.locator('.milkdown-code-block').first(),'paper/roundtrip/plain')
    // Exercise lazy block initialization after the block leaves the viewport.
    await page.locator('.ProseMirror > p').last().click()
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1240,650))
    await page.locator('.rich-editor').evaluate(el=>el.scrollTop=el.scrollHeight)
    await page.waitForTimeout(5500)
    await theme('深夜')
    await inspect(page.locator('.milkdown-code-block').first(),'dark/lazy/plain')
    await theme('暖纸')
    await page.locator('.ProseMirror > p').last().click()
    await page.keyboard.press('Control+End');await page.keyboard.press('Enter')
    await page.keyboard.type('```');await page.keyboard.press('Enter')
    await page.keyboard.insertText('新建代码块也应清晰可读。')
    await inspect(page.locator('.milkdown-code-block').last(),'paper/new-fence/plain')
    assert.match(await page.locator('.milkdown-code-block').last().innerText(),/新建代码块也应清晰可读/)
    await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name:'帮助',exact:true}).click()
    await page.getByRole('menuitem',{name:'快捷键与使用说明',exact:true}).click()
    const version=await app.evaluate(({app})=>app.getVersion())
    assert.equal(await page.locator('.panel-help h2 small').innerText(),version)
  }
  assert.equal(await fs.readFile(fixture,'utf8'),original,'Theme changes must not rewrite the original file')
  assert.deepEqual(errors,[])
  console.log(`${baseline?'BASELINE':'PASS'} ${results.length} contrast states; artifacts: ${root}`)
} catch(error) {
  console.error(error)
  errors.push(String(error))
  process.exitCode=1
} finally {
  await fs.writeFile(path.join(root,'results.json'),JSON.stringify({baseline,results,errors},null,2))
  if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{})
}
