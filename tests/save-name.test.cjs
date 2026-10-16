const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { suggestedDocumentName, suggestedSavePath } = require('../electron/save-name.cjs');

test('新文稿从标题或首段建议文件名', () => {
  assert.equal(suggestedDocumentName('# Archery MCP 协作备忘录\n\n正文'), 'Archery MCP 协作备忘录.md');
  assert.equal(suggestedDocumentName('这是一篇会议记录\n\n下一段'), '这是一篇会议记录.md');
  assert.equal(suggestedDocumentName('正文开场\n\n## 周会 **重点** [事项](https://example.com) #'), '周会 重点 事项.md');
  assert.equal(suggestedDocumentName('周会记录\n=====\n\n正文'), '周会记录.md');
  assert.equal(suggestedDocumentName('   \n\n'), '未命名.md');
});
test('文档属性、代码示例和空图片不被误作文件名', () => {
  assert.equal(suggestedDocumentName('---\ntitle: metadata\n---\n\n```md\n# 示例标题\n```\n\n# 真正的标题'), '真正的标题.md');
  assert.equal(suggestedDocumentName('![图片](photo.png)\n\n- [x] 正文内容'), '正文内容.md');
  assert.equal(suggestedDocumentName('<!-- comment\ncontinued -->\n\n第一段正文'), '第一段正文.md');
});
test('Windows 非法字符、保留名称、尾点和长度不会生成无效路径', () => {
  assert.equal(suggestedDocumentName('# ../A: B/C\\D?*"|<x>.'), '.. A B C D.md');
  assert.equal(suggestedDocumentName('# CON'), '文稿 CON.md');
  assert.equal(suggestedDocumentName('# LPT1.notes'), '文稿 LPT1.notes.md');
  assert.equal(suggestedDocumentName('# 报告.md'), '报告.md');
  const name = suggestedDocumentName('# ' + '😀'.repeat(100));
  assert.equal([...name.slice(0, -3)].length, 80);
  assert.equal(/[<>:"/\\|?*\u0000-\u001f]/.test(name), false);
});
test('同名建议自动编号，现有文稿另存为仍用原名，建议不会写入文件', async () => {
  const root = path.resolve(__dirname, '../test-results'); await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'save-name-'));
  await fs.writeFile(path.join(dir, '周会.md'), '已有文件');
  await fs.writeFile(path.join(dir, '周会 (2).md'), '另一份文件');
  assert.equal(await suggestedSavePath('# 周会', dir), path.join(dir, '周会 (3).md'));
  const existing = path.join(dir, '原文件名.md');
  assert.equal(await suggestedSavePath('# 新标题', dir, existing), existing);
  assert.deepEqual((await fs.readdir(dir)).sort(), ['周会 (2).md', '周会.md']);
  assert.equal(await fs.readFile(path.join(dir, '周会.md'), 'utf8'), '已有文件');
});
