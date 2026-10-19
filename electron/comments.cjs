const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hash, atomicWrite, readDocument } = require('./storage.cjs');
const LIMIT = 8 * 1024 * 1024;
const sidecarPath = documentPath => `${documentPath}.moye-comments.json`;
const invalid = message => { throw new Error(`评论文件：${message}。原文件未改动。`); };
const string = (v, max, empty = false) => typeof v === 'string' && v.length <= max && (empty || v.length > 0);
const validId = v => string(v, 100) && /^[a-zA-Z0-9_-]+$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
function validateComments(value) {
  if (!value || value.schemaVersion !== 1) invalid('不支持的格式版本');
  if (!string(value.documentId, 100) || !string(value.markdownHash, 64, true) || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.projectionVersion !== 'moye-text-v1' || !Array.isArray(value.threads) || value.threads.length > 2000) invalid('结构不正确或数量超限');
  const ids = new Set();
  for (const t of value.threads) {
    if (!t || !validId(t.id) || ids.has(t.id) || !['open', 'resolved'].includes(t.status) || !string(t.createdAt, 40) || !string(t.updatedAt, 40) || !(t.resolvedAt === null || string(t.resolvedAt, 40)) || !Array.isArray(t.messages) || !t.messages.length || t.messages.length > 200) invalid('评论线程无效');
    ids.add(t.id);
    const mids = new Set();
    for (const m of t.messages) {
      if (!m || !validId(m.id) || mids.has(m.id) || !string(m.authorId, 100) || !string(m.authorName, 80) || !string(m.body, 10000) || !string(m.createdAt, 40) || !string(m.updatedAt, 40)) invalid('评论内容无效或超过 10000 字');
      mids.add(m.id);
    }
    const a = t.anchor;
    if (a !== null && (!a || !string(a.associationId, 100) || !['attached', 'detached'].includes(a.state) || !string(a.originalQuote, 20000) || !string(a.currentQuote, 20000, true) || !string(a.prefix, 80, true) || !string(a.suffix, 80, true) || !Number.isSafeInteger(a.textFrom) || !Number.isSafeInteger(a.textTo) || a.textFrom < 0 || a.textTo < a.textFrom || a.textTo > 25 * 1024 * 1024 || !string(a.projectionHash, 100, true) || !Array.isArray(a.blockPath) || a.blockPath.length > 50 || !a.blockPath.every(n => Number.isSafeInteger(n) && n >= 0) || !string(a.blockFingerprint, 100, true))) invalid('引用定位无效');
  }
  if (Buffer.byteLength(JSON.stringify(value)) > LIMIT) invalid('超过 8 MB');
  return value;
}
async function fileHash(p) { try { return hash(await fs.readFile(p)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function safeSidecar(p) {
  try { const stat = await fs.lstat(p); if (stat.isSymbolicLink() || !stat.isFile()) invalid('配套路径不能是链接或目录'); if (stat.size > LIMIT) invalid('超过 8 MB'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
async function readCommentFile(p) {
  await safeSidecar(p);
  const bytes = await fs.readFile(p);
  if (bytes.length > LIMIT) invalid('超过 8 MB');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { invalid('JSON 损坏或编码无效'); }
  return { comments: validateComments(value), commentsHash: hash(bytes) };
}
async function readComments(p) {
  try { return await readCommentFile(sidecarPath(p)); }
  catch (e) { if (e.code === 'ENOENT') return { comments: null, commentsHash: null }; return { comments: null, commentsHash: null, commentsError: e.message }; }
}
function conflict(kind, diskHash) { return { conflict: true, kind, diskHash }; }
const journalPath = (dir, p) => path.join(dir, `comment-save-${hash(path.resolve(p))}.json`);
async function guardedWrite(p, bytes, expected, options = {}) {
  await atomicWrite(p, bytes, { beforeReplace: async () => {
    if (options.sidecar) await safeSidecar(p);
    const actual = await fileHash(p);
    if (actual !== expected) { const e = new Error('文件在保存期间被外部修改'); e.code = 'MOYE_CONFLICT'; throw e; }
  } });
}
async function saveBundle(request, journalDir, hooks = {}) {
  const target = request.path, cp = sidecarPath(target), journal = journalPath(journalDir, target);
  const currentComments = await readComments(target);
  if (currentComments.commentsError) throw new Error(currentComments.commentsError);
  let existingDocument = null;
  try { existingDocument = await readDocument(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const diskHash = existingDocument?.hash ?? null, expectedComments = request.commentsHash ?? null;
  if (!request.force && diskHash !== request.hash) return conflict('document', diskHash);
  // Even an explicit body overwrite cannot silently overwrite external comments.
  if (currentComments.commentsHash !== expectedComments) return conflict('comments', currentComments.commentsHash);
  let comments = request.comments ? structuredClone(validateComments(request.comments)) : currentComments.comments;
  if (request.newDocument && comments) { comments.documentId = randomUUID(); comments.revision = 0; }
  const bytes = Buffer.from(`${request.bom ? '\uFEFF' : ''}${request.content.replace(/\r\n/g, '\n').replace(/\n/g, request.eol || '\n')}`);
  // Comments alone must preserve even mixed line endings and unusual spacing.
  const unchanged = existingDocument && existingDocument.content === request.content && existingDocument.bom === !!request.bom && existingDocument.eol === (request.eol || '\n');
  const nextHash = unchanged ? diskHash : hash(bytes);
  if (comments) { comments.markdownHash = nextHash; comments.revision = (currentComments.comments?.revision || 0) + 1; }
  const commentBytes = comments ? JSON.stringify(comments, null, 2) + '\n' : null;
  const result = { path: target, content: request.content, hash: nextHash, bom: !!request.bom, eol: request.eol || '\n', comments, commentsHash: commentBytes ? hash(commentBytes) : null };
  const record = { schemaVersion: 1, target, oldHash: diskHash, nextHash, oldCommentsHash: expectedComments, result, createdAt: new Date().toISOString() };
  await atomicWrite(journal, JSON.stringify(record));
  let bodySaved = diskHash === nextHash;
  try {
    await hooks.beforeBody?.();
    if (!bodySaved) { await guardedWrite(target, bytes, diskHash); bodySaved = true; }
    await hooks.beforeComments?.();
    if (commentBytes) {
      if (await fileHash(target) !== nextHash) return conflict('document', await fileHash(target));
      await guardedWrite(cp, commentBytes, expectedComments, { sidecar: true });
    }
    await fs.rm(journal, { force: true });
    return result;
  } catch (error) {
    if (bodySaved) return { ...result, commentsHash: expectedComments, partial: true, error: error.message };
    throw error; // Journal and renderer recovery snapshot remain intact.
  }
}
async function recoverBundle(target, journalDir) {
  const jp = journalPath(journalDir, target);
  let record;
  try { record = JSON.parse(await fs.readFile(jp, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (record.schemaVersion !== 1 || record.target !== target || !record.result) throw new Error('保存恢复记录无效，已保留记录。');
  const current = await readComments(target);
  if (current.commentsError) throw new Error(current.commentsError);
  if (await fileHash(target) !== record.nextHash) throw new Error('发现未完成的保存，但正文已变化；恢复草稿保留在本机，请另存为。');
  if (current.commentsHash === record.result.commentsHash) { await fs.rm(jp, { force: true }); return; }
  if (current.commentsHash !== record.oldCommentsHash) throw new Error('发现未完成的保存，但评论已变化；恢复草稿保留在本机，请另存为。');
  if (record.result.comments) {
    const value = validateComments(record.result.comments);
    await guardedWrite(sidecarPath(target), JSON.stringify(value, null, 2) + '\n', current.commentsHash, { sidecar: true });
  }
  await fs.rm(jp, { force: true });
}
module.exports = { sidecarPath, validateComments, readComments, readCommentFile, saveBundle, recoverBundle, fileHash, journalPath };
