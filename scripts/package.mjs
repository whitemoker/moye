import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { packager } from '@electron/packager'
const root = process.cwd(), stage = path.join(root, 'package-stage'), out = process.env.MOYE_OUTPUT_DIR ? path.resolve(process.env.MOYE_OUTPUT_DIR) : path.join(root, 'release')
const packageJSON = JSON.parse(await fs.readFile('package.json', 'utf8'))
if (path.dirname(path.resolve(stage)) !== path.resolve(root) || path.basename(stage) !== 'package-stage') throw new Error('Unexpected staging directory')
await fs.rm(stage, { recursive: true, force: true })
await fs.mkdir(stage, { recursive: true })
for (const folder of ['dist', 'electron', 'assets']) await fs.cp(path.join(root, folder), path.join(stage, folder), { recursive: true })
await fs.copyFile(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'))
await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'moye', version: packageJSON.version, productName: 'Moye', description: packageJSON.description, main: 'electron/main.cjs', license: packageJSON.license, author: packageJSON.author, repository: packageJSON.repository }, null, 2))
const deps = process.env.MOYE_RUNTIME_MODULES
if (deps) {
  const require = createRequire(path.join(deps, '_moye.cjs')), sharp = require('sharp')
  for (const name of ['icon', 'document']) {
    const svg = await fs.readFile(`assets/${name}.svg`), sizes = [16, 32, 48, 64, 128, 256], pngs = []
    for (const size of sizes) pngs.push(await sharp(svg).resize(size, size).png().toBuffer())
    await fs.writeFile(`assets/${name}.png`, pngs.at(-1)); await fs.writeFile(path.join(stage, `assets/${name}.png`), pngs.at(-1))
    const header = Buffer.alloc(6 + 16 * sizes.length); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
    let offset = header.length
    sizes.forEach((size, i) => { const start = 6 + 16 * i; header[start] = size % 256; header[start + 1] = size % 256; header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6); header.writeUInt32LE(pngs[i].length, start + 8); header.writeUInt32LE(offset, start + 12); offset += pngs[i].length })
    const ico = Buffer.concat([header, ...pngs])
    await fs.writeFile(`assets/${name}.ico`, ico); await fs.writeFile(path.join(stage, `assets/${name}.ico`), ico)
  }
}
const notices = ['Moye / 墨页 — Third-party notices\n\nThis application includes open source components. Their licenses follow.\n']
const seen = new Set()
async function collect(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const current = path.join(dir, entry.name)
    if (entry.name.startsWith('@')) { await collect(current); continue }
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(current, 'package.json'), 'utf8'))
      const id = `${pkg.name}@${pkg.version}`
      if (!seen.has(id)) {
        seen.add(id)
        const names = await fs.readdir(current)
        const licenses = names.filter(n => /^(licen[sc]e|copying|notice)(\.|$)/i.test(n))
        notices.push(`\n\n===== ${id} (${pkg.license || 'see package'}) =====\n${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || ''}\n`)
        for (const file of licenses) { try { notices.push(await fs.readFile(path.join(current, file), 'utf8')) } catch {} }
      }
      await collect(path.join(current, 'node_modules'))
    } catch {}
  }
}
await collect(path.join(root, 'node_modules'))
await fs.writeFile(path.join(stage, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'))
await fs.writeFile(path.join(root, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'))
const version = JSON.parse(await fs.readFile('node_modules/electron/package.json', 'utf8')).version
const cache = path.join(process.env.LOCALAPPDATA, 'electron/Cache')
let zipDir
for (const entry of await fs.readdir(cache, { withFileTypes: true }).catch(() => [])) if (entry.isDirectory()) {
  const candidate = path.join(cache, entry.name)
  try { await fs.access(path.join(candidate, `electron-v${version}-win32-x64.zip`)); zipDir = candidate; break } catch {}
}
const packages = await packager({ dir: stage, out, name: 'Moye', executableName: 'Moye', platform: 'win32', arch: 'x64', electronVersion: version, ...(zipDir ? { electronZipDir: zipDir } : {}), asar: true, extraResource: [path.join(root, 'assets/document.ico'), path.join(root, 'LICENSE'), path.join(stage, 'THIRD-PARTY-NOTICES.txt')], overwrite: true, prune: false, icon: path.join(root, 'assets/icon.ico'), appVersion: packageJSON.version, win32metadata: { CompanyName: 'Moye', FileDescription: 'Moye Markdown Editor', ProductName: 'Moye 墨页' } })
console.log('Packaged:', packages.join(', '))
