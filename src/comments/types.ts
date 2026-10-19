export type Anchor = {
  associationId: string
  state: 'attached' | 'detached'; originalQuote: string; currentQuote: string
  prefix: string; suffix: string; textFrom: number; textTo: number
  projectionHash: string; blockPath: number[]; blockFingerprint: string
}
export type CommentMessage = { id: string; authorId: string; authorName: string; body: string; createdAt: string; updatedAt: string }
export type CommentThread = { id: string; status: 'open' | 'resolved'; anchor: Anchor | null; messages: CommentMessage[]; createdAt: string; updatedAt: string; resolvedAt: string | null }
export type CommentFile = { schemaVersion: 1; documentId: string; markdownHash: string; revision: number; projectionVersion: 'moye-text-v1'; threads: CommentThread[] }
export type CommentDraft = { text: string; anchor: Anchor | null; composing: boolean; replies: Record<string, string>; edit: { threadId: string; messageId: string; text: string } | null }
export const emptyDraft = (): CommentDraft => ({ text: '', anchor: null, composing: false, replies: {}, edit: null })
export const hasDraft = (d?: CommentDraft) => !!d && (!!d.text.trim() || Object.values(d.replies).some(s => s.trim()) || !!d.edit?.text.trim())
export const newComments = (): CommentFile => ({ schemaVersion: 1, documentId: crypto.randomUUID(), markdownHash: '', revision: 0, projectionVersion: 'moye-text-v1', threads: [] })
// Disk revision/hash are acknowledgments; semantic changes determine dirty state.
export const commentSignature = (c?: CommentFile | null) => JSON.stringify(c?.threads || [])
