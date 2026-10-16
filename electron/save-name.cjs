const fs = require('node:fs/promises');
const path = require('node:path');

function plainText(value) {
  return value.replace(/<!--.*?-->/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]*>/g, '').replace(/[`*_~]/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity]);
}
function safeName(value) {
  const cleaned = plainText(value).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/\.md$/i, '').replace(/[. ]+$/g, '');
  let name = [...cleaned].slice(0, 80).join('').replace(/[. ]+$/g, '');
  if (!name || /^\.+$/.test(name)) return '';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `文稿 ${name}`;
  return name;
}
function suggestedDocumentName(content) {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
    .replace(/^---\n[\s\S]*?\n(?:---|\.\.\.)\s*(?:\n|$)/, '');
  let fence = '', previous = '', firstText = '', inComment = false;
  for (const raw of text.slice(0, 16000).split('\n')) {
    const line = raw.trim();
    if (inComment) { if (line.includes('-->')) inComment = false; continue; }
    if (line.startsWith('<!--')) { inComment = !line.includes('-->'); continue; }
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(raw)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''; previous = ''; continue; }
    if (fence || /^ {4}|^\t/.test(raw)) continue;
    const heading = /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/.exec(raw)?.[1];
    if (heading) { const name = safeName(heading); if (name) return `${name}.md`; }
    if (previous && /^(?:={2,}|-{2,})\s*$/.test(line)) { const name = safeName(previous); if (name) return `${name}.md`; }
    if (!firstText && line && !/^(?:[-*_]\s*){3,}$|^\[.+\]:/.test(line)) {
      firstText = safeName(line.replace(/^(?:>\s*)+/, '').replace(/^[-*+]\s+(?:\[[ xX]\]\s*)?|^\d+[.)]\s+/, ''));
    }
    previous = line;
  }
  return `${firstText || '未命名'}.md`;
}
async function suggestedSavePath(content, directory, existingPath) {
  if (existingPath) return existingPath;
  const name = suggestedDocumentName(content), stem = name.slice(0, -3);
  for (let count = 1; count <= 100; count++) {
    const candidate = path.join(directory, count === 1 ? name : `${stem} (${count}).md`);
    try { await fs.access(candidate); }
    catch (error) { if (error.code === 'ENOENT') return candidate; throw error; }
  }
  return path.join(directory, `${stem} ${Date.now()}.md`);
}
module.exports = { suggestedDocumentName, suggestedSavePath };
