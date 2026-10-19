import { EditorSelection, type EditorState, type ChangeSpec, type TransactionSpec } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { isolateHistory } from '@codemirror/commands'

type Line = { from: number; to: number; text: string }
function protectedLine(state: EditorState, line: Line) {
  let blocked = false
  syntaxTree(state).iterate({ from: line.from, to: line.to, enter(node) { if (/^(FencedCode|CodeBlock|Table|HTMLBlock)$/.test(node.name)) { blocked = true; return false } } })
  const frontmatter = state.doc.toString().match(/^(?:\uFEFF)?---\n[\s\S]*?\n(?:---|\.\.\.)(?:\n|$)/)
  return blocked || !!frontmatter && line.from < frontmatter[0].length
}

function parts(text: string) {
  const indent = /^[ \t]*/.exec(text)![0]
  const quote = /^(?:>[ \t]?)+/.exec(text.slice(indent.length))?.[0] || ''
  const start = indent.length + quote.length
  const list = /^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/.exec(text.slice(start))?.[0] || ''
  const contentStart = start + list.length
  const heading = /^#{1,6}(?:[ \t]+|$)/.exec(text.slice(contentStart))?.[0] || ''
  const kind = !list ? '' : /\[[ xX]\]/.test(list) ? 'task' : /^\d/.test(list) ? 'ordered' : 'bullet'
  return { indent, quote, start, list, contentStart, heading, kind }
}

function transaction(state: EditorState, changes: ChangeSpec[], selection?: { anchor: number; head: number }): TransactionSpec {
  const changeSet = state.changes(changes)
  return { changes: changeSet, selection: selection ? EditorSelection.single(selection.anchor, selection.head) : state.selection.map(changeSet, 1), annotations: isolateHistory.of('full'), scrollIntoView: true }
}

export function sourceBlockFormat(state: EditorState, name: string): TransactionSpec | null {
  const { from, to } = state.selection.main
  const first = state.doc.lineAt(from), last = state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to)
  const lines: Line[] = []
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n)
    if (protectedLine(state, line)) return null
    if (first.number === last.number || line.text.trim()) lines.push(line)
  }
  if (!lines.length) return null
  const parsed = lines.map(line => ({ line, ...parts(line.text) }))
  const heading = /^h[1-6]$/.test(name), changes: ChangeSpec[] = []
  const same = parsed.every(p => heading ? p.heading.trim() === '#'.repeat(Number(name[1])) : name === 'quote' ? !!p.quote : p.kind === name)
  parsed.forEach((p, i) => {
    const { line } = p
    if (heading || name === 'paragraph') {
      changes.push({ from: line.from + p.contentStart, to: line.from + p.contentStart + p.heading.length, insert: name === 'paragraph' || same ? '' : '#'.repeat(Number(name[1])) + ' ' })
    } else if (name === 'quote') {
      changes.push({ from: line.from + p.indent.length, to: line.from + p.indent.length + (same ? /^>[ \t]?/.exec(p.quote)![0].length : 0), insert: same ? '' : '> ' })
    } else {
      const prefix = same ? '' : name === 'ordered' ? `${i + 1}. ` : name === 'task' ? `- [${/\[[xX]\]/.test(p.list) ? 'x' : ' '}] ` : '- '
      changes.push({ from: line.from + p.start, to: line.from + p.contentStart + (!same ? p.heading.length : 0), insert: prefix })
    }
  })
  return transaction(state, changes)
}

function runBefore(text: string, pos: number, marker: string) { let n = 0; while (text[pos - n - 1] === marker) n++; return n }
function runAfter(text: string, pos: number, marker: string) { let n = 0; while (text[pos + n] === marker) n++; return n }
function escaped(text: string, pos: number) { return runBefore(text, pos, '\\') % 2 === 1 }

export function sourceInlineFormat(state: EditorState, name: string): TransactionSpec | null {
  const { from, to, anchor, head } = state.selection.main, text = state.doc.toString()
  const markers: Record<string, string> = { bold: '**', italic: '*', strike: '~~', code: '`', 'inline-math': '$' }
  let marker = markers[name]
  if (!marker) return null
  for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) {
    const line = state.doc.line(n)
    // An empty strike pair is temporarily parsed as a fence until text is typed.
    const syntax = syntaxTree(state).resolveInner(line.from + Math.min(1, line.text.length), 1)
    const fence = syntax.name === 'FencedCode' ? syntax : syntax.parent
    const emptyPair = from === to && line.text === marker + marker && from === line.from + marker.length && fence?.name === 'FencedCode' && fence.from === line.from && fence.to === line.to
    if (protectedLine(state, line) && !emptyPair) return null
  }
  const char = marker[0], size = marker.length
  const outsideLeft = runBefore(text, from, char), outsideRight = runAfter(text, to, char)
  const validRuns = (left: number, right: number) => name === 'italic' ? left % 2 === 1 && right % 2 === 1 : name === 'code' ? left > 0 && left === right : left >= size && right >= size
  if (name === 'code' && text[from - 1] === ' ' && text[to] === ' ') {
    const left = runBefore(text, from - 1, '`'), right = runAfter(text, to + 1, '`')
    if (left && left === right) return transaction(state, [{ from: from - left - 1, to: from, insert: '' }, { from: to, to: to + right + 1, insert: '' }], { anchor: anchor - left - 1, head: head - left - 1 })
  }
  let start = from, end = to, remove = 0, included = false
  if (validRuns(outsideLeft, outsideRight) && !escaped(text, from - outsideLeft)) remove = name === 'code' ? outsideLeft : size
  else if (to > from) {
    const left = runAfter(text, from, char), right = runBefore(text, to, char)
    if (left + right <= to - from && validRuns(left, right) && !escaped(text, from)) { remove = name === 'code' ? left : size; included = true }
  }
  if (remove) {
    start = included ? from : from - remove; end = included ? to : to + remove
    const contentFrom = start + remove, contentTo = end - remove
    return transaction(state, [{ from: start, to: contentFrom, insert: '' }, { from: contentTo, to: end, insert: '' }], { anchor: anchor <= head ? start : end - remove * 2, head: anchor <= head ? end - remove * 2 : start })
  }
  if (name === 'code') {
    const runs = text.slice(from, to).match(/`+/g) || []
    marker = '`'.repeat(Math.max(0, ...runs.map(s => s.length)) + 1)
  }
  const content = text.slice(from, to)
  const pad = name === 'code' && (/^`|`$/.test(content) || /^ .* $/.test(content) && /[^ ]/.test(content)) ? ' ' : ''
  // Insert delimiters around the original text instead of replacing it.
  return transaction(state, from === to ? [{ from, insert: marker + marker }] : [{ from, insert: marker + pad }, { from: to, insert: pad + marker }], { anchor: anchor + marker.length + pad.length, head: head + marker.length + pad.length })
}
