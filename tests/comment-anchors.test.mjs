import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
// Node's type stripping lets the unit tests exercise the exact renderer logic.
registerHooks({ resolve(specifier, context, next) { if (context.parentURL?.includes('/src/comments/') && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(specifier + '.ts', context); return next(specifier, context) } })
const { Schema } = await import('@milkdown/kit/prose/model')
const { EditorState } = await import('@milkdown/kit/prose/state')
const { history, undo, redo, closeHistory } = await import('@milkdown/kit/prose/history')
const { project, anchorAt, locate } = await import('../src/comments/anchors.ts')
const { commentPlugin, commentKey } = await import('../src/comments/plugin.ts')
const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { content: 'inline*', group: 'block' }, text: { group: 'inline' } } })
const doc = (...paragraphs) => schema.node('doc', null, paragraphs.map(s => schema.node('paragraph', null, s ? schema.text(s) : null)))
test('UTF-16 中文 emoji、跨段落投影以及保守恢复', () => {
  const d = doc('前言😀文字', '第二段'), p = project(d), a = anchorAt(p, 3, 11)
  assert.equal(p.text, '前言😀文字\n第二段'); assert.equal(a.currentQuote, '😀文字\n第二');
  const reopened = locate(a, project(doc('新增段落', '前言😀文字', '第二段'))); assert.ok(reopened); assert.equal(reopened.anchor.currentQuote, a.currentQuote)
  const repeated = anchorAt(project(doc('相同句子')), 1, 5)
  assert.equal(locate(repeated, project(doc('相同句子', '相同句子'))), null)
  assert.equal(locate({ ...a, state: 'detached' }, p), null)
})
test('编辑、边缘插入、删除、撤销/重做和重新粘贴不会错挂', () => {
  const d = doc('甲乙丙丁戊己'), a = anchorAt(project(d), 2, 5)
  let state = EditorState.create({ schema, doc: d, plugins: [history(), commentPlugin([{ id: 'a', anchor: a, resolved: false }], () => {}, () => {})] })
  const dispatch = tr => { state = state.apply(tr) }, anchor = () => commentKey.getState(state).annotations[0]
  dispatch(closeHistory(state.tr).insertText('前', 2)); assert.equal(anchor().anchor.currentQuote, '乙丙丁'); assert.equal(anchor().from, 3)
  dispatch(closeHistory(state.tr).insertText('中', 4)); assert.equal(anchor().anchor.currentQuote, '乙中丙丁')
  const from = anchor().from, to = anchor().to
  dispatch(closeHistory(state.tr).delete(from, to)); assert.equal(anchor().anchor.state, 'detached')
  undo(state, dispatch); assert.equal(anchor().anchor.state, 'attached'); assert.equal(anchor().anchor.currentQuote, '乙中丙丁')
  redo(state, dispatch); assert.equal(anchor().anchor.state, 'detached')
  dispatch(closeHistory(state.tr).insertText('乙中丙丁', from)); assert.equal(anchor().anchor.state, 'detached')
})
