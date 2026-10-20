# Android 构建公共环境配置
# 使用环境变量 + 默认值模式，支持不同开发者机器
# 用法: 在各构建脚本中 . "$PSScriptRoot\android-env.ps1"

# 注意: 构建脚本经 Windows PowerShell 5.1 调用（见 lt-repack-all.ps1），不可使用 pwsh 7 专有的 ?? 运算符
$script:ANDROID_NDK_HOME = if ($env:ANDROID_NDK_HOME) { $env:ANDROID_NDK_HOME } else { "D:\develop\Android\ndk\29.0.13846066" }
$script:ANDROID_HOME     = if ($env:ANDROID_HOME)     { $env:ANDROID_HOME }     else { "D:\develop\Android" }

# AGP 8.11 要求 JDK 17+。系统 JAVA_HOME 可能指向旧版（如 1.8），
# 直接采用会让 Gradle 以 Java 8 运行并在 buildSrc:compileKotlin 失败，因此先校验版本再回退默认 JDK。
function Get-JavaMajorVersion([string]$JdkHome) {
    $releaseFile = Join-Path $JdkHome "release"
    if (-not (Test-Path $releaseFile)) { return 0 }
    $match = Select-String -Path $releaseFile -Pattern '^JAVA_VERSION="([^"]+)"' | Select-Object -First 1
    if (-not $match) { return 0 }
    $parts = $match.Matches[0].Groups[1].Value.Split('.')
    # 旧版命名 1.8.0_x 的首段为 1，真实主版本在第二段
    if ($parts[0] -eq '1' -and $parts.Count -gt 1) { return [int]$parts[1] }
    return [int]$parts[0]
}

$script:JAVA_HOME = $env:JAVA_HOME
if (-not $script:JAVA_HOME -or (Get-JavaMajorVersion $script:JAVA_HOME) -lt 17) {
    if ($script:JAVA_HOME) {
        Write-Host "WARN: JAVA_HOME ($script:JAVA_HOME) 的 Java 版本低于 17（AGP 要求），回退默认 JDK"
    }
    $script:JAVA_HOME = "C:\Program Files\Java\jdk-17"
}
if (-not (Test-Path (Join-Path $script:JAVA_HOME "bin\java.exe"))) {
    Write-Host "WARN: 未找到可用的 JDK 17+：$script:JAVA_HOME，请将 JAVA_HOME 指向 JDK 17 或更新版本"
}

$script:NDK_BIN = "$script:ANDROID_NDK_HOME\toolchains\llvm\prebuilt\windows-x86_64\bin"

# --- 环境变量导出 ---
$env:ANDROID_HOME     = $script:ANDROID_HOME
$env:ANDROID_NDK_HOME = $script:ANDROID_NDK_HOME
$env:NDK_HOME         = $script:ANDROID_NDK_HOME
$env:JAVA_HOME        = $script:JAVA_HOME

# --- NDK 工具链 (linker / clang / ar) ---
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = "$script:NDK_BIN\aarch64-linux-android24-clang.cmd"
$env:CC_aarch64_linux_android  = "$script:NDK_BIN\aarch64-linux-android24-clang.cmd"
$env:CXX_aarch64_linux_android = "$script:NDK_BIN\aarch64-linux-android24-clang++.cmd"
$env:AR_aarch64_linux_android  = "$script:NDK_BIN\llvm-ar.exe"
$env:LIBCLANG_PATH = $script:NDK_BIN

# --- bindgen (Windows 反斜杠会被 shlex 当转义符，sysroot 必须用正斜杠) ---
$llvmPrebuilt = "$script:ANDROID_NDK_HOME\toolchains\llvm\prebuilt\windows-x86_64"
$sysroot = "$llvmPrebuilt/sysroot" -replace '\\', '/'
# clang 内置头(stddef.h/stdint.h 等)位于资源目录 lib/clang/<ver>/include；
# libclang 交叉编译时不会自动加入该目录，bindgen 会因找不到 stddef.h 而失败，需显式 -isystem
$clangResDir = (Get-ChildItem "$llvmPrebuilt\lib\clang" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
$clangResInclude = "$clangResDir/include" -replace '\\', '/'
$clangArgs = "--sysroot=$sysroot --target=aarch64-linux-android24 -isystem $clangResInclude"
${env:BINDGEN_EXTRA_CLANG_ARGS_aarch64-linux-android} = $clangArgs
${env:BINDGEN_EXTRA_CLANG_ARGS_aarch64_linux_android} = $clangArgs

# --- protoc (可选，存在则设置) ---
$protocPath = "$script:ANDROID_HOME\protoc\bin\protoc.exe"
if (Test-Path $protocPath) {
    $env:PROTOC = $protocPath
}

# --- Cargo 网络配置 ---
$env:CARGO_NET_GIT_FETCH_WITH_CLI = "true"
$env:CARGO_HTTP_MULTIPLEXING      = "false"
$env:CARGO_HTTP_TIMEOUT           = "120"
$env:CARGO_NET_RETRY              = "10"
