$ErrorActionPreference = "Continue"

# 公共 Android 构建环境（NDK / clang / bindgen / protoc / cargo 网络）
. "$PSScriptRoot\android-env.ps1"
$env:Path = "$env:NDK_BIN;" + $env:Path

$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root\src-tauri"
Write-Host "=== rustup targets ==="
rustup target list --installed
Write-Host "=== cargo check for aarch64-linux-android ==="
cargo check --target aarch64-linux-android --message-format short 2>&1 | Tee-Object -FilePath "$env:TEMP\lt-android-check.log" | Select-Object -Last 100
Write-Host "=== done, exit=$LASTEXITCODE ==="
