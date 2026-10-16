import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright'

const filePath = process.argv[2]
const executablePath = process.argv[3]
if (!filePath || !executablePath) throw new Error('File and application paths required')
const root = await fs.mkdtemp(path.resolve('test-results/file-inspect-'))
function inspect(bytes, hashValue) {
  const decoders = {}
  for (const encoding of ['utf-8', 'utf-16le', 'utf-16be', 'gb18030']) {
    try {
      const content = new TextDecoder(encoding, { fatal: true }).decode(bytes)
      decoders[encoding] = { valid: true, characters: content.length, controls: [...content].filter(c => /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(c)).length }
    } catch { decoders[encoding] = { valid: false } }
  }
  return { bytes: bytes.length, sha256: hashValue, bom: bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? 'utf-8' : 'none', decoders }
}
const initialStat = await fs.stat(filePath)
const bytes = await fs.readFile(filePath)
const node = inspect(bytes, createHash('sha256').update(bytes).digest('hex'))
const env = { ...process.env, MOYE_TEST: '1', MOYE_USER_DATA: path.join(root, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ executablePath, args: [], env, timeout: 60000 })
  const moye = await app.evaluate(async ({ app }, { filePath, inspectSource }) => {
    const fs = process.getBuiltinModule('fs').promises
    const crypto = process.getBuiltinModule('crypto')
    const stat = await fs.stat(filePath)
    const bytes = await fs.readFile(filePath)
    const inspect = (0, eval)(`(${inspectSource})`)
    const facts = inspect(bytes, crypto.createHash('sha256').update(bytes).digest('hex'))
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')
    try {
      const doc = await require('./electron/storage.cjs').readDocument(filePath)
      facts.applicationRead = { ok: true, characters: doc.content.length }
    } catch (error) { facts.applicationRead = { ok: false, message: error.message } }
    return { version: app.getVersion(), statBytes: stat.size, ...facts }
  }, { filePath, inspectSource: inspect.toString() })
  const afterStat = await fs.stat(filePath)
  const afterHash = createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
  const result = { node: { statBytes: initialStat.size, ...node }, moye, sameBytesAcrossProcesses: node.sha256 === moye.sha256, originalUnchanged: initialStat.mtimeMs === afterStat.mtimeMs && node.sha256 === afterHash }
  await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally { if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
