import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx, editorViewOptionsCtx, commandsCtx } from '@milkdown/kit/core'
import { callCommand, insert, $prose } from '@milkdown/kit/utils'
import { toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand, wrapInHeadingCommand, wrapInBlockquoteCommand, wrapInBulletListCommand, wrapInOrderedListCommand, turnIntoTextCommand, createCodeBlockCommand } from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { imageBlockSchema } from '@milkdown/kit/component/image-block'
import { undo, redo } from '@milkdown/kit/prose/history'
import { Plugin, PluginKey, TextSelection, NodeSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView as ProseView } from '@milkdown/kit/prose/view'
import { addRowAfter, addColumnAfter, deleteRow, deleteColumn, deleteTable } from '@milkdown/kit/prose/tables'
import { EditorView as CodeView, keymap, drawSelection, highlightActiveLine, lineNumbers } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab, undo as codeUndo, redo as codeRedo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { SearchQuery, setSearchQuery, findNext, findPrevious, replaceNext, replaceAll, search } from '@codemirror/search'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import 'katex/dist/katex.min.css'
import type { Heading } from './types'
import { writingFocus, typewriterController } from './writingModes'

export type EditorContext = { selectedText: string; activeFormats: string[]; canFormat: boolean }
export type EditorHandle = { getContent(): string; context(): EditorContext; command(name: string): void; insert(text: string): void; heading(pos: number): void; search(query: string, replacement: string, action: string, caseSensitive: boolean): number; html(): string; focus(): void }
type Props = { content: string; source: boolean; dark: boolean; typewriter: boolean; documentPath: string | null; onChange(text: string): void; onHeadings(headings: Heading[]): void; onReady(): void; onError(error: unknown): void; onImage(file: File): Promise<string> }
const searchKey = new PluginKey('moye-search')
function matches(doc: any, query: string, caseSensitive: boolean) {
  const result: { from: number; to: number }[] = []
  if (!query) return result
  const needle = caseSensitive ? query : query.toLocaleLowerCase()
  doc.descendants((node: any, pos: number) => {
    if (!node.isTextblock) return true
    const raw = node.textBetween(0, node.content.size, '\n', '\uFFFC')
    const value = caseSensitive ? raw : raw.toLocaleLowerCase()
    let index = 0
    while ((index = value.indexOf(needle, index)) !== -1) { result.push({ from: pos + 1 + index, to: pos + 1 + index + query.length }); index += Math.max(query.length, 1) }
    return false
  })
  return result
}
const searchPlugin = $prose(() => new Plugin({
  key: searchKey,
  state: {
    init: () => ({ query: '', caseSensitive: false }),
    apply: (tr, value) => tr.getMeta(searchKey) || value,
  },
  props: {
    handleKeyDown(view, event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') return addRowAfter(view.state, view.dispatch)
      return false
    },
    decorations(state) {
      const { query, caseSensitive } = searchKey.getState(state)
      return DecorationSet.create(state.doc, matches(state.doc, query, caseSensitive).map(m => Decoration.inline(m.from, m.to, { class: 'search-hit' })))
    },
  },
}))
const linkPlugin = $prose(() => new Plugin({
  props: {
    handleDOMEvents: {
      click(view, event) {
        const a = (event.target as HTMLElement).closest('a')
        if (a && (event.ctrlKey || event.metaKey)) { event.preventDefault(); window.moye.external(a.href); return true }
        return false
      },
    },
  },
}))

export default forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const root = useRef<HTMLDivElement>(null)
  const rich = useRef<Crepe | null>(null)
  const code = useRef<CodeView | null>(null)
  const codeTheme = useRef(new Compartment())
  const typewriter = useRef<ReturnType<typeof typewriterController> | null>(null)
  const callback = useRef(props); callback.current = props
  const initial = useRef(props.content)
  const frontmatter = useRef(props.content.match(/^(---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n)(?:\r?\n)?/)?.[0] || '')
  const baseline = useRef('')
  const [loading, setLoading] = useState(true)
  const getContent = () => {
    if (code.current) { const text = code.current.state.doc.toString(); return text === initial.current.replace(/\r\n/g, '\n') ? initial.current : text }
    if (rich.current) { const md = rich.current.getMarkdown(); return md === baseline.current ? initial.current : frontmatter.current + md }
    return initial.current
  }
  useImperativeHandle(ref, () => ({
    getContent,
    context() {
      if (code.current) { const { state } = code.current; return { selectedText: state.sliceDoc(state.selection.main.from, state.selection.main.to), activeFormats: [], canFormat: true } }
      return rich.current?.editor.action(ctx => {
        const { state } = ctx.get(editorViewCtx), { from, to, $from, empty } = state.selection
        const markNames: Record<string, string> = { bold: 'strong', italic: 'emphasis', strike: 'strike_through', code: 'inlineCode', link: 'link' }
        const activeFormats = Object.entries(markNames).filter(([, name]) => {
          const type = state.schema.marks[name]
          return type && (empty ? type.isInSet(state.storedMarks || $from.marks()) : state.doc.rangeHasMark(from, to, type))
        }).map(([action]) => action)
        const mathNode = state.selection instanceof NodeSelection && state.selection.node.type.name === 'math_inline' ? state.selection.node : null
        if (mathNode) activeFormats.push('inline-math')
        return { selectedText: mathNode ? String(mathNode.attrs.value) : state.doc.textBetween(from, to, '\n'), activeFormats, canFormat: !$from.parent.type.spec.code }
      }) || { selectedText: '', activeFormats: [], canFormat: false }
    },
    focus() { code.current?.focus(); rich.current?.editor.action(ctx => ctx.get(editorViewCtx).focus()) },
    command(name) {
      if (code.current) {
        const view = code.current, selection = view.state.selection.main
        if (name === 'undo' || name === 'redo') { (name === 'undo' ? codeUndo : codeRedo)(view); view.focus(); return }
        const pairs: Record<string, [string, string]> = { bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'], code: ['`', '`'], link: ['[', '](https://)'], 'inline-math': ['$', '$'] }
        if (pairs[name]) { const [left, right] = pairs[name]; view.dispatch({ changes: { from: selection.from, to: selection.to, insert: left + view.state.sliceDoc(selection.from, selection.to) + right }, selection: { anchor: selection.from + left.length, head: selection.to + left.length } }); view.focus(); return }
        const prefixes: Record<string, string> = { h1: '# ', h2: '## ', h3: '### ', h4: '#### ', quote: '> ', bullet: '- ', ordered: '1. ', task: '- [ ] ', paragraph: '' }
        if (name in prefixes) { const line = view.state.doc.lineAt(selection.from); const old = /^(#{1,6}\s|>\s|[-*+]\s(?:\[[ x]\]\s)?|\d+\.\s)/.exec(line.text); view.dispatch({ changes: { from: line.from, to: line.from + (old?.[0].length || 0), insert: prefixes[name] } }); view.focus() }
        return
      }
      const editor = rich.current?.editor
      if (!editor) return
      if (name === 'inline-math') { editor.action(ctx => ctx.get(commandsCtx).call('ToggleLatex')); editor.action(ctx => ctx.get(editorViewCtx).focus()); return }
      const tableCommands: Record<string, typeof addRowAfter> = { 'table-row': addRowAfter, 'table-col': addColumnAfter, 'table-delete-row': deleteRow, 'table-delete-col': deleteColumn, 'table-delete': deleteTable }
      if (tableCommands[name]) { editor.action(ctx => { const view = ctx.get(editorViewCtx); tableCommands[name](view.state, view.dispatch); view.focus() }); return }
      if (name === 'undo' || name === 'redo') { editor.action(ctx => { const view = ctx.get(editorViewCtx); (name === 'undo' ? undo : redo)(view.state, view.dispatch); view.focus() }); return }
      const commands: Record<string, any> = { bold: toggleStrongCommand.key, italic: toggleEmphasisCommand.key, code: toggleInlineCodeCommand.key, strike: toggleStrikethroughCommand.key, paragraph: turnIntoTextCommand.key, quote: wrapInBlockquoteCommand.key, bullet: wrapInBulletListCommand.key, ordered: wrapInOrderedListCommand.key, codeblock: createCodeBlockCommand.key }
      if (/^h[1-6]$/.test(name)) editor.action(callCommand(wrapInHeadingCommand.key, Number(name[1])))
      else if (commands[name]) editor.action(callCommand(commands[name]))
      else if (name === 'task') editor.action(insert('- [ ] 待办事项'))
      editor.action(ctx => ctx.get(editorViewCtx).focus())
    },
    insert(text) {
      if (code.current) { const view = code.current; view.dispatch(view.state.replaceSelection(text)); view.focus() }
      else if (rich.current) { rich.current.editor.action(insert(text)); rich.current.editor.action(ctx => ctx.get(editorViewCtx).focus()) }
    },
    heading(pos) {
      if (code.current) { const view = code.current; view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) }, effects: CodeView.scrollIntoView(pos, { y: 'start' }) }); view.focus() }
      else rich.current?.editor.action(ctx => { const view = ctx.get(editorViewCtx); const element = view.nodeDOM(pos) as HTMLElement | null; element?.scrollIntoView({ behavior: callback.current.typewriter ? 'instant' : 'smooth', block: 'start' }); view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 1)))); view.focus() })
    },
    search(query, replacement, action, caseSensitive) {
      if (code.current) {
        const view = code.current
        view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query, replace: replacement, caseSensitive, literal: true })) })
        if (action === 'next') findNext(view)
        if (action === 'prev') findPrevious(view)
        if (action === 'replace') replaceNext(view)
        if (action === 'all') replaceAll(view)
        const text = view.state.doc.toString(), needle = caseSensitive ? query : query.toLocaleLowerCase(), haystack = caseSensitive ? text : text.toLocaleLowerCase()
        return needle ? haystack.split(needle).length - 1 : 0
      }
      let count = 0
      rich.current?.editor.action(ctx => {
        const view = ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.setMeta(searchKey, { query, caseSensitive }))
        let found = matches(view.state.doc, query, caseSensitive)
        if (action === 'all' && found.length) { let tr = view.state.tr; for (const m of [...found].reverse()) tr = tr.insertText(replacement, m.from, m.to); view.dispatch(tr) }
        else if (action === 'replace') {
          const selection = view.state.selection
          const current = found.find(m => m.from === selection.from && m.to === selection.to)
          if (current) view.dispatch(view.state.tr.insertText(replacement, current.from, current.to))
          found = matches(view.state.doc, query, caseSensitive)
        }
        if (['next', 'prev', 'replace'].includes(action) && found.length) {
          const selection = view.state.selection
          const target = action === 'prev' ? [...found].reverse().find(m => m.to <= selection.from) || found[found.length - 1] : found.find(m => m.from >= selection.to) || found[0]
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target.from, target.to)).scrollIntoView())
        }
        count = matches(view.state.doc, query, caseSensitive).length
      })
      return count
    },
    html() { return root.current?.querySelector('.ProseMirror')?.innerHTML || '' },
  }))

  useEffect(() => {
    code.current?.dispatch({ effects: codeTheme.current.reconfigure(props.dark ? [oneDark] : []) })
  }, [props.dark])
  useEffect(() => { typewriter.current?.schedule() }, [props.typewriter])

  useEffect(() => {
    let cancelled = false
    const container = root.current!
    const reportSource = (text: string) => {
      let offset = 0, inFence = false
      const headings: Heading[] = []
      for (const line of text.split('\n')) { if (/^\s*(```|~~~)/.test(line)) inFence = !inFence; const m = /^(#{1,6})\s+(.+)$/.exec(line); if (m && !inFence) headings.push({ text: m[2], level: m[1].length, pos: offset }); offset += line.length + 1 }
      callback.current.onHeadings(headings)
    }
    if (props.source) {
      const view = new CodeView({ parent: container, state: EditorState.create({ doc: initial.current, extensions: [
        lineNumbers(), drawSelection(), highlightActiveLine(), history(), bracketMatching(), markdown({ codeLanguages: languages }), syntaxHighlighting(defaultHighlightStyle), search({ top: true }), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), CodeView.lineWrapping,
        codeTheme.current.of(props.dark ? [oneDark] : []), CodeView.updateListener.of(update => {
          if (update.docChanged) { const text = update.state.doc.toString(); callback.current.onChange(text === initial.current.replace(/\r\n/g, '\n') ? initial.current : text); reportSource(text) }
          if (update.selectionSet || update.docChanged || update.geometryChanged) typewriter.current?.schedule()
        }),
        CodeView.theme({ '&': { height: '100%', fontSize: 'var(--editor-font-size)' }, '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.85', overflow: 'auto' }, '.cm-content': { padding: '38px 42px 64px', maxWidth: 'var(--page-width)', margin: '0 auto' }, '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--muted)' }, '.cm-activeLine': { background: 'var(--hover)' } }),
      ] }) })
      code.current = view
      typewriter.current = typewriterController(container, () => callback.current.typewriter, () => {
        if (view.composing || !view.state.selection.main.empty) return null
        const cursor = view.coordsAtPos(view.state.selection.main.head)
        return cursor ? { top: cursor.top, bottom: cursor.bottom, scroll: view.scrollDOM } : null
      })
      reportSource(view.state.doc.toString()); setLoading(false); callback.current.onReady()
      return () => { typewriter.current?.destroy(); typewriter.current = null; code.current = null; view.destroy() }
    }
    const crepe = new Crepe({
      root: container, defaultValue: initial.current.slice(frontmatter.current.length),
      features: { [Crepe.Feature.BlockEdit]: false, [Crepe.Feature.Toolbar]: false },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: '写下你的第一行…', mode: 'doc' },
        [Crepe.Feature.ImageBlock]: {
          onUpload: file => callback.current.onImage(file),
          proxyDomURL: src => window.moye.imageUrl({ src, documentPath: callback.current.documentPath }),
          blockUploadButton: '选择图片', inlineUploadButton: '选择图片', blockUploadPlaceholderText: '粘贴图片地址，或选择本地图片', inlineUploadPlaceholderText: '图片地址', blockCaptionPlaceholderText: '图片说明',
        },
        [Crepe.Feature.LinkTooltip]: { inputPlaceholder: '粘贴或输入链接' },
        [Crepe.Feature.CodeMirror]: { searchPlaceholder: '选择语言', noResultText: '没有匹配的语言' },
        [Crepe.Feature.Latex]: { katexOptions: { throwOnError: false } },
      },
    })
    const modePlugin = $prose(() => new Plugin({
      view: view => {
        typewriter.current = typewriterController(container, () => callback.current.typewriter, () => {
          if (view.isDestroyed || view.composing) return null
          // Code blocks host their own editor; use its caret when it owns focus.
          const nested = container.querySelector('.cm-editor.cm-focused') as HTMLElement | null
          if (nested) {
            const nestedView = CodeView.findFromDOM(nested)
            if (!nestedView || nestedView.composing || !nestedView.state.selection.main.empty) return null
            const cursor = nestedView.coordsAtPos(nestedView.state.selection.main.head)
            return cursor ? { top: cursor.top, bottom: cursor.bottom, scroll: container.closest('.rich-editor') as HTMLElement } : null
          }
          if (!view.state.selection.empty) return null
          const cursor = view.coordsAtPos(view.state.selection.head)
          return { top: cursor.top, bottom: cursor.bottom, scroll: container.closest('.rich-editor') as HTMLElement }
        })
        return {
          update(next, previous) { if (!next.state.selection.eq(previous.selection) || !next.state.doc.eq(previous.doc)) typewriter.current?.schedule() },
          destroy() { typewriter.current?.destroy(); typewriter.current = null },
        }
      },
    }))
    crepe.editor.use(searchPlugin).use(linkPlugin).use($prose(writingFocus)).use(modePlugin)
    crepe.editor.config(ctx => ctx.update(editorViewOptionsCtx, options => ({
      ...options,
      dispatchTransaction(this: ProseView, transaction: Transaction) {
        if (this.isDestroyed) return
        // The table component queues a pointer selection for the next frame.
        // If typing already changed the document, that old caret move must not
        // override the new edit or be applied against the wrong document.
        if (!transaction.docChanged && !transaction.before.eq(this.state.doc)) return
        this.updateState(this.state.apply(transaction))
      },
    })))
    crepe.editor.config(ctx => ctx.update(imageBlockSchema.key, previous => ctx => {
      const schema = previous(ctx)
      return { ...schema, attrs: { ...schema.attrs, alt: { default: '', validate: 'string' } },
        parseMarkdown: { match: schema.parseMarkdown.match, runner(state, node, type) { state.addNode(type, { src: node.url as string, caption: (node.title as string) || '', alt: (node.alt as string) || '', ratio: 1 }) } },
        toMarkdown: { match: schema.toMarkdown.match, runner(state, node) { state.openNode('paragraph'); state.addNode('image', undefined, undefined, { title: node.attrs.caption || null, url: node.attrs.src, alt: node.attrs.alt }); state.closeNode() } },
      }
    }))
    const reportRich = () => crepe.editor.action(ctx => {
      const headings: Heading[] = []
      ctx.get(editorViewCtx).state.doc.descendants((node, pos) => { if (node.type.name === 'heading') headings.push({ text: node.textContent, level: node.attrs.level, pos }) })
      callback.current.onHeadings(headings)
    })
    crepe.on(listener => {
      listener.markdownUpdated(() => { if (!cancelled && rich.current) { callback.current.onChange(getContent()); reportRich() } })
    })
    crepe.create().then(() => {
      if (cancelled) { void crepe.destroy(); return }
      baseline.current = crepe.getMarkdown(); rich.current = crepe; reportRich(); setLoading(false); callback.current.onReady()
    }).catch(error => { if (!cancelled) callback.current.onError(error) })
    return () => { cancelled = true; if (rich.current === crepe) { rich.current = null; void crepe.destroy() } }
  }, [])
  return <div className={`editor-host ${props.source ? 'source-editor' : 'rich-editor'}`}>{!props.source && frontmatter.current && <details className="frontmatter"><summary>文档属性 <small>在源码模式中编辑</small></summary><pre>{frontmatter.current}</pre></details>}<div className="editor-mount" ref={root}/>{loading && <div className="editor-loading">正在铺开文稿…</div>}</div>
})
