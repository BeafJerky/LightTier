# 统一 Node 环境（Vite 7 需要 Node 20.19+）
# 优先使用 nvm 安装的 Node（系统默认 Node 可能是旧版），找不到时沿用当前 PATH
# 用法: . "$PSScriptRoot\lt-node-env.ps1"（scripts/）或 . "$PSScriptRoot\..\scripts\lt-node-env.ps1"（android/）
$nvmCandidates = @()
if ($env:LOCALAPPDATA) {
    # nvm-windows 2.x：shim 模式把当前版本映射到 .nodejs
    $nvmCandidates += (Join-Path $env:LOCALAPPDATA "Author Software\nvm\.nodejs")
}
if ($env:APPDATA) {
    # nvm-windows 1.x：%APPDATA%\nvm\v<版本>，取最高版本
    $nvmRoot = Join-Path $env:APPDATA "nvm"
    if (Test-Path $nvmRoot) {
        $nvmCandidates += @(Get-ChildItem $nvmRoot -Directory -Filter "v*" -ErrorAction SilentlyContinue |
            Sort-Object { try { [version]($_.Name.TrimStart('v')) } catch { [version]"0.0" } } -Descending |
            ForEach-Object { $_.FullName })
    }
}
$nodeDir = $nvmCandidates | Where-Object { Test-Path (Join-Path $_ "node.exe") } | Select-Object -First 1
if ($nodeDir) { $env:Path = "$nodeDir;$env:Path" }
