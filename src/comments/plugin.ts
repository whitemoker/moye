import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { isHistoryTransaction } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { anchorAt, locate, project } from './anchors'
import type { Anchor } from './types'

export type Annotation = { id: string; anchor: Anchor; resolved: boolean }
type Located = Annotation & { from?: number; to?: number }
type State = { annotations: Located[]; selected: string | null; expanded: boolean }
export const commentKey = new PluginKey<State>('moye-comments')
export function commentPlugin(initial: Annotation[], onChange: (anchors: Record<string, Anchor>) => void, onClick: (ids: string[]) => void) {
  // Retain anchors associated with actual history document states. Only history
  // transactions may restore a deleted range; copy/paste never reattaches it.
  const snapshots: { doc: ProseNode; anchors: Located[] }[] = []
  const remember = (doc: ProseNode, anchors: Located[]) => { snapshots.push({ doc, anchors }); while (snapshots.length > 100 || snapshots.length > 1 && snapshots.reduce((n, s) => n + s.doc.content.size, 0) > 5000000) snapshots.shift() }
  const restore = (annotations: Annotation[], doc: ProseNode): Located[] => {
    if (!annotations.length) return []
    const p = project(doc)
    return annotations.map(a => { const found = locate(a.anchor, p); return found ? { ...a, ...found } : { ...a, anchor: { ...a.anchor, state: 'detached' as const } } })
  }
  return new Plugin<State>({
    key: commentKey,
    state: {
      init: (_, state) => ({ annotations: restore(initial, state.doc), selected: null, expanded: false }),
      apply(tr, prev, oldState) {
        const update = tr.getMeta(commentKey) as Partial<State> | undefined
        if (update) return { ...prev, ...update, annotations: update.annotations ? restore(update.annotations, tr.doc) : prev.annotations }
        if (!tr.docChanged || !prev.annotations.length) return prev
        remember(oldState.doc, prev.annotations)
        const p = project(tr.doc)
        const history = isHistoryTransaction(tr) ? [...snapshots].reverse().find(s => s.doc.eq(tr.doc)) : undefined
        const annotations = prev.annotations.map(a => {
          const prior = history?.anchors.find(v => v.id === a.id && v.anchor.associationId === a.anchor.associationId)
          if (prior) return { ...prior, resolved: a.resolved }
          if (a.anchor.state === 'detached' || a.from === undefined || a.to === undefined) return a
          const start = tr.mapping.mapResult(a.from, 1), end = tr.mapping.mapResult(a.to, -1)
          if (start.pos >= end.pos || start.deletedAcross && end.deletedAcross) return { ...a, from: undefined, to: undefined, anchor: { ...a.anchor, state: 'detached' as const } }
          const anchor = anchorAt(p, start.pos, end.pos, a.anchor.originalQuote)
          return anchor ? { ...a, anchor: { ...anchor, associationId: a.anchor.associationId }, from: start.pos, to: end.pos } : { ...a, from: undefined, to: undefined, anchor: { ...a.anchor, state: 'detached' as const } }
        })
        return { ...prev, annotations }
      },
    },
    props: {
      decorations(state) {
        const value = commentKey.getState(state)!
        return DecorationSet.create(state.doc, value.annotations.filter(a => a.from !== undefined && a.to !== undefined && (!a.resolved || value.selected === a.id)).map(a => Decoration.inline(a.from!, a.to!, { class: `comment-mark ${value.expanded ? 'expanded' : ''} ${value.selected === a.id ? 'selected' : ''}`, 'data-comment-id': a.id })))
      },
      handleClick(view, pos, event) {
        if (!(event.target as HTMLElement).closest('.comment-mark')) return false
        const value = commentKey.getState(view.state)!
        const ids = value.annotations.filter(a => a.from !== undefined && a.to !== undefined && a.from <= pos && a.to >= pos && (!a.resolved || value.selected === a.id)).map(a => a.id).filter(id => id !== '__draft__')
        if (!ids.length) return false
        onClick(ids); return true
      },
    },
    view(view) {
      let disposed = false, queued = false, last = ''
      const report = () => { if (queued) return; queued = true; queueMicrotask(() => {
        queued = false; if (disposed || view.isDestroyed) return
        const anchors = Object.fromEntries(commentKey.getState(view.state)!.annotations.map(a => [a.id, a.anchor])), key = JSON.stringify(anchors)
        if (key !== last) { last = key; onChange(anchors) }
      }) }
      report(); return { update: report, destroy() { disposed = true } }
    },
  })
}
export function commentSelection(view: EditorView) { const { from, to, empty } = view.state.selection; return empty ? null : anchorAt(project(view.state.doc), from, to) }
export function revealComment(view: EditorView, id: string) {
  const a = commentKey.getState(view.state)?.annotations.find(a => a.id === id)
  if (!a || a.from === undefined || a.to === undefined) return false
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a.from, a.to)).scrollIntoView()); view.focus(); return true
}
