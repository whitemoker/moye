import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

// Preserve the original top-level focus group (paragraph, list, quote or table).
export const writingFocus = () => new Plugin({
  props: {
    decorations(state) {
      const { $from } = state.selection
      return $from.depth ? DecorationSet.create(state.doc, [Decoration.node($from.before(1), $from.after(1), { class: 'writing-focused' })]) : DecorationSet.empty
    },
  },
})

type Caret = { top: number; bottom: number; scroll: HTMLElement }
export function typewriterController(root: HTMLElement, enabled: () => boolean, caret: () => Caret | null) {
  let frame = 0, dragging = false, composing = false, destroyed = false
  const schedule = () => {
    cancelAnimationFrame(frame)
    if (destroyed || !enabled()) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (destroyed || dragging || composing || !enabled() || !root.isConnected || !root.contains(document.activeElement)) return
      const current = caret()
      if (!current || !Number.isFinite(current.top) || !Number.isFinite(current.bottom)) return
      const bounds = current.scroll.getBoundingClientRect()
      const delta = (current.top + current.bottom) / 2 - bounds.top - current.scroll.clientHeight / 2
      if (Math.abs(delta) > 1) current.scroll.scrollBy({ top: delta, behavior: 'instant' })
    })
  }
  const pointerDown = () => { dragging = true; cancelAnimationFrame(frame) }
  const pointerUp = () => { if (dragging) { dragging = false; schedule() } }
  const compositionStart = () => { composing = true; cancelAnimationFrame(frame) }
  const compositionEnd = () => { composing = false; schedule() }
  root.addEventListener('pointerdown', pointerDown, true)
  window.addEventListener('pointerup', pointerUp)
  window.addEventListener('pointercancel', pointerUp)
  root.addEventListener('compositionstart', compositionStart, true)
  root.addEventListener('compositionend', compositionEnd, true)
  root.addEventListener('focusin', schedule)
  // Embedded editors and native input can settle after the parent transaction.
  root.addEventListener('input', schedule)
  root.addEventListener('keyup', schedule)
  const resize = new ResizeObserver(schedule)
  // Observe the viewport; lazy content resizing while reading must not pull back.
  resize.observe(root.closest('.editor-host') || root)
  return {
    schedule,
    destroy() {
      destroyed = true; cancelAnimationFrame(frame); resize.disconnect()
      root.removeEventListener('pointerdown', pointerDown, true)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', pointerUp)
      root.removeEventListener('compositionstart', compositionStart, true)
      root.removeEventListener('compositionend', compositionEnd, true)
      root.removeEventListener('focusin', schedule)
      root.removeEventListener('input', schedule)
      root.removeEventListener('keyup', schedule)
    },
  }
}
