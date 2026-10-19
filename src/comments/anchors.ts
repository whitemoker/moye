import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Anchor } from './types'

export const fingerprint = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return `${s.length}:${h >>> 0}` }
export type Projection = { text: string; starts: number[]; ends: number[]; unsupported: { from: number; to: number }[]; blocks: { start: number; end: number; pos: number; supported: boolean; path: number[] }[]; hash: string }
export function project(doc: ProseNode): Projection {
  let text = ''; const starts: number[] = [], ends: number[] = [], blocks: Projection['blocks'] = [], unsupported: Projection['unsupported'] = []
  doc.descendants((node, pos) => {
    if (node.isLeaf && !node.isText) unsupported.push({ from: pos, to: pos + node.nodeSize })
    if (!node.isTextblock) return true
    if (blocks.length) { text += '\n'; starts.push(pos); ends.push(pos + 1) }
    const start = text.length, resolved = doc.resolve(pos + 1)
    const ancestry = Array.from({ length: resolved.depth }, (_, i) => resolved.node(i + 1).type.name)
    let supported = !ancestry.some(n => /code|table|math/.test(n))
    node.descendants((child, offset) => {
      if (child.isText) { const value = child.text!; text += value; for (let i = 0; i < value.length; i++) { starts.push(pos + 1 + offset + i); ends.push(pos + 2 + offset + i) } }
      else if (child.isLeaf) { text += child.type.name === 'hardbreak' ? '\n' : '\uFFFC'; starts.push(pos + 1 + offset); ends.push(pos + 1 + offset + child.nodeSize); if (child.type.name !== 'hardbreak') supported = false }
    })
    blocks.push({ start, end: text.length, pos, supported, path: Array.from({ length: resolved.depth }, (_, i) => resolved.index(i)) })
    return false
  })
  return { text, starts, ends, blocks, unsupported, hash: fingerprint(text) }
}
function lowerBound(values: number[], value: number) { let low = 0, high = values.length; while (low < high) { const mid = (low + high) >>> 1; if (values[mid] < value) low = mid + 1; else high = mid } return low }
export function anchorAt(p: Projection, from: number, to: number, original?: string): Anchor | null {
  if (p.unsupported.some(r => r.from < to && r.to > from)) return null
  const start = lowerBound(p.starts, from), last = lowerBound(p.ends, to + 1) - 1
  if (start < 0 || last < start || !p.text.slice(start, last + 1).trim()) return null
  const blocks = p.blocks.filter(b => b.end > start && b.start <= last)
  if (!blocks.length || blocks.some(b => !b.supported)) return null
  const quote = p.text.slice(start, last + 1)
  if (quote.length > 20000) return null
  return { associationId: crypto.randomUUID(), state: 'attached', originalQuote: original ?? quote, currentQuote: quote, textFrom: start, textTo: last + 1, prefix: p.text.slice(Math.max(0, start - 48), start), suffix: p.text.slice(last + 1, last + 49), projectionHash: p.hash, blockPath: blocks[0].path, blockFingerprint: fingerprint(p.text.slice(blocks[0].start, blocks[0].end)) }
}
export function locate(a: Anchor, p: Projection, allowDetached = false): { from: number; to: number; anchor: Anchor } | null {
  if (a.state === 'detached' && !allowDetached) return null
  const quote = a.currentQuote || a.originalQuote
  let start = -1
  if (p.hash === a.projectionHash && p.text.slice(a.textFrom, a.textTo) === quote) start = a.textFrom
  else {
    const candidates: number[] = []; let index = 0
    while (quote && (index = p.text.indexOf(quote, index)) !== -1) { candidates.push(index); index += Math.max(1, quote.length) }
    // Context must agree where available. Unique text alone is safe only when
    // it was not already detached by an explicit delete/replace transaction.
    const contextual = candidates.filter(i => (!a.prefix || p.text.slice(Math.max(0, i - a.prefix.length), i) === a.prefix) && (!a.suffix || p.text.slice(i + quote.length, i + quote.length + a.suffix.length) === a.suffix))
    if (contextual.length === 1) start = contextual[0]
    else if (candidates.length === 1) start = candidates[0]
  }
  if (start < 0) return null
  const from = p.starts[start], to = p.ends[start + quote.length - 1]
  if (from === undefined || to === undefined) return null
  const anchor = anchorAt(p, from, to, a.originalQuote)
  return anchor ? { from, to, anchor: { ...anchor, associationId: a.associationId } } : null
}
