import type { CommentFile, CommentDraft } from './comments/types'
export type Document = { path: string | null; content: string; hash: string | null; bom?: boolean; eol?: string; comments?: CommentFile | null; commentsHash?: string | null; commentsError?: string; commentsPending?: boolean; commentDraft?: CommentDraft }
export type TreeItem = { name: string; path: string; children?: TreeItem[] }
export type Settings = { theme: 'light' | 'dark' | 'paper'; fontSize: number; width: number; autoSave: boolean; sidebar: boolean; focus: boolean; typewriter: boolean; serif: boolean; folder?: string; commentsOpen?: boolean; commentsWidth?: number; commentAuthor?: string; commentAuthorId?: string }
export type Heading = { text: string; level: number; pos: number }
export type SaveResult = (Document & { partial?: boolean; error?: string }) | { conflict: true; kind?: string; diskHash: string | null } | null
export type Native = {
  init(): Promise<{ settings: Partial<Settings>; recovery: Document | null; recent: string[]; initialPath: string | null }>
  open(): Promise<Document | null>
  openPath(path: string): Promise<Document>
  openDropped(file: File): Promise<Document>
  folder(): Promise<{ path: string; items: TreeItem[] } | null>
  tree(path: string): Promise<{ path: string; items: TreeItem[] }>
  save(request: Document & { saveAs?: boolean; force?: boolean; imageSources?: string[] }): Promise<SaveResult>
  draft(doc: Document): Promise<boolean>
  clearDraft(): Promise<void>
  commentDraft(request: { path: string | null; draft: CommentDraft }): Promise<void>
  discardRecovery(path: string): Promise<void>
  importComments(documentPath: string): Promise<CommentFile | null>
  settings(settings: Partial<Settings>): Promise<Settings>
  windowsIntegration(): Promise<{ registered: boolean; documentIcon: string; extensions: { extension: string; iconRegistered: boolean; defaultApplicationPreserved: boolean }[] }>
  image(request: { documentPath: string; name: string; bytes: number[] }): Promise<string>
  imageUrl(request: { src: string; documentPath: string | null }): string
  imageData(request: { src: string; documentPath: string | null }): Promise<string>
  export(request: { kind: 'html' | 'pdf'; html: string; title: string }): Promise<string | null>
  reveal(path: string): Promise<void>
  external(url: string): Promise<void>
  window(command: string): Promise<void>
  filePath(file: File): string
  on(name: string, callback: (value: any) => void): () => void
}
declare global { interface Window { moye: Native } }
