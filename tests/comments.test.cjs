const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readDocument, atomicWrite, hash } = require('../electron/storage.cjs');
const { readComments, saveBundle, recoverBundle, sidecarPath, validateComments, journalPath } = require('../electron/comments.cjs');
const blank = () => ({ schemaVersion: 1, documentId: 'doc-one', markdownHash: '', revision: 0, projectionVersion: 'moye-text-v1', threads: [{ id: 'thread-one', status: 'open', anchor: null, createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z', resolvedAt: null, messages: [{ id: 'message-one', authorId: 'me', authorName: '我', body: '测试评论', createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z' }] }] });
test('评论保存与故障恢复', async t => {
  await fs.mkdir('test-results', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results/comments-storage-')), journalDir = path.join(root, 'profile');
  const fixture = async (name = '文稿') => { const p = path.join(root, name + '.md'); await fs.writeFile(p, '\uFEFF# 原文\r\n\r\n必须保留。\r\n'); return { ...await readDocument(p), comments: blank(), commentsHash: null }; };
  await t.test('只保存评论保持正文原始字节及修改时间，评论单独落盘', async () => {
    const doc = await fixture(), bytes = await fs.readFile(doc.path), before = (await fs.stat(doc.path)).mtimeMs;
    const saved = await saveBundle(doc, journalDir); assert.ok(!saved.conflict && !saved.partial);
    assert.deepEqual(await fs.readFile(doc.path), bytes); assert.equal((await fs.stat(doc.path)).mtimeMs, before);
    assert.equal((await readComments(doc.path)).comments.threads[0].messages[0].body, '测试评论');
    saved.comments.threads = []; const empty = await saveBundle(saved, journalDir);
    assert.equal(empty.comments.revision, 2); assert.deepEqual((await readComments(doc.path)).comments.threads, []);
  });
  await t.test('正文、评论各自外部修改均拒绝静默覆盖', async () => {
    let doc = await fixture('冲突'); const saved = await saveBundle(doc, journalDir);
    await fs.writeFile(doc.path, '外部正文'); assert.equal((await saveBundle(saved, journalDir)).kind, 'document');
    doc = { ...await readDocument(doc.path), ...await readComments(doc.path) };
    const outside = JSON.stringify({ ...doc.comments, revision: 90 }); await fs.writeFile(sidecarPath(doc.path), outside);
    assert.equal((await saveBundle({ ...doc, force: true }, journalDir)).kind, 'comments');
    assert.equal(await fs.readFile(sidecarPath(doc.path), 'utf8'), outside);
  });
  await t.test('仅评论更新保留混合换行、BOM 与末尾空白', async () => {
    const p = path.join(root, '混合换行.md'), bytes = Buffer.from('\uFEFF# 标题\r\n\r\n混合\n换行  \r\n末尾没有换行');
    await fs.writeFile(p, bytes); const doc = { ...await readDocument(p), comments: blank(), commentsHash: null };
    const result = await saveBundle(doc, journalDir); assert.deepEqual(await fs.readFile(p), bytes); assert.equal(result.hash, hash(bytes));
  });
  await t.test('评论损坏、未知版本和超限不会当空文件覆盖', async () => {
    const doc = await fixture('损坏');
    for (const value of ['{bad', JSON.stringify({ schemaVersion: 2 }), 'x'.repeat(8 * 1024 * 1024 + 1)]) {
      await fs.writeFile(sidecarPath(doc.path), value); assert.ok((await readComments(doc.path)).commentsError);
      await assert.rejects(saveBundle(doc, journalDir), /评论文件/); assert.equal(await fs.readFile(sidecarPath(doc.path), 'utf8'), value);
    }
    const v = blank(); v.threads[0].messages[0].body = 'a'.repeat(10001); assert.throws(() => validateComments(v), /10000/);
  });
  await t.test('失败发生在正文写入前：原文保留，恢复记录保留', async () => {
    const doc = await fixture('前置失败'), bytes = await fs.readFile(doc.path);
    await assert.rejects(saveBundle({ ...doc, content: '# 新正文' }, journalDir, { beforeBody() { throw new Error('disk full') } }), /disk full/);
    assert.deepEqual(await fs.readFile(doc.path), bytes); await fs.access(journalPath(journalDir, doc.path));
    await assert.rejects(recoverBundle(doc.path, journalDir), /正文已变化/); assert.deepEqual(await fs.readFile(doc.path), bytes);
  });
  await t.test('正文成功评论失败：重开按 hash 恢复，不重复改正文', async () => {
    const doc = await fixture('半保存');
    const result = await saveBundle({ ...doc, content: '# 已保存的正文' }, journalDir, { beforeComments() { throw new Error('injected comment failure') } });
    assert.equal(result.partial, true); const bytes = await fs.readFile(doc.path); assert.equal(hash(bytes), result.hash);
    await recoverBundle(doc.path, journalDir);
    assert.deepEqual(await fs.readFile(doc.path), bytes); assert.equal((await readComments(doc.path)).comments.markdownHash, result.hash);
    await assert.rejects(fs.access(journalPath(journalDir, doc.path)));
  });
  await t.test('部分保存后外部又修改正文或评论：恢复也不能覆盖', async () => {
    for (const kind of ['正文', '评论']) {
      const doc = await fixture('恢复冲突' + kind);
      await saveBundle({ ...doc, content: '# 本地正文' }, journalDir, { beforeComments() { throw new Error('failure') } });
      const target = kind === '正文' ? doc.path : sidecarPath(doc.path), outside = kind === '正文' ? '# 外部正文' : JSON.stringify(blank());
      await fs.writeFile(target, outside); await assert.rejects(recoverBundle(doc.path, journalDir), /已变化/);
      assert.equal(await fs.readFile(target, 'utf8'), outside); await fs.access(journalPath(journalDir, doc.path));
    }
  });
  await t.test('另存为复制评论生成新 ID，目标已有配套文件则冲突', async () => {
    const doc = await fixture('原文件'), saved = await saveBundle(doc, journalDir), old = await fs.readFile(sidecarPath(doc.path));
    const dest = path.join(root, '另存.md'), copy = await saveBundle({ ...saved, path: dest, hash: null, commentsHash: null, newDocument: true }, journalDir);
    assert.notEqual(copy.comments.documentId, saved.comments.documentId); assert.deepEqual(await fs.readFile(sidecarPath(doc.path)), old);
    assert.equal((await saveBundle({ ...saved, path: dest, hash: copy.hash, commentsHash: null, newDocument: true }, journalDir)).kind, 'comments');
  });
  await t.test('配套路径是目录时拒绝写入', async () => {
    const doc = await fixture('目录'); await fs.mkdir(sidecarPath(doc.path));
    assert.ok((await readComments(doc.path)).commentsError); await assert.rejects(saveBundle(doc, journalDir), /链接或目录/);
    assert.equal((await fs.stat(sidecarPath(doc.path))).isDirectory(), true);
  });
  await t.test('原子替换遇临时 EPERM 会重试，永久失败不破坏旧文件', async () => {
    const p = path.join(root, 'retry.txt'); await fs.writeFile(p, 'old'); const rename = fs.rename; let attempts = 0;
    try {
      fs.rename = async (...args) => { if (++attempts < 3) { const e = new Error('busy'); e.code = 'EPERM'; throw e; } return rename(...args); };
      await atomicWrite(p, 'new'); assert.equal(attempts, 3); assert.equal(await fs.readFile(p, 'utf8'), 'new');
      fs.rename = async () => { const e = new Error('busy'); e.code = 'EACCES'; throw e; };
      await assert.rejects(atomicWrite(p, 'must not replace'), /busy/); assert.equal(await fs.readFile(p, 'utf8'), 'new');
    } finally { fs.rename = rename; }
  });
});
