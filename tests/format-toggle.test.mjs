import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier, context, next) { if (context.parentURL?.includes('/src/comments/') && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(specifier + '.ts', context); return next(specifier, context) } })
const { Schema } = await import('@milkdown/kit/prose/model')
const { EditorState, TextSelection } = await import('@milkdown/kit/prose/state')
const { history, undo, redo, closeHistory } = await import('@milkdown/kit/prose/history')
const { blockFormatCommand } = await import('../src/formatCommands.ts')
const { sourceBlockFormat, sourceInlineFormat } = await import('../src/sourceFormatting.ts')
const { EditorState: SourceState } = await import('@codemirror/state')
const { markdown } = await import('@codemirror/lang-markdown')
const { history: sourceHistory, undo: sourceUndo } = await import('@codemirror/commands')
const { project, anchorAt } = await import('../src/comments/anchors.ts')
const { commentPlugin, commentKey } = await import('../src/comments/plugin.ts')
const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' }, paragraph: { group: 'block', content: 'inline*' },
  heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
  blockquote: { group: 'block', content: 'block+' }, code_block: { group: 'block', content: 'text*', code: true },
  bullet_list: { group: 'block', content: 'list_item+' }, ordered_list: { group: 'block', content: 'list_item+', attrs: { order: { default: 1 } } },
  list_item: { content: 'paragraph block*', attrs: { checked: { default: null }, label: { default: '•' }, listType: { default: 'bullet' } } },
}, marks: { strong: {} } })
const node = (type, children = [], attrs) => schema.node(type, attrs, typeof children === 'string' ? (children ? schema.text(children) : null) : children)
const p = text => node('paragraph', text), li = (text, checked = null) => node('list_item', [p(text)], { checked })
function editor(doc, selectedText, options = {}) {
  let from = 1
  doc.descendants((n, pos) => { if (n.isText && n.text.includes(selectedText)) from = pos + n.text.indexOf(selectedText) })
  const anchor = anchorAt(project(doc), from, from + selectedText.length)
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, from, options.cursor ? from : from + selectedText.length), plugins: [history(), ...(anchor ? [commentPlugin([{ id: 'note', anchor, resolved: false }], () => {}, () => {})] : [])] })
  const dispatch = tr => { state = state.apply(tr); state.doc.check() }
  return { get state() { return state }, dispatch, run(name) { const result = blockFormatCommand(name)(state, dispatch); if(result) dispatch(closeHistory(state.tr)); return result }, undo() { undo(state, dispatch) }, redo() { redo(state, dispatch) }, anchor() { return commentKey.getState(state)?.annotations[0].anchor } }
}
test('H1–H6 同级取消、跨级切换、一次撤销，文字与评论关联保留', () => {
  for (let level = 1; level <= 6; level++) {
    const doc = node('doc', [p('标题中文😀')]), e = editor(doc, '中文😀')
    assert.ok(e.run('h' + level)); assert.equal(e.state.doc.firstChild.attrs.level, level)
    assert.equal(e.anchor().state, 'attached'); assert.equal(e.anchor().currentQuote, '中文😀')
    e.run('h' + level); assert.equal(e.state.doc.firstChild.type.name, 'paragraph')
    e.undo(); assert.equal(e.state.doc.firstChild.attrs.level, level)
    e.undo(); assert.ok(e.state.doc.eq(doc)); e.redo(); e.run('h' + (level === 6 ? 1 : level + 1))
    assert.equal(e.state.doc.textContent, '标题中文😀'); assert.equal(e.anchor().state, 'attached')
  }
})
test('引用可取消，外层引用和行内粗体保留', () => {
  const text = schema.text('引用文字', [schema.marks.strong.create()]), doc = node('doc', [node('blockquote', [node('paragraph', [text])])]), e = editor(doc, '引用文字')
  e.run('quote'); assert.equal(e.state.doc.firstChild.type.name, 'paragraph'); assert.equal(e.state.doc.firstChild.firstChild.marks.length, 1)
  e.undo(); assert.ok(e.state.doc.eq(doc)); e.run('h2'); e.run('paragraph'); assert.equal(e.state.doc.firstChild.type.name, 'blockquote')
  assert.equal(e.anchor().state, 'attached')
})
test('正文转任务项保留所选原文；同类取消，撤销恢复', () => {
  const doc = node('doc', [p('原文任务不替换')]), e = editor(doc, '任务')
  assert.ok(e.run('task')); assert.equal(e.state.doc.firstChild.firstChild.attrs.checked, false)
  assert.equal(e.state.doc.textContent, doc.textContent); assert.equal(e.anchor().state, 'attached')
  e.run('task'); assert.equal(e.state.doc.firstChild.type.name, 'paragraph'); e.undo()
  assert.equal(e.state.doc.firstChild.firstChild.attrs.checked, false); assert.equal(e.anchor().currentQuote, '任务')
})
test('只转换中间列表项，前后项与已完成任务保留', () => {
  const doc = node('doc', [node('bullet_list', [li('第一项', true), li('第二项'), li('第三项', false)])]), e = editor(doc, '第二项')
  assert.ok(e.run('ordered')); assert.equal(e.state.doc.childCount, 3)
  assert.equal(e.state.doc.child(0).firstChild.attrs.checked, true)
  assert.equal(e.state.doc.child(1).type.name, 'ordered_list')
  assert.equal(e.state.doc.child(1).firstChild.attrs.listType, 'ordered')
  assert.equal(e.state.doc.child(2).firstChild.attrs.checked, false)
  assert.equal(e.anchor().state, 'attached'); e.undo(); assert.ok(e.state.doc.eq(doc))
  e.run('task'); assert.equal(e.state.doc.child(1).firstChild.attrs.checked, false)
})
test('多段转换为各自列表项；列表类型切换不嵌套', () => {
  const doc = node('doc', [p('第一'), p('第二')]), e = editor(doc, '第一')
  e.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 1, doc.content.size - 1)))
  assert.ok(e.run('bullet')); assert.equal(e.state.doc.firstChild.childCount, 2)
  e.run('ordered'); assert.equal(e.state.doc.firstChild.type.name, 'ordered_list'); assert.equal(e.state.doc.firstChild.childCount, 2)
  e.run('ordered'); assert.equal(e.state.doc.childCount, 2); assert.equal(e.state.doc.firstChild.type.name, 'paragraph')
})
test('嵌套列表取消只退出一层，不丢子项；代码块不被格式命令改写', () => {
  const doc = node('doc', [node('bullet_list', [node('list_item', [p('父项'), node('bullet_list', [li('子项')])])])]), e = editor(doc, '子项')
  assert.ok(e.run('bullet')); assert.equal(e.state.doc.firstChild.childCount, 2); assert.equal(e.state.doc.textContent, '父项子项'); e.undo(); assert.ok(e.state.doc.eq(doc))
  const c = editor(node('doc', [node('code_block', 'const a = 1')]), 'const')
  for(const name of ['h1', 'paragraph', 'quote', 'bullet', 'task']) assert.equal(c.run(name), false)
})
function source(text, from = 0, to = from) {
  let state = SourceState.create({ doc: text, selection: { anchor: from, head: to }, extensions: [markdown(), sourceHistory()] })
  return { get state() { return state }, run(name, inline = false) { const change = (inline ? sourceInlineFormat : sourceBlockFormat)(state, name); if(change) state = state.update(change).state; return change }, undo() { sourceUndo({ state, dispatch: tr => { state = tr.state } }) }, text() { return state.doc.toString() } }
}
test('源码 H1–H6 双向切换、空行光标、单次撤销', () => {
  for(let n = 1; n <= 6; n++) { const s = source('中文标题', 2); s.run('h' + n); assert.equal(s.text(), '#'.repeat(n) + ' 中文标题'); s.run('h' + n); assert.equal(s.text(), '中文标题'); s.undo(); assert.equal(s.text(), '#'.repeat(n) + ' 中文标题') }
  const s = source(''); s.run('h1'); assert.equal(s.state.selection.main.head, 2); s.run('h1'); assert.equal(s.text(), '')
})
test('源码多行只处理选中行、保留空行和引用容器', () => {
  const s = source('甲\n\n乙\n丙', 0, 5); s.run('h2'); assert.equal(s.text(), '## 甲\n\n## 乙\n丙'); s.run('h2'); assert.equal(s.text(), '甲\n\n乙\n丙')
  const quoted = source('> ## 内容', 5); quoted.run('h2'); assert.equal(quoted.text(), '> 内容'); quoted.run('paragraph'); assert.equal(quoted.text(), '> 内容'); quoted.run('quote'); assert.equal(quoted.text(), '内容')
})
test('源码列表切换与任务状态，文字无损且不重复插标记', () => {
  const s = source('- [x] 完成\n普通', 0, 11); s.run('task'); assert.equal(s.text(), '- [x] 完成\n- [ ] 普通'); s.run('ordered'); assert.equal(s.text(), '1. 完成\n2. 普通'); s.run('ordered'); assert.equal(s.text(), '完成\n普通'); s.undo(); assert.equal(s.text(), '1. 完成\n2. 普通')
})
test('源码代码围栏和 frontmatter 中格式操作不改文本', () => {
  for(const text of ['```js\nconst a = 1\n```', '---\ntitle: test\n---\n正文']) { const s = source(text, text.indexOf('\n') + 2); assert.equal(s.run('h1'), null); assert.equal(s.run('bold', true), null); assert.equal(s.text(), text) }
})
test('源码行内格式重复取消，空光标和已选标记无损', () => {
  for(const [name, marker] of [['bold', '**'], ['italic', '*'], ['strike', '~~'], ['code', '`']]) {
    const s = source('中文😀文字', 0, '中文😀文字'.length); s.run(name, true); assert.equal(s.text(), marker + '中文😀文字' + marker); s.run(name, true); assert.equal(s.text(), '中文😀文字'); s.undo(); assert.equal(s.text(), marker + '中文😀文字' + marker)
    const empty = source(''); empty.run(name, true); empty.run(name, true); assert.equal(empty.text(), '')
    const wrapped = source(marker + '文字' + marker, 0, marker.length * 2 + 2); wrapped.run(name, true); assert.equal(wrapped.text(), '文字')
  }
  const bold = source('**文字**', 2, 4); bold.run('italic', true); assert.equal(bold.text(), '***文字***'); bold.run('italic', true); assert.equal(bold.text(), '**文字**')
  const ticks = source('`文字`', 0, 4); ticks.run('code', true); assert.equal(ticks.text(), '文字')
  const literal = source('a`b', 0, 3); literal.run('code', true); assert.equal(literal.text(), '``a`b``'); literal.run('code', true); assert.equal(literal.text(), 'a`b')
  const edge = source('`文字', 0, 3); edge.run('code', true); assert.equal(edge.text(), '`` `文字 ``'); edge.run('code', true); assert.equal(edge.text(), '`文字')
})
