$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$registration = $env:MOYE_WINDOWS_INTEGRATION | ConvertFrom-Json
if (-not [System.IO.File]::Exists($registration.executablePath) -or -not [System.IO.File]::Exists($registration.documentIcon)) { throw 'Missing application or icon file.' }
$openCommand = '"' + $registration.executablePath + '" "%1"'
$iconValue = '"' + $registration.documentIcon + '",0'
$progId = 'Moye.Markdown'

function Write-UserValue([string] $subkey, [string] $name, [string] $value) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($subkey)
  try { $key.SetValue($name, $value, [Microsoft.Win32.RegistryValueKind]::String) }
  finally { $key.Dispose() }
}
function Read-RegistryValue([Microsoft.Win32.RegistryKey] $hive, [string] $subkey, [string] $name) {
  $key = $hive.OpenSubKey($subkey)
  if ($null -eq $key) { return $null }
  try { return $key.GetValue($name, $null) }
  finally { $key.Dispose() }
}

Write-UserValue "Software\Classes\$progId" '' 'Markdown 文稿'
Write-UserValue "Software\Classes\$progId\DefaultIcon" '' $iconValue
Write-UserValue "Software\Classes\$progId\shell\open\command" '' $openCommand
Write-UserValue 'Software\Classes\Applications\Moye.exe' 'FriendlyAppName' '墨页'
Write-UserValue 'Software\Classes\Applications\Moye.exe\shell\open\command' '' $openCommand
Write-UserValue 'Software\Moye\Capabilities' 'ApplicationName' '墨页'
Write-UserValue 'Software\Moye\Capabilities' 'ApplicationDescription' 'Markdown 文稿编辑器'
Write-UserValue 'Software\Moye\Capabilities' 'ApplicationIcon' ('"' + $registration.executablePath + '",0')
Write-UserValue 'Software\RegisteredApplications' 'Moye' 'Software\Moye\Capabilities'

$extensions = @()
foreach ($extension in @('.md', '.markdown', '.mdown')) {
  $choiceKey = "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\UserChoice"
  $choice = Read-RegistryValue ([Microsoft.Win32.Registry]::CurrentUser) $choiceKey 'ProgId'
  $default = Read-RegistryValue ([Microsoft.Win32.Registry]::ClassesRoot) $extension ''
  $existingIcon = Read-RegistryValue ([Microsoft.Win32.Registry]::ClassesRoot) "$extension\DefaultIcon" ''
  Write-UserValue "Software\Classes\$extension\OpenWithProgids" $progId ''
  Write-UserValue 'Software\Classes\Applications\Moye.exe\SupportedTypes' $extension ''
  Write-UserValue 'Software\Moye\Capabilities\FileAssociations' $extension $progId
  $iconRegistered = $false
  if ([string]::IsNullOrEmpty($choice) -and [string]::IsNullOrEmpty($default) -and [string]::IsNullOrEmpty($existingIcon)) {
    # A file-type icon works independently of a default opening application.
    Write-UserValue "Software\Classes\$extension\DefaultIcon" '' $iconValue
    $iconRegistered = $true
  }
  $afterChoice = Read-RegistryValue ([Microsoft.Win32.Registry]::CurrentUser) $choiceKey 'ProgId'
  $afterDefault = Read-RegistryValue ([Microsoft.Win32.Registry]::ClassesRoot) $extension ''
  if ($choice -ne $afterChoice -or $default -ne $afterDefault) { throw 'Default opening application changed unexpectedly.' }
  $extensions += [pscustomobject]@{ extension = $extension; iconRegistered = $iconRegistered; defaultApplicationPreserved = $true }
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MoyeShellNotification {
  [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
'@
[MoyeShellNotification]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
[pscustomobject]@{ registered = $true; executablePath = $registration.executablePath; documentIcon = $registration.documentIcon; extensions = $extensions } | ConvertTo-Json -Depth 4 -Compress
