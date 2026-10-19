import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { MessageSquare, PanelRightClose, Plus, Check, RotateCcw, MoreHorizontal, X, Send, Link2, Upload } from 'lucide-react'
import { type CommentDraft, type CommentThread, type CommentMessage } from '../../comments/types'

type Props = {
  open: boolean; width: number; documentKey: string; source: boolean; threads: CommentThread[]; draft: CommentDraft
  selected: string | null; overlap: string[]; error?: string; state: string; author: string; authorId: string
  onClose(): void; onWidth(width: number): void; onAuthor(name: string): void; onSelect(id: string): void
  onNew(): void; onReveal(id: string): void; onAttach(id: string): void; onImport(): void
  onDraft(d: CommentDraft): void; onThreads(threads: CommentThread[]): void
}
const memories = new Map<string, { filter: string; scroll: number }>()
const stamp = (value: string) => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间未知' }
export default function CommentSidebar(p: Props) {
  const root = useRef<HTMLElement>(null), list = useRef<HTMLDivElement>(null), composer = useRef<HTMLTextAreaElement>(null)
  const [filter, setFilter] = useState('open'), [menu, setMenu] = useState<string | null>(null), [authorOpen, setAuthorOpen] = useState(false)
  const [overlay, setOverlay] = useState(false)
  const [removed, setRemoved] = useState<{ thread: CommentThread; message?: CommentMessage; index: number; replyDraft?: string; editDraft?: CommentDraft['edit'] } | null>(null)
  useEffect(() => { const value = memories.get(p.documentKey); setFilter(value?.filter || 'open'); if (list.current) list.current.scrollTop = value?.scroll || 0; setRemoved(null); setMenu(null) }, [p.documentKey])
  useEffect(() => { const old = memories.get(p.documentKey); memories.set(p.documentKey, { filter, scroll: old?.scroll || 0 }) }, [filter, p.documentKey])
  useEffect(() => { if (p.selected) { const t = p.threads.find(t => t.id === p.selected); if (t && filter !== 'all' && t.status !== filter) setFilter(t.status); requestAnimationFrame(() => root.current?.querySelector(`[data-thread="${p.selected}"]`)?.scrollIntoView({ block: 'nearest' })) } }, [p.selected, p.open])
  useEffect(() => { if (p.open && p.draft.composing) composer.current?.focus() }, [p.open, p.draft.composing])
  useEffect(() => { if (!removed) return; const timer = setTimeout(() => setRemoved(null), 8000); return () => clearTimeout(timer) }, [removed])
  useEffect(() => {
    const workspace = document.querySelector('.workspace')!
    const resize = () => setOverlay(workspace.clientWidth - (document.querySelector('.sidebar')?.getBoundingClientRect().width || 0) - p.width < 520)
    const observer = new ResizeObserver(resize); observer.observe(workspace); observer.observe(document.querySelector('.main-pane')!); const left = document.querySelector('.sidebar'); if (left) observer.observe(left); resize()
    return () => observer.disconnect()
  }, [p.width, p.open, p.documentKey])
  useEffect(() => { if (p.open && overlay && !p.draft.composing) root.current?.querySelector<HTMLButtonElement>('[aria-label="收起评论栏"]')?.focus() }, [p.open, overlay])
  const update = (id: string, fn: (t: CommentThread) => CommentThread) => p.onThreads(p.threads.map(t => t.id === id ? { ...fn(t), updatedAt: new Date().toISOString() } : t))
  const message = (body: string): CommentMessage => { const now = new Date().toISOString(); return { id: crypto.randomUUID(), authorId: p.authorId, authorName: p.author.trim() || '我', body: body.trim(), createdAt: now, updatedAt: now } }
  const post = () => {
    if (!p.draft.text.trim() || p.threads.length >= 2000 || p.error) return
    const now = new Date().toISOString(), id = crypto.randomUUID()
    p.onThreads([...p.threads, { id, status: 'open', anchor: p.draft.anchor, messages: [message(p.draft.text)], createdAt: now, updatedAt: now, resolvedAt: null }]); p.onDraft({ ...p.draft, text: '', anchor: null, composing: false }); p.onSelect(id); setFilter('open')
  }
  const submitKey = (e: React.KeyboardEvent, submit: () => void) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); submit() } }
  const reply = (t: CommentThread) => { const text = p.draft.replies[t.id]; if (!text?.trim() || t.messages.length >= 200 || p.error) return; update(t.id, v => ({ ...v, messages: [...v.messages, message(text)] })); p.onDraft({ ...p.draft, replies: { ...p.draft.replies, [t.id]: '' } }) }
  const edit = () => { const e = p.draft.edit; if (!e?.text.trim()) return; update(e.threadId, t => ({ ...t, messages: t.messages.map(m => m.id === e.messageId ? { ...m, body: e.text.trim(), updatedAt: new Date().toISOString() } : m) })); p.onDraft({ ...p.draft, edit: null }) }
  const remove = (t: CommentThread, m?: CommentMessage) => {
    const editDraft = p.draft.edit?.threadId === t.id && (!m || p.draft.edit.messageId === m.id) ? p.draft.edit : null
    setRemoved({ thread: t, message: m, index: m ? t.messages.indexOf(m) : p.threads.indexOf(t), replyDraft: m ? undefined : p.draft.replies[t.id], editDraft })
    if (m) update(t.id, v => ({ ...v, messages: v.messages.filter(v => v.id !== m.id) })); else p.onThreads(p.threads.filter(v => v.id !== t.id))
    const replies = { ...p.draft.replies }; if (!m) delete replies[t.id]
    p.onDraft({ ...p.draft, replies, edit: editDraft ? null : p.draft.edit })
    setMenu(null)
  }
  const undoDelete = () => {
    if (!removed) return
    if (removed.message) update(removed.thread.id, t => { const messages = [...t.messages]; messages.splice(removed.index, 0, removed.message!); return { ...t, messages } })
    else { const threads = [...p.threads]; threads.splice(removed.index, 0, removed.thread); p.onThreads(threads) }
    p.onDraft({ ...p.draft, replies: removed.replyDraft ? { ...p.draft.replies, [removed.thread.id]: removed.replyDraft } : p.draft.replies, edit: p.draft.edit || removed.editDraft || null })
    setRemoved(null)
  }
  const visible = p.threads.filter(t => filter === 'all' || t.status === filter).sort((a, b) => (a.anchor?.state === 'attached' ? a.anchor.textFrom : Infinity) - (b.anchor?.state === 'attached' ? b.anchor.textFrom : Infinity) || a.createdAt.localeCompare(b.createdAt))
  return <>
    {p.open && overlay && <button className="comment-scrim" aria-label="关闭评论抽屉" onClick={p.onClose}/>}
    <aside ref={root} hidden={!p.open} className={`comment-sidebar ${overlay ? 'as-drawer' : ''}`} style={{ '--comment-width': `${p.width}px` } as CSSProperties} role={overlay ? 'dialog' : 'complementary'} aria-modal={overlay || undefined} aria-label="评论侧栏" onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); p.onClose() }
      if (overlay && e.key === 'Tab') { const items = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,input,select,[tabindex="0"]')].filter(n => n.offsetParent !== null); const first = items[0], last = items.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() } }
    }}>
      <div role="separator" tabIndex={0} aria-label="评论栏宽度" aria-orientation="vertical" aria-valuemin={300} aria-valuemax={440} aria-valuenow={p.width} className="comment-resizer" onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); p.onWidth(Math.min(440, Math.max(300, p.width + (e.key === 'ArrowLeft' ? 10 : -10)))) } }} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault() }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) p.onWidth(Math.min(440, Math.max(300, window.innerWidth - e.clientX))) }}/>
      <header className="comment-header"><div><MessageSquare size={16}/><strong>评论</strong><span>{p.threads.filter(t => t.status === 'open').length}</span></div><button className="icon-button" aria-label="评论署名设置" onClick={() => setAuthorOpen(!authorOpen)}><MoreHorizontal size={17}/></button><button className="icon-button" aria-label="收起评论栏" onClick={p.onClose}><PanelRightClose size={17}/></button></header>
      {authorOpen && <label className="comment-author">评论署名<input aria-label="评论署名" maxLength={80} value={p.author} onChange={e => p.onAuthor(e.target.value)}/><small>仅用于本地显示，不代表身份认证。</small></label>}
      <div className="comment-filter"><select aria-label="评论筛选" value={filter} onChange={e => setFilter(e.target.value)}><option value="open">未解决</option><option value="resolved">已解决</option><option value="all">全部评论</option></select><button disabled={!!p.error} onMouseDown={e => e.preventDefault()} onClick={p.onNew}><Plus size={14}/>添加评论</button></div>
      {p.error && <div className="comment-error" role="alert">{p.error}<p>请保留原配套文件，处理后重新载入；当前内容可另存为。</p></div>}
      {p.source && <p className="comment-hint">源码模式可添加全文评论；选择原文批注请切回即时编辑。</p>}
      {p.overlap.length > 1 && <div className="comment-overlap"><strong>此处有 {p.overlap.length} 条评论</strong>{p.overlap.map(id => { const t = p.threads.find(t => t.id === id); return t && <button key={id} onClick={() => p.onSelect(id)}>{t.messages[0].body.slice(0, 80)}</button> })}</div>}
      <div className="comment-list" ref={list} onScroll={e => memories.set(p.documentKey, { filter, scroll: e.currentTarget.scrollTop })}>
        {p.draft.composing && <section className="comment-compose"><div className="comment-compose-title"><strong>新评论</strong><button className="icon-button" aria-label="收起新评论输入" onClick={() => p.onDraft({ ...p.draft, composing: false, anchor: p.draft.text.trim() ? p.draft.anchor : null })}><X size={14}/></button></div><blockquote>{p.draft.anchor?.originalQuote || '整篇文稿'}</blockquote><textarea ref={composer} aria-label="新评论内容" placeholder="写下想法…" maxLength={10000} value={p.draft.text} onChange={e => p.onDraft({ ...p.draft, text: e.target.value })} onKeyDown={e => submitKey(e, post)}/><div className="comment-compose-actions"><small>Ctrl + Enter 发布</small><button className="comment-primary" disabled={!p.draft.text.trim() || !!p.error} onClick={post}><Send size={13}/>发布</button></div></section>}
        {!p.draft.composing && p.draft.text && <button className="comment-resume" onClick={() => p.onDraft({ ...p.draft, composing: true })}>继续未发送的评论</button>}
        {!visible.length && !p.draft.composing && <div className="comment-empty"><MessageSquare size={30}/><h3>{filter === 'resolved' ? '还没有已解决的评论' : '留一点想法给这篇文稿'}</h3><p>选中文字后按 Ctrl + Alt + M，<br/>或者添加一条全文评论。</p><button disabled={!!p.error} onClick={p.onNew}><Plus size={14}/>添加评论</button></div>}
        {visible.map(t => <article key={t.id} data-thread={t.id} className={`comment-card ${p.selected === t.id ? 'selected' : ''}`} onClick={() => p.onSelect(t.id)}>
          <div className="comment-card-top"><button className="comment-quote" title={t.anchor?.originalQuote || '整篇文稿'} onClick={e => { e.stopPropagation(); p.onSelect(t.id); p.onReveal(t.id) }}>{t.anchor?.originalQuote || '整篇文稿'}</button><button className="icon-button" aria-label={t.status === 'open' ? '解决评论' : '重新打开评论'} title={t.status === 'open' ? '解决评论' : '重新打开评论'} disabled={!!p.error} onClick={() => update(t.id, v => ({ ...v, status: v.status === 'open' ? 'resolved' : 'open', resolvedAt: v.status === 'open' ? new Date().toISOString() : null }))}>{t.status === 'open' ? <Check size={15}/> : <RotateCcw size={14}/>}</button></div>
          {t.anchor?.state === 'detached' && <div className="comment-detached"><span>原文已变化，需要重新关联</span><button disabled={p.source || !!p.error} onMouseDown={e => e.preventDefault()} onClick={() => p.onAttach(t.id)}><Link2 size={12}/>关联到所选文字</button></div>}
          {t.messages.map((m, index) => <div className="comment-message" key={m.id}><div className="comment-byline"><span className="comment-avatar">{m.authorName.slice(0, 1)}</span><strong>{m.authorName}</strong><time title={m.createdAt}>{stamp(m.createdAt)}</time><button className="icon-button" aria-label="评论操作" onClick={() => setMenu(menu === m.id ? null : m.id)}><MoreHorizontal size={14}/></button></div>
            {menu === m.id && <div className="comment-message-actions"><button disabled={!!p.error} onClick={() => { p.onDraft({ ...p.draft, edit: { threadId: t.id, messageId: m.id, text: m.body } }); setMenu(null) }}>编辑</button><button disabled={!!p.error} onClick={() => remove(t, index === 0 ? undefined : m)}>{index === 0 ? '删除整条评论' : '删除回复'}</button></div>}
            {p.draft.edit?.messageId === m.id ? <div className="comment-edit"><textarea aria-label="编辑评论内容" maxLength={10000} value={p.draft.edit.text} onChange={e => p.onDraft({ ...p.draft, edit: { ...p.draft.edit!, text: e.target.value } })} onKeyDown={e => submitKey(e, edit)}/><button onClick={() => p.onDraft({ ...p.draft, edit: null })}>取消</button><button disabled={!p.draft.edit.text.trim() || !!p.error} onClick={edit}>保存修改</button></div> : <p className="comment-body">{m.body}</p>}
          </div>)}
          {(p.selected === t.id || p.draft.replies[t.id]) && <div className="comment-reply"><textarea aria-label="回复内容" placeholder="回复…" maxLength={10000} value={p.draft.replies[t.id] || ''} onChange={e => p.onDraft({ ...p.draft, replies: { ...p.draft.replies, [t.id]: e.target.value } })} onKeyDown={e => submitKey(e, () => reply(t))}/><button disabled={!p.draft.replies[t.id]?.trim() || !!p.error} onClick={() => reply(t)}>回复</button></div>}
        </article>)}
      </div>
      {removed && <div className="comment-undo">已删除<button onClick={undoDelete}>撤销删除</button></div>}
      <footer className="comment-footer"><span title={p.state}>{p.state}</span><button title="文稿移动后，可手动导入对应的评论文件" aria-label="导入评论" onClick={p.onImport}><Upload size={12}/>导入</button></footer>
    </aside>
  </>
}
