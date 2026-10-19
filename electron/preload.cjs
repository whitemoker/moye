const { contextBridge, ipcRenderer, webUtils } = require('electron');
const names = ['init', 'open', 'openPath', 'folder', 'tree', 'save', 'draft', 'clearDraft', 'commentDraft', 'discardRecovery', 'importComments', 'settings', 'windowsIntegration', 'image', 'imageUrl', 'imageData', 'export', 'reveal', 'external', 'window'];
const api = Object.fromEntries(names.map(name => [name, (...args) => ipcRenderer.invoke(`moye:${name}`, ...args)]));
api.imageUrl = ({ src, documentPath }) => {
  if (/^(https?:|data:|blob:|moye-image:)/i.test(src)) return src;
  if (!documentPath) return '';
  return `moye-image://local/image?document=${encodeURIComponent(documentPath)}&src=${encodeURIComponent(src)}`;
};
api.filePath = file => webUtils.getPathForFile(file);
api.openDropped = file => { const p = webUtils.getPathForFile(file); if (!p) return Promise.reject(new Error('请从文件资源管理器拖入文件。')); return ipcRenderer.invoke('moye:openDropped', p); };
api.on = (name, callback) => {
  if (!['command', 'externalChange', 'open-request'].includes(name)) return () => {};
  const handler = (_, value) => callback(value);
  ipcRenderer.on(`moye:${name}`, handler);
  return () => ipcRenderer.removeListener(`moye:${name}`, handler);
};
contextBridge.exposeInMainWorld('moye', api);
