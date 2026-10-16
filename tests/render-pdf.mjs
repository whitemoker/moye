import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
const deps = process.env.MOYE_RUNTIME_MODULES
if (!deps) throw new Error('Set MOYE_RUNTIME_MODULES to the bundled Node modules path.')
const req = createRequire(path.join(deps, '_test.cjs'))
const { createCanvas, DOMMatrix, Path2D, ImageData } = req('@napi-rs/canvas')
Object.assign(globalThis, { DOMMatrix, Path2D, ImageData })
const pdfjs = await import(pathToFileURL(path.join(deps, 'pdfjs-dist/legacy/build/pdf.mjs')).href)
const data = new Uint8Array(await fs.readFile(process.argv[2]))
const pdf = await pdfjs.getDocument({ data, useSystemFonts: true, standardFontDataUrl: path.join(deps, 'pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' }).promise
console.log('PDF pages:', pdf.numPages)
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i)
  const viewport = page.getViewport({ scale: 1.4 })
  const canvas = createCanvas(viewport.width, viewport.height)
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  await fs.writeFile(`test-results/pdf-page-${i}.png`, canvas.toBuffer('image/png'))
  console.log('Page', i, (await page.getTextContent()).items.map(i => i.str).join(' '))
}
