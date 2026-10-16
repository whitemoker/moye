import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { PanelLeft, FileText, FolderOpen, ListTree, Search, Plus, ChevronRight, ChevronDown, Code2, MoreHorizontal, Minus, Square, X, Check, ArrowUp, ArrowDown, Replace, ExternalLink, FilePlus2, RefreshCw, Focus, Keyboard, Feather, Circle, BookOpen } from 'lucide-react'
import Editor, { type EditorHandle, type EditorContext } from './Editor'
import type { Document, Heading, Settings, TreeItem } from './types'
import { welcome } from './welcome'
import { exportDocument, imageSources } from './export'

const defaults: Settings = { theme: 'light', fontSize: 16, width: 820, autoSave: true, sidebar: true, focus: false, typewriter: false, serif: false }
const untitled = (content = ''): Document => ({ path: null, content, hash: null, eol: '\n', bom: false })
const basename = (path: string) => path.split(/[\\/]/).pop() || path
type Modal = { title: string; message: string; choices: { label: string; value: string; primary?: boolean; danger?: boolean }[]; resolve(value: string): void }
const flatten = (items: TreeItem[]): TreeItem[] => items.flatMap(i => i.children ? flatten(i.children) : [i])

export default function App() {
  const [doc, setDoc] = useState<Document>(untitled(welcome))
  const docRef = useRef(doc); docRef.current = doc
  const saved = useRef(welcome)
  const [dirty, setDirty] = useState(false)
  const [version, setVersion] = useState(0)
  const [source, setSource] = useState(false)
  const [settings, setSettings] = useState(defaults)
  const settingsRef = useRef(settings); settingsRef.current = settings
  const [headings, setHeadings] = useState<Heading[]>([])
  const [tab, setTab] = useState<'outline' | 'files'>('outline')
  const [folder, setFolder] = useState<{ path: string; items: TreeItem[] } | null>(null)
  const [fileFilter, setFileFilter] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const [menu, setMenu] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<(EditorContext & { x: number; y: number; table: boolean }) | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [modal, setModal] = useState<Modal | null>(null)
  const [panel, setPanel] = useState<'settings' | 'quick' | 'help' | 'link' | 'table' | null>(null)
  const [quick, setQuick] = useState('')
  const [linkTitle, setLinkTitle] = useState('链接文字'), [linkURL, setLinkURL] = useState('https://')
  const [rows, setRows] = useState(3), [cols, setCols] = useState(3)
  const [toast, setToast] = useState(''), toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [saveState, setSaveState] = useState('就绪')
  const [conflict, setConflict] = useState(false)
  const conflictRef = useRef(false)
  const [findOpen, setFindOpen] = useState(false), [replaceOpen, setReplaceOpen] = useState(false)
  const [query, setQuery] = useState(''), [replacement, setReplacement] = useState(''), [caseSensitive, setCaseSensitive] = useState(false), [matchCount, setMatchCount] = useState(0)
  const editor = useRef<EditorHandle>(null), imageInput = useRef<HTMLInputElement>(null), findInput = useRef<HTMLInputElement>(null)
  const pendingSave = useRef<Promise<boolean> | null>(null)
  const busyAction = useRef(false), booted = useRef(false)
  const actionRef = useRef<(action: string) => void>(() => {})
  const say = (message: string) => { clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(''), 4500) }
  const fail = (error: unknown) => { console.error(error); say(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)); setSaveState('操作未完成') }
  const ask = (title: string, message: string, choices: Modal['choices']) => new Promise<string>(resolve => setModal({ title, message, choices, resolve }))
  const choose = (value: string) => { modal?.resolve(value); setModal(null) }
  const patchSettings = (delta: Partial<Settings>) => { settingsRef.current = { ...settingsRef.current, ...delta }; setSettings(settingsRef.current); void window.moye.settings(delta).catch(fail) }
  const closePanel = () => { if (!panel) return; setPanel(null); requestAnimationFrame(() => editor.current?.focus()) }
  const markConflict = (value: boolean) => { conflictRef.current = value; setConflict(value) }
  const snapshot = () => ({ ...docRef.current, content: editor.current?.getContent() ?? docRef.current.content })
  const changed = (content: string) => { const next = { ...docRef.current, content }; docRef.current = next; setDoc(next); setDirty(content !== saved.current); setSaveState(content === saved.current ? '已保存' : '未保存') }
  const load = (next: Document, restored = false) => {
    saved.current = restored ? '\u0000' : next.content
    docRef.current = next; setDoc(next); setDirty(restored); setVersion(v => v + 1); markConflict(false); setSaveState(restored ? '已恢复草稿 · 尚未保存' : next.path ? '已保存' : '就绪'); setHeadings([])
    if (next.path) setRecent(r => [next.path!, ...r.filter(p => p !== next.path)].slice(0, 15))
    if (!restored) void window.moye.clearDraft().catch(fail)
  }
  const refreshTree = async () => { if (folder) { const next = await window.moye.tree(folder.path); setFolder(next) } }
  const save = async (saveAs = false, force = false): Promise<boolean> => {
    if (pendingSave.current) { await pendingSave.current; if (snapshot().content === saved.current && !saveAs) return true }
    const request = snapshot()
    const session = docRef.current
    const operation = (async () => {
      try {
        setSaveState('正在保存…')
        const result = await window.moye.save({ ...request, saveAs, force, imageSources: saveAs ? imageSources(request.content) : [] })
        if (!result) { setSaveState('未保存'); return false }
        if ('conflict' in result) { markConflict(true); setSaveState('磁盘文件已变更'); return false }
        const current = snapshot()
        saved.current = request.content
        const next = { ...current, path: result.path, hash: result.hash, bom: result.bom, eol: result.eol }
        docRef.current = next; setDoc(next); setDirty(current.content !== saved.current); markConflict(false)
        setSaveState(current.content === saved.current ? '已保存' : '未保存')
        if (result.path) setRecent(r => [result.path!, ...r.filter(p => p !== result.path)].slice(0, 15))
        if (current.content === saved.current) await window.moye.clearDraft(); else await window.moye.draft(next)
        if (session.path !== result.path) await refreshTree()
        return true
      } catch (error) { fail(error); return false }
    })()
    pendingSave.current = operation
    try { return await operation } finally { if (pendingSave.current === operation) pendingSave.current = null }
  }
  const safeToLeave = async () => {
    if (pendingSave.current) await pendingSave.current
    const current = snapshot()
    if (current.content === saved.current) return true
    const choice = await ask('保存这篇文稿？', `${current.path ? basename(current.path) : '未命名文稿'} 有尚未保存的修改。`, [{ label: '取消', value: 'cancel' }, { label: '不保存', value: 'discard' }, { label: '保存', value: 'save', primary: true }])
    if (choice === 'discard') { await window.moye.clearDraft(); return true }
    if (choice === 'save') return save()
    return false
  }
  const openPath = async (path: string) => { if (await safeToLeave()) load(await window.moye.openPath(path)) }
  const toggleSource = () => { const next = snapshot(); docRef.current = next; setDoc(next); setDirty(next.content !== saved.current); setSource(v => !v); setVersion(v => v + 1) }
  const uploadImage = async (file: File) => {
    if (!docRef.current.path && !(await save())) throw new Error('请先保存文稿，图片会放在文稿旁的素材文件夹中。')
    return window.moye.image({ documentPath: docRef.current.path!, name: file.name || 'image.png', bytes: [...new Uint8Array(await file.arrayBuffer())] })
  }
  const doFind = (action: string) => setMatchCount(editor.current?.search(query, replacement, action, caseSensitive) || 0)
  const command = async (action: string) => {
    setMenu(null)
    setContextMenu(null)
    try {
      if (action === 'new') { if (await safeToLeave()) load(untitled()); return }
      if (action === 'open') { if (await safeToLeave()) { const next = await window.moye.open(); if (next) load(next) } return }
      if (action === 'folder') { const next = await window.moye.folder(); if (next) { setFolder(next); setTab('files'); patchSettings({ sidebar: true }) } return }
      if (action === 'save' || action === 'saveAs') { await save(action === 'saveAs'); return }
      if (action === 'close') { if (await safeToLeave()) await window.moye.window('close-approved'); return }
      if (action === 'source') { toggleSource(); return }
      if (action === 'sidebar') { patchSettings({ sidebar: !settings.sidebar }); return }
      if (action === 'focus' || action === 'typewriter') { patchSettings({ [action]: !settingsRef.current[action] }); return }
      if (action === 'fullscreen') { await window.moye.window('fullscreen'); return }
      if (action.startsWith('theme:')) { patchSettings({ theme: action.split(':')[1] as Settings['theme'] }); return }
      if (action === 'find' || action === 'replace') { setFindOpen(true); setReplaceOpen(action === 'replace'); setTimeout(() => { findInput.current?.focus(); findInput.current?.select() }, 30); return }
      if (action === 'quick') { setQuick(''); setPanel('quick'); return }
      if (action === 'link') { setLinkTitle(editor.current?.context().selectedText || '链接文字'); setPanel('link'); return }
      if (['settings', 'help', 'link', 'table'].includes(action)) { setPanel(action as typeof panel); return }
      if (action === 'image') { imageInput.current?.click(); return }
      if (action === 'hr') { editor.current?.insert('\n\n---\n\n'); return }
      if (action === 'math') { editor.current?.insert('\n\n$$\nx^2 + y^2 = z^2\n$$\n\n'); return }
      if (action === 'codeblock') { editor.current?.insert('\n\n```\n\n```\n\n'); return }
      if (action === 'html' || action === 'pdf') {
        setSaveState('正在导出…')
        const current = snapshot()
        const result = await exportDocument(action, current, current.path ? basename(current.path).replace(/\.[^.]+$/, '') : headings[0]?.text || '未命名')
        setSaveState(dirty ? '未保存' : '已保存'); if (result) say(`已导出：${basename(result)}`); return
      }
      editor.current?.command(action)
    } catch (error) { fail(error) }
  }
  actionRef.current = action => {
    if (busyAction.current) return
    busyAction.current = true
    void command(action).finally(() => { busyAction.current = false })
  }
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return
    const bounds = contextMenuRef.current.getBoundingClientRect()
    const x = Math.max(8, Math.min(contextMenu.x, window.innerWidth - bounds.width - 8))
    const y = Math.max(42, Math.min(contextMenu.y, window.innerHeight - bounds.height - 8))
    if (x !== contextMenu.x || y !== contextMenu.y) setContextMenu(current => current && ({ ...current, x, y }))
  }, [contextMenu])
  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) return
      setContextMenu(null)
    }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => { window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss) }
  }, [contextMenu])
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void window.moye.init().then(async init => {
      setSettings({ ...defaults, ...init.settings }); setRecent(init.recent)
      if (init.settings.folder) { try { setFolder(await window.moye.tree(init.settings.folder)) } catch { /* Missing folder is not fatal. */ } }
      if (init.recovery) {
        const choice = await ask('找回上次的文稿', '发现一份尚未保存的草稿。恢复后可以继续编辑，原文件不会被立即覆盖。', [{ label: '丢弃草稿', value: 'discard' }, { label: '恢复文稿', value: 'restore', primary: true }])
        if (choice === 'restore') { load(init.recovery, true); return }
        await window.moye.clearDraft()
      }
      if (init.initialPath) load(await window.moye.openPath(init.initialPath))
    }).catch(fail)
    return window.moye.on('command', action => actionRef.current(action))
  }, [])
  useEffect(() => window.moye.on('open-request', path => { void openPath(path).catch(fail) }), [doc])
  useEffect(() => window.moye.on('externalChange', async event => {
    if (pendingSave.current) await pendingSave.current
    const current = snapshot()
    if (event.path !== current.path || event.hash === current.hash) return
    if (current.content !== saved.current || event.hash === null) { markConflict(true); return }
    try { load(await window.moye.openPath(current.path!)); say('已同步外部修改') } catch (error) { fail(error) }
  }), [])
  useEffect(() => {
    if (!dirty) return
    const timer = setTimeout(() => { void window.moye.draft(snapshot()).catch(fail) }, 350)
    return () => clearTimeout(timer)
  }, [doc, dirty])
  useEffect(() => {
    if (!dirty || !doc.path || !settings.autoSave || conflict || modal) return
    const timer = setTimeout(() => { if (!conflictRef.current && !busyAction.current) void save() }, 1400)
    return () => clearTimeout(timer)
  }, [doc, dirty, settings.autoSave, conflict, modal])
  useEffect(() => { if (findOpen) doFind('highlight') }, [query, caseSensitive, findOpen, doc.content, source])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(null); setContextMenu(null); if (modal) return; closePanel(); setFindOpen(false); editor.current?.search('', '', 'highlight', false); return }
      if (modal || panel === 'link' || panel === 'table') return
      const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase()
      let action = ''
      if (mod) {
        if (key === 'n') action = 'new'
        else if (key === 'o') action = event.shiftKey ? 'folder' : 'open'
        else if (key === 's') action = event.shiftKey ? 'saveAs' : 'save'
        else if (key === '/') action = 'source'
        else if (key === 'f') action = 'find'
        else if (key === 'h') action = 'replace'
        else if (key === 'p') action = 'quick'
        else if (key === 'w') action = 'close'
        else if (key === 'b' && event.shiftKey) action = 'sidebar'
        else if (key === 'b') action = 'bold'
        else if (key === 'i') action = 'italic'
        else if (key === ',') action = 'settings'
        else if (key === 'k') action = 'link'
        else if (/^[1-6]$/.test(key)) action = 'h' + key
        else if (key === '0') action = 'paragraph'
      } else if (event.key === 'F8') action = 'focus'
      else if (event.key === 'F9') action = 'typewriter'
      else if (event.key === 'F11') action = 'fullscreen'
      if (action) { event.preventDefault(); event.stopPropagation(); actionRef.current(action) }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [modal, panel])
  const menus: Record<string, [string, string, string?][]> = {
    '文件': [['新建文稿', 'new', 'Ctrl+N'], ['打开文件…', 'open', 'Ctrl+O'], ['打开文件夹…', 'folder', 'Ctrl+Shift+O'], ['快速打开…', 'quick', 'Ctrl+P'], ['—', ''], ['保存', 'save', 'Ctrl+S'], ['另存为…', 'saveAs', 'Ctrl+Shift+S'], ['—', ''], ['导出 PDF…', 'pdf'], ['导出 HTML…', 'html'], ['—', ''], ['关闭窗口', 'close', 'Ctrl+W']],
    '编辑': [['撤销', 'undo', 'Ctrl+Z'], ['重做', 'redo', 'Ctrl+Y'], ['—', ''], ['查找', 'find', 'Ctrl+F'], ['查找与替换', 'replace', 'Ctrl+H'], ['—', ''], ['偏好设置', 'settings', 'Ctrl+,']],
    '段落': [['正文', 'paragraph', 'Ctrl+0'], ['一级标题', 'h1', 'Ctrl+1'], ['二级标题', 'h2', 'Ctrl+2'], ['三级标题', 'h3', 'Ctrl+3'], ['四级标题', 'h4', 'Ctrl+4'], ['—', ''], ['引用', 'quote'], ['无序列表', 'bullet'], ['有序列表', 'ordered'], ['任务清单', 'task'], ['—', ''], ['代码块', 'codeblock'], ['表格…', 'table'], ['数学公式', 'math'], ['分隔线', 'hr']],
    '格式': [['加粗', 'bold', 'Ctrl+B'], ['斜体', 'italic', 'Ctrl+I'], ['删除线', 'strike'], ['行内代码', 'code'], ['—', ''], ['插入链接…', 'link', 'Ctrl+K'], ['插入图片…', 'image']],
    '视图': [[source ? '即时编辑' : '源代码模式', 'source', 'Ctrl+/'], ['侧边栏', 'sidebar', 'Ctrl+Shift+B'], ['专注模式', 'focus', 'F8'], ['打字机模式', 'typewriter', 'F9'], ['全屏', 'fullscreen', 'F11']],
    '主题': [['素白', 'theme:light'], ['暖纸', 'theme:paper'], ['深夜', 'theme:dark']],
    '帮助': [['快捷键与使用说明', 'help']],
  }
  const files = folder ? flatten(folder.items) : recent.map(p => ({ name: basename(p), path: p }))
  const quickFiles = [...new Map([...files, ...recent.map(p => ({ name: basename(p), path: p }))].map(i => [i.path, i])).values()].filter(i => `${i.name} ${i.path}`.toLowerCase().includes(quick.toLowerCase()))
  const textForCount = doc.content.replace(/```[\s\S]*?```/g, ' ').replace(/[#*`>~|\[\]()]/g, '')
  const wordCount = (textForCount.match(/[\u3400-\u9fff]|[\p{L}\p{N}_]+/gu) || []).length
  const title = doc.path ? basename(doc.path) : doc.content === welcome ? '欢迎来到墨页.md' : '未命名.md'

  return <div className={`app theme-${settings.theme} ${settings.focus ? 'focus-mode' : ''} ${settings.typewriter ? 'typewriter-mode' : ''} ${settings.serif ? 'serif' : ''}`} style={{ '--editor-font-size': `${settings.fontSize}px`, '--page-width': `${settings.width}px` } as CSSProperties} onClick={() => { if (menu) setMenu(null); if (contextMenu) setContextMenu(null) }} onContextMenuCapture={e => {
    const target = e.target as HTMLElement
    if (!target.closest('.editor-host') || target.closest('input,textarea')) return
    const selection = editor.current?.context()
    if (!selection) return
    e.preventDefault(); e.stopPropagation(); setMenu(null)
    setContextMenu({ x: e.clientX, y: e.clientY, table: !!target.closest('.ProseMirror td,.ProseMirror th'), ...selection })
  }} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDropCapture={e => {
    const file = e.dataTransfer.files[0]
    if (!file || !/\.(md|markdown|mdown|txt)$/i.test(file.name)) return
    e.preventDefault(); e.stopPropagation()
    if (busyAction.current) return
    busyAction.current = true
    void (async () => { if (await safeToLeave()) load(await window.moye.openDropped(file)) })().catch(fail).finally(() => { busyAction.current = false })
  }}>
    <header className="titlebar"><div className="brand"><Feather size={17}/><span>墨页</span></div><nav className="menubar" aria-label="主菜单">{Object.entries(menus).map(([label, items]) => <div className="menu-root" key={label}><button className={menu === label ? 'active' : ''} onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); setMenu(menu === label ? null : label) }}>{label}</button>{menu === label && <div className="dropdown" role="menu">{items.map(([text, action, shortcut], i) => text === '—' ? <hr key={i}/> : <button role={action.startsWith("theme:") ? "menuitemradio" : ["focus", "typewriter", "sidebar", "source"].includes(action) ? "menuitemcheckbox" : "menuitem"} aria-checked={action.startsWith("theme:") ? settings.theme === action.slice(6) : action === "source" ? source : action === "focus" || action === "typewriter" || action === "sidebar" ? settings[action] : undefined} key={action} onMouseDown={e => e.preventDefault()} onClick={() => actionRef.current(action)}><span>{text}{(action === `theme:${settings.theme}` || action === "source" && source || action === "focus" && settings.focus || action === "typewriter" && settings.typewriter || action === "sidebar" && settings.sidebar) && <Check className="menu-check" size={13}/>}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>)}</div>}</div>)}</nav><div className="titlebar-name">{dirty && <span className="dirty-dot"/>}{title}</div><div className="window-buttons"><button aria-label="最小化" onClick={() => window.moye.window('minimize')}><Minus size={15}/></button><button aria-label="最大化" onClick={() => window.moye.window('maximize')}><Square size={12}/></button><button className="window-close" aria-label="关闭" onClick={() => actionRef.current('close')}><X size={17}/></button></div></header>
    <div className="workspace">
      {settings.sidebar && <aside className="sidebar"><div className="sidebar-tabs"><button className={tab === 'files' ? 'selected' : ''} onClick={() => setTab('files')}><FolderOpen size={15}/>文件</button><button className={tab === 'outline' ? 'selected' : ''} onClick={() => setTab('outline')}><ListTree size={16}/>大纲</button><button className="icon-button collapse" title="收起侧边栏" aria-label="收起侧边栏" onClick={() => patchSettings({ sidebar: false })}><PanelLeft size={16}/></button></div>
        {tab === 'outline' ? <><div className="sidebar-label">文稿大纲 <span>{headings.length}</span></div><div className="outline">{headings.length ? headings.map((h, i) => <button key={i} style={{ paddingLeft: 18 + (h.level - 1) * 12 }} onClick={() => editor.current?.heading(h.pos)} className={i === 0 ? 'outline-title' : ''}><span className="heading-marker">{h.level === 1 ? '#' : '·'}</span><span>{h.text || '未命名标题'}</span></button>) : <div className="empty-outline"><ListTree size={28}/><p>标题会出现在这里</p><small>输入 # 和空格，开始一个标题</small></div>}</div></> : <><div className="file-tools"><div className="file-search"><Search size={14}/><input placeholder="筛选文件…" aria-label="筛选文件" value={fileFilter} onChange={e => setFileFilter(e.target.value)}/></div></div><div className="sidebar-label"><span title={folder?.path}>{folder ? basename(folder.path) : '最近打开'}</span><div><button className="icon-button" title="新建文稿" aria-label="新建文稿" onClick={() => actionRef.current('new')}><Plus size={15}/></button>{folder && <button className="icon-button" title="刷新文件夹" aria-label="刷新文件夹" onClick={() => refreshTree().catch(fail)}><RefreshCw size={13}/></button>}</div></div><div className="file-list">{fileFilter ? files.filter(f => f.name.toLowerCase().includes(fileFilter.toLowerCase())).map(f => <FileRow key={f.path} item={f} current={doc.path} onOpen={p => void openPath(p).catch(fail)}/>) : (folder?.items || recent.map(p => ({ name: basename(p), path: p }))).map(f => <FileRow key={f.path} item={f} current={doc.path} onOpen={p => void openPath(p).catch(fail)}/>)}{!files.length && <div className="empty-outline"><FolderOpen size={28}/><p>从一个文件夹开始</p><small>让文稿和素材待在一起</small></div>}</div></>}
        <div className="sidebar-bottom"><button onClick={() => actionRef.current('folder')}><FolderOpen size={16}/><span>{folder ? '切换文件夹' : '打开文件夹'}</span><span className="key-hint">↗</span></button></div></aside>}
      <main className="main-pane"><div className="document-toolbar"><div className="document-location">{!settings.sidebar && <button className="icon-button" title="展开侧边栏" aria-label="展开侧边栏" onClick={() => patchSettings({ sidebar: true })}><PanelLeft size={17}/></button>}<FileText size={15}/><span title={doc.path || '尚未保存'}>{doc.path && <span className="breadcrumb">{basename(doc.path.replace(/[\\/][^\\/]+$/, ''))}<ChevronRight size={12}/></span>}{title}</span>{dirty && <span className="dirty-dot"/>}</div><div className="document-actions"><button className={`mode-switch ${source ? 'is-source' : ''}`} onClick={() => actionRef.current('source')} title="切换源码 Ctrl+/"><Code2 size={15}/>{source ? '源代码' : '即时编辑'}</button><span className="toolbar-divider"/><button className="icon-button" title="查找 Ctrl+F" aria-label="查找" onClick={() => actionRef.current('find')}><Search size={16}/></button><button className="icon-button" title="写作设置" aria-label="写作设置" onClick={() => setPanel('settings')}><MoreHorizontal size={18}/></button></div></div>
        {conflict && <div className="conflict-banner" role="alert"><span>文件在外部发生了修改或被移除，自动保存已暂停。</span><button onClick={async () => { const choice = await ask('载入磁盘版本？', '当前文稿中的未保存修改将被替换。', [{ label: '取消', value: 'cancel' }, { label: '载入磁盘版本', value: 'yes', primary: true }]); if (choice === 'yes' && doc.path) { try { load(await window.moye.openPath(doc.path)) } catch (e) { fail(e) } } }}>载入磁盘版本</button><button onClick={() => actionRef.current('saveAs')}>另存为</button><button onClick={async () => { const choice = await ask('覆盖磁盘文件？', '将用当前文稿替换磁盘上的内容。', [{ label: '取消', value: 'cancel' }, { label: '覆盖保存', value: 'yes', danger: true }]); if (choice === 'yes') await save(false, true) }}>覆盖保存</button></div>}
        {findOpen && <div className="find-panel"><div className="find-row"><Search size={15}/><input ref={findInput} aria-label="查找内容" placeholder="查找文稿…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doFind(e.shiftKey ? 'prev' : 'next') } }}/><button className={caseSensitive ? 'case-button active' : 'case-button'} title="区分大小写" onClick={() => setCaseSensitive(v => !v)}>Aa</button><span className="match-count">{query ? `${matchCount} 处` : ''}</span><button className="icon-button" aria-label="上一个匹配" onClick={() => doFind('prev')}><ArrowUp size={15}/></button><button className="icon-button" aria-label="下一个匹配" onClick={() => doFind('next')}><ArrowDown size={15}/></button><button className="icon-button" aria-label="展开替换" onClick={() => setReplaceOpen(v => !v)}><Replace size={16}/></button><button className="icon-button" aria-label="关闭查找" onClick={() => { setFindOpen(false); editor.current?.search('', '', 'highlight', false) }}><X size={15}/></button></div>{replaceOpen && <div className="find-row replace-row"><Replace size={15}/><input aria-label="替换内容" placeholder="替换为…" value={replacement} onChange={e => setReplacement(e.target.value)}/><button onClick={() => doFind('replace')}>替换</button><button onClick={() => doFind('all')}>全部替换</button></div>}</div>}
        <Editor key={`${version}-${source}`} ref={editor} content={doc.content} source={source} dark={settings.theme === 'dark'} typewriter={settings.typewriter} documentPath={doc.path} onChange={changed} onHeadings={setHeadings} onReady={() => { if (findOpen) doFind('highlight') }} onError={fail} onImage={uploadImage}/>
        <footer className="statusbar"><div><button className={settings.focus ? 'enabled' : ''} aria-label="专注模式" aria-pressed={settings.focus} title={`${settings.focus ? '关闭' : '开启'}专注模式：突出当前内容，周围文字轻微淡化（F8）`} onMouseDown={e => e.preventDefault()} onClick={() => actionRef.current('focus')}><Focus size={13}/>专注{settings.focus && <Check size={11}/>}</button><button className={settings.typewriter ? 'enabled' : ''} aria-label="打字机模式" aria-pressed={settings.typewriter} title={`${settings.typewriter ? '关闭' : '开启'}打字机模式：当前输入行保持居中（F9）`} onMouseDown={e => e.preventDefault()} onClick={() => actionRef.current('typewriter')}><Keyboard size={13}/>打字机{settings.typewriter && <Check size={11}/>}</button><span className="status-separator"/><span className="save-status">{!dirty && doc.path ? <Check size={12}/> : null}{saveState}</span></div><div><span>{wordCount.toLocaleString()} 字</span><span className="status-separator"/><span>约 {Math.max(1, Math.ceil(wordCount / 400))} 分钟</span><span className="status-separator"/><span>UTF-8</span><button title="调整字号" onClick={() => setPanel('settings')}>{settings.fontSize}px</button></div></footer>
      </main>
    </div>
    <input ref={imageInput} className="hidden" type="file" accept="image/*" onChange={async e => { const file = e.target.files?.[0]; if (file) { try { const src = await uploadImage(file); editor.current?.insert(`\n\n![${file.name.replace(/[\[\]]/g, '')}](${src})\n\n`) } catch (error) { fail(error) } } e.target.value = '' }}/>
    {contextMenu && <div ref={contextMenuRef} className="dropdown editor-context-menu" role="menu" aria-label="文稿右键菜单" style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 70 }}>
      {[['加粗', 'bold', 'Ctrl+B'], ['斜体', 'italic', 'Ctrl+I'], ['删除线', 'strike', ''], ['行内代码', 'code', ''], ['行内公式', 'inline-math', ''], ['插入链接…', 'link', 'Ctrl+K']].map(([label, action, shortcut]) => <button role="menuitemcheckbox" aria-checked={contextMenu.activeFormats.includes(action)} disabled={!contextMenu.canFormat || (action === 'inline-math' && !contextMenu.selectedText)} key={action} onMouseDown={e => e.preventDefault()} onClick={() => actionRef.current(action)}><span className="context-label"><span className="context-check">{contextMenu.activeFormats.includes(action) && <Check size={14}/>}</span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>)}
      {contextMenu.table && <><hr/>{[['下方插入行', 'table-row'], ['右侧插入列', 'table-col'], ['删除当前行', 'table-delete-row'], ['删除当前列', 'table-delete-col'], ['删除表格', 'table-delete']].map(([label, action]) => <button role="menuitem" key={action} onMouseDown={e => e.preventDefault()} onClick={() => actionRef.current(action)}>{label}{action === 'table-row' && <kbd>Ctrl+Enter</kbd>}</button>)}</>}
    </div>}
    {toast && <div className="toast" role="status">{toast}<button aria-label="关闭提示" onClick={() => setToast('')}><X size={14}/></button></div>}
    {modal && <div className="modal-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-label={modal.title}><h2>{modal.title}</h2><p>{modal.message}</p><div className="dialog-actions">{modal.choices.map(c => <button key={c.value} className={c.primary ? 'primary' : c.danger ? 'danger' : ''} onClick={() => choose(c.value)}>{c.label}</button>)}</div></section></div>}
    {panel && !modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closePanel() }}><section className={`dialog panel-${panel}`} role="dialog" aria-modal="true" aria-label={panel === 'settings' ? '偏好设置' : panel === 'quick' ? '快速打开' : panel === 'help' ? '使用说明' : panel === 'table' ? '插入表格' : '插入链接'}><button className="dialog-close icon-button" aria-label="关闭面板" onClick={closePanel}><X size={18}/></button>
      {panel === 'settings' && <><div className="eyebrow">MAKE ROOM FOR WORDS</div><h2>让写作更合心意</h2><p className="dialog-subtitle">安静一点，舒服一点。</p><label className="setting-label">页面主题</label><div className="theme-options">{(['light', 'paper', 'dark'] as const).map((t, i) => <button className={`theme-card theme-card-${t} ${settings.theme === t ? 'chosen' : ''}`} key={t} onClick={() => patchSettings({ theme: t })}><span className="theme-sample">Aa<span>文字的样子</span></span><span>{['素白', '暖纸', '深夜'][i]}{settings.theme === t && <Check size={14}/>}</span></button>)}</div><div className="setting-row"><label htmlFor="font-size">正文字号 <span>{settings.fontSize}px</span></label><input id="font-size" type="range" min="13" max="24" value={settings.fontSize} onChange={e => patchSettings({ fontSize: Number(e.target.value) })}/></div><div className="setting-row"><label htmlFor="page-width">文稿宽度 <span>{settings.width}px</span></label><input id="page-width" type="range" min="620" max="1100" step="20" value={settings.width} onChange={e => patchSettings({ width: Number(e.target.value) })}/></div><Toggle label="衬线字体" hint="更接近纸张的阅读感" value={settings.serif} onChange={v => patchSettings({ serif: v })}/><Toggle label="自动保存" hint="停止输入后保存；新文稿先手动选择位置" value={settings.autoSave} onChange={v => patchSettings({ autoSave: v })}/><Toggle label="专注模式" hint="保留整组高亮，周围文字仅轻微淡化（F8）" value={settings.focus} onChange={v => patchSettings({ focus: v })}/><Toggle label="打字机模式" hint="当前输入行保持居中；拖选文字时暂停跟随（F9）" value={settings.typewriter} onChange={v => patchSettings({ typewriter: v })}/><div className="setting-row"><label>Windows 文件图标</label><button type="button" onClick={async () => { try { await window.moye.windowsIntegration(); say('文件图标和打开方式已注册') } catch (error) { fail(error) } }}>注册图标与打开方式</button></div><div className="settings-note">草稿恢复始终开启，所有内容只保存在本机。</div></>}
      {panel === 'quick' && <><div className="quick-input"><Search size={20}/><input autoFocus placeholder="按名称快速打开…" aria-label="快速打开搜索" value={quick} onChange={e => setQuick(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && quickFiles[0]) { setPanel(null); void openPath(quickFiles[0].path).catch(fail) } }}/><kbd>ESC</kbd></div><div className="quick-list">{quickFiles.slice(0, 30).map(f => <button key={f.path} onClick={() => { setPanel(null); void openPath(f.path).catch(fail) }}><FileText size={18}/><span>{f.name}<small>{f.path}</small></span></button>)}{!quickFiles.length && <p>没有匹配文件，先打开一个文件或文件夹。</p>}</div></>}
      {panel === 'help' && <><Feather className="about-logo" size={36}/><h2>墨页 <small>0.1.4</small></h2><p>专注文字，也照顾每一个日常细节。</p><div className="shortcuts">{[['新建 / 打开 / 保存', 'Ctrl + N / O / S'], ['源码 / 即时编辑', 'Ctrl + /'], ['快速打开', 'Ctrl + P'], ['查找 / 替换', 'Ctrl + F / H'], ['加粗 / 斜体', 'Ctrl + B / I'], ['标题 1–6 / 正文', 'Ctrl + 1–6 / 0'], ['插入链接', 'Ctrl + K'], ['侧边栏', 'Ctrl + Shift + B'], ['专注 / 打字机模式', 'F8 / F9'], ['全屏', 'F11']].map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div><p className="help-note">专注模式突出当前段落或整组内容，周围文字仅轻微淡化。打字机模式让当前输入行保持居中，拖选文字时暂停跟随。两个模式可在“视图”菜单中开关，鼠标停在底部图标上可查看说明。</p><p className="help-note">页面主题、字号和文稿宽度在右上角三个点的写作设置中调整；主题也可从顶部“主题”菜单选择。</p><p className="help-note">表格支持悬浮菜单增删行列；图片可粘贴、拖放或从格式菜单插入。Ctrl + 点击打开链接。所有文稿使用普通 Markdown 格式。</p><p className="help-note">首次保存会根据文稿标题或首段建议文件名，同名时自动编号；另存为保留原文件名。Windows 文件图标可在写作设置中注册，注册后也可从“打开方式”选择墨页。</p><p className="help-note">首次编辑后，编辑器会规范化 Markdown 的空白与标记。复杂图表暂以代码显示；不支持的扩展语法建议使用源码模式。</p></>}
      {panel === 'link' && <form onSubmit={e => { e.preventDefault(); editor.current?.insert(`[${linkTitle.replace(/[\[\]]/g, '')}](${linkURL.replace(/\)/g, '%29')})`); setPanel(null) }}><h2>插入链接</h2><label className="input-label">显示文字<input autoFocus value={linkTitle} onChange={e => setLinkTitle(e.target.value)}/></label><label className="input-label">链接地址<input required value={linkURL} onChange={e => setLinkURL(e.target.value)}/></label><div className="dialog-actions"><button type="button" onClick={() => setPanel(null)}>取消</button><button type="submit" className="primary">插入链接</button></div></form>}
      {panel === 'table' && <form onSubmit={e => { e.preventDefault(); const header = Array.from({ length: cols }, (_, i) => `列 ${i + 1}`); const line = (a: string[]) => '| ' + a.join(' | ') + ' |'; const md = [line(header), line(header.map(() => '---')), ...Array.from({ length: rows }, () => line(header.map(() => ' ')))].join('\n'); editor.current?.insert(`\n\n${md}\n\n`); setPanel(null) }}><h2>插入表格</h2><p>插入后可以直接编辑单元格、增删行列。</p><div className="table-dimensions"><label className="input-label">正文行数<input type="number" min="1" max="50" value={rows} onChange={e => setRows(Math.min(50, Math.max(1, Number(e.target.value))))}/></label><span>×</span><label className="input-label">列数<input type="number" min="1" max="12" value={cols} onChange={e => setCols(Math.min(12, Math.max(1, Number(e.target.value))))}/></label></div><div className="dialog-actions"><button type="button" onClick={() => setPanel(null)}>取消</button><button type="submit" className="primary">插入表格</button></div></form>}
    </section></div>}
  </div>
}

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange(v: boolean): void }) { return <div className="toggle-row"><div><span>{label}</span><small>{hint}</small></div><button className={`toggle ${value ? 'on' : ''}`} role="switch" aria-label={label} aria-checked={value} onClick={() => onChange(!value)}><span/></button></div> }
function FileRow({ item, current, onOpen, depth = 0 }: { item: TreeItem; current: string | null; onOpen(path: string): void; depth?: number }) {
  const [expanded, setExpanded] = useState(true)
  return <div><button title={item.path} className={`file-row ${item.path === current ? 'current' : ''}`} style={{ paddingLeft: 15 + depth * 13 }} onClick={() => item.children ? setExpanded(v => !v) : onOpen(item.path)}>{item.children ? expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/> : <FileText size={14}/>}<span>{item.name}</span></button>{item.children && expanded && item.children.map(child => <FileRow key={child.path} item={child} current={current} onOpen={onOpen} depth={depth + 1}/>)}</div>
}
