$ErrorActionPreference = "Continue"
# Node 环境（优先 nvm 安装的版本，兼容 nvm-windows 1.x/2.x）
. "$PSScriptRoot\..\scripts\lt-node-env.ps1"

# 公共 Android 构建环境（NDK / clang / bindgen / protoc / cargo 网络）
. "$PSScriptRoot\android-env.ps1"
$env:Path = "$env:JAVA_HOME\bin;$env:NDK_BIN;" + $env:Path

Set-Location (Split-Path -Parent $PSScriptRoot)
Write-Host "=== tauri android build (aarch64 APK) ==="
pnpm tauri android build --apk --target aarch64 2>&1 | Tee-Object -FilePath "$env:TEMP\lt-android-build.log"
Write-Host "=== done, exit=$LASTEXITCODE ==="
