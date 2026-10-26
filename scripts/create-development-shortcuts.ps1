[CmdletBinding()]
param([switch]$IncludeDesktop)

$ErrorActionPreference = 'Stop'
$devRepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$devElectronPath = Join-Path $devRepoRoot 'node_modules\electron\dist\electron.exe'
$devIconPath = Join-Path $devRepoRoot 'resources\icon.ico'
$devArguments = '"' + $devRepoRoot + '"'
foreach ($devRequired in @($devElectronPath, (Join-Path $devRepoRoot 'desktop\main.cjs'), (Join-Path $devRepoRoot 'build\runtime\node.exe'), (Join-Path $devRepoRoot 'build\backend.zip'))) {
    if (-not (Test-Path -LiteralPath $devRequired -PathType Leaf)) { throw "缺少源码启动所需文件：$devRequired" }
}
$devDistPath = Join-Path $devRepoRoot 'dist'
New-Item -ItemType Directory -Path $devDistPath -Force | Out-Null
$devShell = New-Object -ComObject WScript.Shell
$devResults = [System.Collections.Generic.List[object]]::new()
function Write-DevelopmentShortcut([string]$ShortcutPath) {
    if (Test-Path -LiteralPath $ShortcutPath) {
        $oldDevLink = $devShell.CreateShortcut($ShortcutPath)
        if ($oldDevLink.TargetPath -ne $devElectronPath -or $oldDevLink.Arguments -ne $devArguments) {
            $devBackupDir = Join-Path $devDistPath 'shortcut-backups'
            New-Item -ItemType Directory -Path $devBackupDir -Force | Out-Null
            $devBackupName = [IO.Path]::GetFileNameWithoutExtension($ShortcutPath) + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 6) + '.lnk'
            Copy-Item -LiteralPath $ShortcutPath -Destination (Join-Path $devBackupDir $devBackupName)
        }
    }
    $devLink = $devShell.CreateShortcut($ShortcutPath)
    $devLink.TargetPath = $devElectronPath
    $devLink.Arguments = $devArguments
    $devLink.WorkingDirectory = $devRepoRoot
    $devLink.IconLocation = $devIconPath + ',0'
    $devLink.Description = '直接运行当前工作源码；退出已有酒馆后打开，沿用默认配置。改动后重启此入口，无需安装。'
    $devLink.WindowStyle = 1
    $devLink.Save()
    $devCheck = $devShell.CreateShortcut($ShortcutPath)
    if ($devCheck.TargetPath -ne $devElectronPath -or $devCheck.Arguments -ne $devArguments -or $devCheck.WorkingDirectory -ne $devRepoRoot) { throw '源码快捷方式核验失败。' }
    $devResults.Add([pscustomobject]@{ shortcut = $ShortcutPath; target = $devCheck.TargetPath; arguments = $devCheck.Arguments; workingDirectory = $devCheck.WorkingDirectory })
}

Write-DevelopmentShortcut (Join-Path $devRepoRoot '启动源码开发版.lnk')
Write-DevelopmentShortcut (Join-Path $devDistPath '启动测试版.lnk')
if ($IncludeDesktop) {
    $devDesktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
    if (-not $devDesktopPath -or -not (Test-Path -LiteralPath $devDesktopPath -PathType Container)) { throw '无法定位本机桌面目录。' }
    Write-DevelopmentShortcut (Join-Path $devDesktopPath 'SillyTavern 源码开发版.lnk')
}
$devResults | ConvertTo-Json -Depth 3
