import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import katex from 'katex'
import type { Document } from './types'

const md = new MarkdownIt({ html: true, linkify: true, typographer: false })
md.inline.ruler.after('escape', 'math', (state, silent) => {
  if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false
  const end = state.src.indexOf('$', state.pos + 1)
  if (end <= state.pos + 1 || state.src.slice(state.pos + 1, end).includes('\n')) return false
  if (!silent) { const token = state.push('math_inline', 'math', 0); token.content = state.src.slice(state.pos + 1, end) }
  state.pos = end + 1; return true
})
md.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
  const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]).trim()
  if (!first.startsWith('$$')) return false
  if (silent) return true
  let line = start, content = first.slice(2)
  if (content.endsWith('$$')) content = content.slice(0, -2)
  else {
    const lines: string[] = content ? [content] : []
    for (line = start + 1; line < end; line++) { const text = state.src.slice(state.bMarks[line], state.eMarks[line]); if (text.trim().endsWith('$$')) { lines.push(text.replace(/\$\$\s*$/, '')); break } lines.push(text) }
    if (line === end) return false
    content = lines.join('\n')
  }
  const token = state.push('math_block', 'math', 0); token.content = content; token.block = true; state.line = line + 1; return true
})
const renderMath = (content: string, displayMode: boolean) => katex.renderToString(content, { output: 'mathml', displayMode, throwOnError: false })
md.renderer.rules.math_inline = (tokens, idx) => renderMath(tokens[idx].content, false)
md.renderer.rules.math_block = (tokens, idx) => `<div class="math-block">${renderMath(tokens[idx].content, true)}</div>`
md.core.ruler.after('inline', 'tasks', state => {
  for (let i = 0; i < state.tokens.length; i++) {
    const token = state.tokens[i]
    if (token.type !== 'inline' || !/^\[[ xX]\] /.test(token.content) || state.tokens[i - 2]?.type !== 'list_item_open') continue
    const checked = /^\[[xX]\]/.test(token.content)
    if (token.children?.[0]?.type === 'text') { token.children[0].content = token.children[0].content.slice(4); const checkbox = new state.Token('html_inline', '', 0); checkbox.content = `<input type="checkbox" disabled${checked ? ' checked' : ''}> `; token.children.unshift(checkbox) }
  }
})
export const exportCSS = `body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#30343a;line-height:1.8;font-size:15px;margin:0}article{max-width:820px;margin:auto;padding:42px 40px}h1,h2,h3,h4{line-height:1.4;margin:1.5em 0 .7em}h1{font-size:2.1em;border-bottom:1px solid #e8e9ec;padding-bottom:.4em}h2{font-size:1.55em;border-bottom:1px solid #e8e9ec;padding-bottom:.3em}p{margin:1em 0}a{color:#3a7367}blockquote{margin:1.3em 0;padding:.1em 1.3em;color:#66716e;border-left:3px solid #a4b9b2;background:#f7f9f8}code{font-family:Consolas,monospace;background:#f2f3f4;padding:.15em .35em;border-radius:3px;font-size:.9em}pre{padding:18px;background:#f5f6f7;border:1px solid #e9ebed;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere}pre code{padding:0;background:none}table{border-collapse:collapse;width:100%;margin:1.5em 0}th,td{border:1px solid #dfe3e6;padding:8px 12px;text-align:left}th{background:#f5f7f6}img{max-width:100%;height:auto}hr{border:0;border-top:1px solid #e0e4e3;margin:2em 0}math{font-size:1.15em}.math-block{text-align:center;margin:1.6em 0}input[type=checkbox]{accent-color:#497d6f}h1,h2,h3,h4{break-after:avoid}tr,img,pre{break-inside:avoid}@media print{article{padding:0;max-width:none}body{font-size:11pt}a{text-decoration:none}}`

export function imageSources(content: string): string[] {
  const sources: string[] = []
  const visit = (tokens: ReturnType<typeof md.parse>) => { for (const token of tokens) { if (token.type === 'image') sources.push(String(token.attrGet('src') || '')); if (token.children) visit(token.children) } }
  visit(md.parse(content, {})); return sources.filter(Boolean)
}

export async function exportDocument(kind: 'html' | 'pdf', doc: Document, title: string) {
  const content = doc.content.replace(/^(---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n)(?:\r?\n)?/, '')
  const body = DOMPurify.sanitize(md.render(content), { ADD_TAGS: ['math', 'semantics', 'annotation'], ADD_ATTR: ['encoding'] })
  const container = new DOMParser().parseFromString(body, 'text/html').body
  for (const image of container.querySelectorAll('img')) {
    const src = image.getAttribute('src') || ''
    if (!/^(https?:|data:)/i.test(src)) image.src = await window.moye.imageData({ src, documentPath: doc.path })
  }
  const safeTitle = title.replace(/[<>&"']/g, '')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:;"><title>${safeTitle}</title><style>${exportCSS}</style></head><body><article>${container.innerHTML}</article></body></html>`
  return window.moye.export({ kind, html, title: safeTitle })
}
