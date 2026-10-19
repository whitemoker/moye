import { NodeRange, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { setBlockType, wrapIn } from '@milkdown/kit/prose/commands'
import { liftListItem, wrapRangeInList } from '@milkdown/kit/prose/schema-list'
import { liftTarget } from '@milkdown/kit/prose/transform'
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Command, EditorState, Transaction } from '@milkdown/kit/prose/state'

export const isBlockFormat = (name: string) => /^(h[1-6]|paragraph|quote|bullet|ordered|task)$/.test(name)
const isList = (node: ProseNode) => /^(bullet_list|ordered_list)$/.test(node.type.name)

function protectedSelection(state: EditorState) {
  const { $from, $to, from, to } = state.selection
  const protectedNode = (node: ProseNode) => !!node.type.spec.code || !!node.type.spec.tableRole || /^(math|image)/.test(node.type.name)
  for (const pos of [$from, $to]) for (let d = pos.depth; d > 0; d--) if (protectedNode(pos.node(d))) return true
  let blocked = false
  state.doc.nodesBetween(from, to, node => { if (protectedNode(node)) blocked = true })
  return blocked
}

function toggleHeading(level: number): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection
    const blocks: ProseNode[] = []
    state.doc.nodesBetween(from, to, node => { if (node.isTextblock) blocks.push(node) })
    const remove = level === 0 || blocks.length > 0 && blocks.every(n => n.type.name === 'heading' && n.attrs.level === level)
    return setBlockType(state.schema.nodes[remove ? 'paragraph' : 'heading'], remove ? undefined : { level })(state, dispatch)
  }
}

const toggleQuote: Command = (state, dispatch) => {
  const { $from, $to } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== 'blockquote' || $to.depth < d || $from.start(d) !== $to.start(d)) continue
    const range = new NodeRange($from, $to, d), target = liftTarget(range)
    if (target !== d - 1) return false
    dispatch?.(state.tr.lift(range, target).scrollIntoView())
    return true
  }
  return wrapIn(state.schema.nodes.blockquote)(state, dispatch)
}

function toggleList(kind: 'bullet' | 'ordered' | 'task'): Command {
  return (state, dispatch) => {
    const { $from, $to, from, to } = state.selection
    const itemType = state.schema.nodes.list_item
    const targetType = state.schema.nodes[kind === 'ordered' ? 'ordered_list' : 'bullet_list']
    const range = $from.blockRange($to, isList)
    const tr = state.tr
    let listPos: number
    if (range) {
      const selected = []
      for (let i = range.startIndex; i < range.endIndex; i++) selected.push(range.parent.child(i))
      const same = selected.every(n => kind === 'task' ? n.attrs.checked != null : n.attrs.checked == null) && (kind === 'task' || range.parent.type === targetType)
      if (same) return liftListItem(itemType)(state, dispatch)

      // Split only the selected items out of their list. Structural steps retain
      // positions inside the text, including comment anchors and the selection.
      if (range.endIndex < range.parent.childCount) {
        tr.split(range.end)
        if (range.parent.type.name === 'ordered_list') tr.setNodeMarkup(range.end + 1, undefined, { ...range.parent.attrs, order: (range.parent.attrs.order || 1) + range.endIndex })
      }
      if (range.startIndex > 0) tr.split(range.start)
      listPos = tr.mapping.map(range.start, 1) - 1
      const current = tr.doc.nodeAt(listPos)!
      tr.setNodeMarkup(listPos, targetType, { ...current.attrs, order: kind === 'ordered' && range.parent.type === targetType ? (range.parent.attrs.order || 1) + range.startIndex : 1 })
    } else {
      // Mixed containers are left intact rather than nested into another list.
      let containsList = false
      state.doc.nodesBetween(from, to, node => { if (isList(node)) containsList = true })
      if (containsList) return false
      tr.setBlockType(from, to, state.schema.nodes.paragraph)
      const selection = tr.selection, blockRange = selection.$from.blockRange(selection.$to)
      if (!blockRange || !wrapRangeInList(tr, blockRange, targetType)) return false
      const after = tr.selection.$from
      let depth = after.depth
      while (depth > 0 && !isList(after.node(depth))) depth--
      if (!depth) return false
      listPos = after.before(depth)
    }
    const list = tr.doc.nodeAt(listPos)!
    list.forEach((item, offset, index) => {
      tr.setNodeMarkup(listPos + 1 + offset, undefined, {
        ...item.attrs, listType: kind === 'ordered' ? 'ordered' : 'bullet',
        label: kind === 'ordered' ? `${(list.attrs.order || 1) + index}.` : '•',
        checked: kind === 'task' ? item.attrs.checked ?? false : null,
      })
    })
    dispatch?.(tr.scrollIntoView())
    return true
  }
}

export function blockFormatCommand(name: string): Command {
  return (state, dispatch) => {
    if (protectedSelection(state)) return false
    const command = /^h[1-6]$/.test(name) ? toggleHeading(Number(name[1])) : name === 'paragraph' ? toggleHeading(0) : name === 'quote' ? toggleQuote : toggleList(name as 'bullet' | 'ordered' | 'task')
    return command(state, dispatch && ((tr: Transaction) => dispatch(closeHistory(tr))))
  }
}
