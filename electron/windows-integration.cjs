const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

async function registerWindowsIntegration({ executablePath, iconPath, appData }) {
  if (process.platform !== 'win32') throw new Error('此功能仅适用于 Windows。');
  for (const file of [executablePath, iconPath]) await fs.access(file);
  const iconDirectory = path.join(appData, 'Moye', 'Windows');
  await fs.mkdir(iconDirectory, { recursive: true });
  const documentIcon = path.join(iconDirectory, 'document.ico');
  await fs.copyFile(iconPath, documentIcon);
  const script = await fs.readFile(path.join(__dirname, 'windows-integration.ps1'), 'utf8');
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await run(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
    env: { ...process.env, MOYE_WINDOWS_INTEGRATION: JSON.stringify({ executablePath, documentIcon }) },
  });
  return JSON.parse(stdout.trim());
}
module.exports = { registerWindowsIntegration };
