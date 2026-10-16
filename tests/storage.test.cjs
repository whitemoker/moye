const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readDocument, saveDocument, atomicWrite, listMarkdown, isInside, hash, copyRelativeImages } = require('../electron/storage.cjs');
const root = path.resolve(__dirname, '../test-results/storage');

test('保存、编码、冲突与文件列表', async t => {
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'run-'));
  await t.test('UTF-8 中文、BOM 和 CRLF 往返，原文不变', async () => {
    const file = path.join(dir, '中文.md');
    const original = Buffer.from('\uFEFF# 中文\r\n\r\n段落 **重要**\r\n');
    await fs.writeFile(file, original);
    const doc = await readDocument(file);
    assert.equal(doc.bom, true); assert.equal(doc.eol, '\r\n');
    const result = await saveDocument(file, doc.content, doc.hash, doc);
    assert.ok(!result.conflict); assert.deepEqual(await fs.readFile(file), original);
  });
  await t.test('检测外部修改，保留磁盘内容，显式覆盖才允许替换', async () => {
    const file = path.join(dir, '冲突.md');
    await fs.writeFile(file, 'old'); const doc = await readDocument(file);
    await fs.writeFile(file, 'external');
    assert.equal((await saveDocument(file, 'my writing', doc.hash)).conflict, true);
    assert.equal(await fs.readFile(file, 'utf8'), 'external');
    const result = await saveDocument(file, 'my writing', doc.hash, { force: true });
    assert.equal(result.hash, hash('my writing'));
  });
  await t.test('删除后的文件不能静默重新生成', async () => {
    const file = path.join(dir, 'deleted.md'); await fs.writeFile(file, 'old');
    const doc = await readDocument(file); await fs.unlink(file);
    assert.equal((await saveDocument(file, 'new', doc.hash)).conflict, true);
    await assert.rejects(fs.access(file));
  });
  await t.test('非 UTF-8 及二进制文档拒绝打开，原始字节保留', async () => {
    const file = path.join(dir, 'gbk.md'), bytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
    await fs.writeFile(file, bytes); await assert.rejects(readDocument(file), /UTF-8/);
    assert.deepEqual(await fs.readFile(file), bytes);
    await fs.writeFile(file, 'text\0binary'); await assert.rejects(readDocument(file), /二进制/);
  });
  await t.test('原子写入失败时旧文件不受影响，临时文件不残留', async () => {
    const directory = path.join(dir, 'directory'); await fs.mkdir(directory);
    await assert.rejects(atomicWrite(directory, 'new'));
    assert.equal((await fs.stat(directory)).isDirectory(), true);
    assert.equal((await fs.readdir(dir)).some(n => n.endsWith('.tmp')), false);
  });
  await t.test('目录只展示文稿，跳过工程与隐藏目录', async () => {
    await fs.mkdir(path.join(dir, 'node_modules')); await fs.writeFile(path.join(dir, 'node_modules', 'hidden.md'), '# no');
    await fs.mkdir(path.join(dir, 'chapters')); await fs.writeFile(path.join(dir, 'chapters', 'one.md'), '# yes');
    await fs.writeFile(path.join(dir, 'image.png'), 'not markdown');
    const items = await listMarkdown(dir);
    assert.equal(items.some(i => i.name === 'node_modules' || i.name === 'image.png'), false);
    assert.equal(items.find(i => i.name === 'chapters').children[0].name, 'one.md');
  });
  await t.test('路径边界不接受同名前缀和上级路径', () => {
    assert.equal(isInside(dir, path.join(dir, 'a.md')), true);
    assert.equal(isInside(dir, `${dir}-other/a.md`), false);
    assert.equal(isInside(dir, path.join(dir, '..', 'other.md')), false);
  });
  await t.test('另存为复制相对图片并保持字节一致', async () => {
    const from = path.join(dir, 'original', 'doc.md'), to = path.join(dir, 'copy', 'copy.md');
    await fs.mkdir(path.join(path.dirname(from), 'images'), { recursive: true });
    await fs.writeFile(path.join(path.dirname(from), 'images', 'test.png'), Buffer.from([1, 2, 3]));
    await copyRelativeImages(from, to, ['images/test.png']);
    assert.deepEqual(await fs.readFile(path.join(path.dirname(to), 'images', 'test.png')), Buffer.from([1, 2, 3]));
  });
  await t.test('另存为遇到不同的同名图片拒绝覆盖', async () => {
    const from = path.join(dir, 'original', 'doc.md'), to = path.join(dir, 'copy', 'copy.md');
    await fs.writeFile(path.join(path.dirname(to), 'images', 'test.png'), 'other');
    await assert.rejects(copyRelativeImages(from, to, ['images/test.png']), /同名图片/);
    assert.equal(await fs.readFile(path.join(path.dirname(to), 'images', 'test.png'), 'utf8'), 'other');
  });
  await t.test('另存为不向用户选择的目录之外写入图片', async () => {
    await assert.rejects(copyRelativeImages(path.join(dir, 'original/doc.md'), path.join(dir, 'nested/copy/copy.md'), ['../external.png']), /上级目录/);
  });
});
