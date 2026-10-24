# LightTier nightly 预发布打包（不修改仓库版本文件）
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File .\lt-nightly.ps1                    # 只打包，产物在 %TEMP%\lighttier-nightly\<版本>
#   powershell -ExecutionPolicy Bypass -File .\lt-nightly.ps1 -Publish           # 打包并创建 GitHub 预发布（prerelease）
#   powershell -ExecutionPolicy Bypass -File .\lt-nightly.ps1 -BaseVersion 1.10.0
#   powershell -ExecutionPolicy Bypass -File .\lt-nightly.ps1 -DryRun            # 只打印版本/标签/命令
#
# 版本规则: <下一补丁版或 -BaseVersion>-nightly.<yyyyMMdd>，如 1.9.2-nightly.20261024
# 标签规则: v<版本>（如 v1.9.2-nightly.20261024）；与正式版 v1.9.2 区分，
# 且带 v 前缀 + 真实版本号，客户端“只更新稳定版”关闭时能按版本正确比较。
# 同一天多次发布需用 -Tag v1.9.2-nightly.20261024-2 或 -BaseVersion 另开版本号，否则标签重名。
# 桌面端只出 NSIS（EXE）：Tauri 2 的 MSI 打包器要求预发布标识为纯数字（<=65535），日期后缀无法用于 MSI；
# 正式版仍由 lt-repack-all.ps1 产出 NSIS + MSI。
# -Publish 使用 gh 创建 prerelease，不会改动 GitHub 的 latest，也不会写 CHANGELOG；
# 版本号通过 --config（桌面）与 TAURI_CONFIG（Android）注入，package.json / Cargo.toml / tauri.conf.json5 保持不变。
param(
    [switch]$Publish,
    [switch]$DryRun,
    [string]$BaseVersion = "",
    [string]$Tag = "",
    [string]$Notes = ""
)
$ErrorActionPreference = "Continue"
$root = "d:\develop\otherProjects\LightTier"
$env:Path = "$env:APPDATA\nvm\v26.4.0;" + $env:Path

# ---------- 版本与仓库状态 ----------
$stableVersion = (Get-Content "$root\package.json" -Raw -Encoding UTF8 | ConvertFrom-Json).version
if (-not $stableVersion) { Write-Host "FATAL: 无法从 package.json 读取版本号"; exit 1 }
if (-not $BaseVersion) {
    $parts = $stableVersion.Split('.')
    if ($parts.Count -ne 3) { Write-Host "FATAL: package.json 版本号必须为 x.y.z：$stableVersion"; exit 1 }
    $BaseVersion = "{0}.{1}.{2}" -f $parts[0], $parts[1], ([int]$parts[2] + 1)
}
if ($BaseVersion -notmatch '^\d+\.\d+\.\d+$') { Write-Host "FATAL: BaseVersion 必须为 x.y.z：$BaseVersion"; exit 1 }
$nightlyDate = Get-Date -Format "yyyyMMdd"
$version = "$BaseVersion-nightly.$nightlyDate"
if (-not $Tag) { $Tag = "v$version" }

$baseParts = $BaseVersion.Split('.')
$versionCode = [int]$baseParts[0] * 1000000 + [int]$baseParts[1] * 1000 + [int]$baseParts[2]

$commit = (git -C $root rev-parse HEAD 2>$null)
$shortCommit = (git -C $root rev-parse --short HEAD 2>$null)
$branch = (git -C $root rev-parse --abbrev-ref HEAD 2>$null)
# 只统计已跟踪文件的改动：未跟踪的本地文档不会进入构建，不应触发“产物与提交不一致”提示
$dirtyCount = @(git -C $root status --porcelain --untracked-files=no 2>$null | Where-Object { $_ }).Count

$stage = Join-Path $env:TEMP "lighttier-nightly\$version"
$cfgPath = Join-Path $env:TEMP "lighttier-nightly-tauri.json"

Write-Host "=== nightly $version (base $BaseVersion, versionCode $versionCode) ==="
Write-Host "=== commit $shortCommit on $branch$(if ($dirtyCount -gt 0) { ", dirty: $dirtyCount files" }) ==="
Write-Host "=== tag: $Tag ==="
Write-Host "=== output: $stage ==="

if ($DryRun) {
    Write-Host ""
    Write-Host "desktop: pnpm tauri build --config $cfgPath --bundles nsis"
    Write-Host "android: lt-android-repack.ps1 -VersionOverride $version"
    Write-Host "publish: gh release create $Tag --prerelease --latest=false --title `"LightTier $version`" --target $shortCommit <nsis.exe> <apk>"
    exit 0
}

Set-Location $root

# ---------- [1/2] 桌面端（NSIS） ----------
# 仅覆盖 version；--config 与 tauri.conf.json5 走 JSON 合并（RFC 7396）
@{ version = $version } | ConvertTo-Json -Compress | Set-Content -Path $cfgPath -Encoding ASCII
Write-Host "=== [1/2] desktop: pnpm tauri build --bundles nsis ==="
pnpm tauri build --config $cfgPath --bundles nsis *> "$env:TEMP\lt-nightly-desktop.log"
if ($LASTEXITCODE -ne 0) {
    Write-Host "desktop FAILED, see $env:TEMP\lt-nightly-desktop.log"
    exit 1
}

# ---------- [2/2] Android ----------
Write-Host "=== [2/2] android: lt-android-repack.ps1 -VersionOverride $version ==="
& powershell -ExecutionPolicy Bypass -File "$root\src-tauri\lt-android-repack.ps1" -VersionOverride $version
if ($LASTEXITCODE -ne 0) {
    Write-Host "android FAILED, see $env:TEMP\lt-repack-front.log / lt-repack-cargo.log / lt-repack-gradle.log"
    exit 1
}

# ---------- 收集产物 ----------
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$assets = @()

$nsis = Get-ChildItem "$root\src-tauri\target\release\bundle\nsis" -Filter "*.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "*$version*" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($nsis) {
    Copy-Item $nsis.FullName $stage -Force
    $assets += (Join-Path $stage $nsis.Name)
} else {
    Write-Host "WARN: 未找到 NSIS 安装包（预期文件名含 $version）"
}

$apkSrc = "$root\src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release-signed.apk"
if (Test-Path $apkSrc) {
    $apkName = "LightTier_${version}_arm64.apk"
    Copy-Item $apkSrc (Join-Path $stage $apkName) -Force
    $assets += (Join-Path $stage $apkName)
} else {
    Write-Host "WARN: 未找到已签名 APK: $apkSrc"
}

if ($assets.Count -eq 0) {
    Write-Host "FATAL: 没有可发布产物，检查上方日志"
    exit 1
}

Write-Host ""
Write-Host "=== nightly artifacts ==="
$assets | ForEach-Object {
    $item = Get-Item $_
    Write-Host ("{0}  ({1:N1} MB)" -f $item.FullName, ($item.Length / 1MB))
}

# ---------- 发布（需显式 -Publish） ----------
if (-not $Publish) {
    Write-Host ""
    Write-Host "=== 未发布。确认后可加 -Publish 重跑，或手动上传上述文件："
    Write-Host "gh release create $Tag --prerelease --latest=false --title `"LightTier $version`" --target $shortCommit <assets>"
    exit 0
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "FATAL: 未找到 gh CLI，无法发布"
    exit 1
}

$dirtyNote = if ($dirtyCount -gt 0) { "（工作区有 $dirtyCount 个未提交改动，产物与 commit 不完全一致）" } else { "" }
$releaseNotes = if ($Notes) {
    $Notes
} else {
    @"
夜间构建，仅供测试，随时可能失效；请勿用于生产环境。$dirtyNote

- 版本: $version
- 提交: $shortCommit ($branch)
- 构建: $(Get-Date -Format 'yyyy-MM-dd HH:mm')
- 桌面端仅提供 NSIS 安装包（MSI 不支持带日期后缀的预发布版本）
"@
}

$ghArgs = @(
    "release", "create", $Tag,
    "--prerelease", "--latest=false",
    "--target", $commit,
    "--title", "LightTier $version",
    "--notes", $releaseNotes
) + $assets

Write-Host "=== publishing: $Tag ==="
& gh @ghArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "FATAL: gh release create 失败（tag 是否已存在？）"
    exit 1
}
Write-Host "=== PUBLISHED: https://github.com/BeafJerky/LIghtTier/releases/tag/$Tag ==="
