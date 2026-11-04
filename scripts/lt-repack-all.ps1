# LightTier 双端一键打包（串行：先桌面后 Android；任一步失败即中止）
# 用法: powershell -ExecutionPolicy Bypass -File .\lt-repack-all.ps1
# 说明: 桌面与 Android 打包共用前端 dist/ 与 cargo target 目录，必须串行执行，禁止并行
# 日志: 桌面 %TEMP%\lt-repack-all-desktop.log；Android 见 lt-android-repack.ps1（lt-repack-*.log）
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
# 桌面打包同样依赖 Node 20.19+（Vite 7 要求）
. "$PSScriptRoot\lt-node-env.ps1"

# ---------- [1/2] 桌面端 ----------
Write-Host "=== [1/2] desktop: pnpm tauri build ==="
Set-Location $root
pnpm tauri build *> "$env:TEMP\lt-repack-all-desktop.log"
if ($LASTEXITCODE -ne 0) {
    Write-Host "desktop FAILED, see $env:TEMP\lt-repack-all-desktop.log"
    exit 1
}

# ---------- [2/2] Android ----------
Write-Host "=== [2/2] android: lt-android-repack.ps1 ==="
& powershell -ExecutionPolicy Bypass -File "$root\android\lt-android-repack.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "android FAILED, see $env:TEMP\lt-repack-front.log / lt-repack-cargo.log / lt-repack-gradle.log"
    exit 1
}

# ---------- 产物汇总 ----------
Write-Host ""
Write-Host "=== artifacts ==="
$bundle = "$root\target\release\bundle"
$files = @()
$files += Get-ChildItem "$bundle\nsis\*.exe" -ErrorAction SilentlyContinue
$files += Get-ChildItem "$bundle\msi\*.msi" -ErrorAction SilentlyContinue
$files += Get-ChildItem "$root\src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release-signed.apk" -ErrorAction SilentlyContinue
if ($files.Count -eq 0) {
    Write-Host "WARN: no artifacts found, check logs above"
} else {
    $files | Sort-Object LastWriteTime -Descending | ForEach-Object {
        Write-Host ("{0}  ({1:N1} MB, {2})" -f $_.FullName, ($_.Length / 1MB), $_.LastWriteTime)
    }
}
Write-Host "=== DONE ==="
