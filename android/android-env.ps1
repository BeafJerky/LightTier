# Android 构建公共环境配置
# 使用环境变量 + 自动探测模式，不依赖特定机器路径
# 用法: 在各构建脚本中 . "$PSScriptRoot\android-env.ps1"
# 可覆盖的环境变量: ANDROID_HOME / ANDROID_SDK_ROOT、ANDROID_NDK_HOME / NDK_HOME、JAVA_HOME、PROTOC

# 注意: 构建脚本经 Windows PowerShell 5.1 调用（见 lt-repack-all.ps1），不可使用 pwsh 7 专有的 ?? 运算符

# --- Android SDK ---
# 顺序: ANDROID_HOME → ANDROID_SDK_ROOT → gen/android/local.properties 的 sdk.dir → %LOCALAPPDATA%\Android\Sdk
function Get-AndroidSdkDir {
    $candidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)
    # Android Studio 生成：sdk.dir=C\:\\Users\\<用户>\\AppData\\Local\\Android\\Sdk
    $localProps = Join-Path (Split-Path -Parent $PSScriptRoot) "src-tauri\gen\android\local.properties"
    if (Test-Path $localProps) {
        $line = Select-String -Path $localProps -Pattern '^\s*sdk\.dir=(.+)$' | Select-Object -First 1
        if ($line) {
            $candidates += $line.Matches[0].Groups[1].Value.Trim().Replace('\\', '\').Replace('\:', ':')
        }
    }
    $candidates += (Join-Path $env:LOCALAPPDATA "Android\Sdk")
    foreach ($candidate in $candidates) {
        if (-not $candidate) { continue }
        if ((Test-Path (Join-Path $candidate "platform-tools")) -or (Test-Path (Join-Path $candidate "build-tools"))) {
            return $candidate
        }
    }
    return $null
}

# --- Android NDK ---
# 顺序: ANDROID_NDK_HOME → NDK_HOME → <SDK>\ndk 下最高版本 → <SDK>\ndk-bundle（旧版布局）
function Get-AndroidNdkDir([string]$SdkDir) {
    foreach ($candidate in @($env:ANDROID_NDK_HOME, $env:NDK_HOME)) {
        if ($candidate -and (Test-Path (Join-Path $candidate "toolchains"))) { return $candidate }
    }
    if (-not $SdkDir) { return $null }
    $ndkRoot = Join-Path $SdkDir "ndk"
    if (Test-Path $ndkRoot) {
        $ndk = Get-ChildItem $ndkRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object { try { [version]$_.Name } catch { [version]"0.0" } } -Descending |
            Select-Object -First 1
        if ($ndk) { return $ndk.FullName }
    }
    $bundle = Join-Path $SdkDir "ndk-bundle"
    if (Test-Path (Join-Path $bundle "toolchains")) { return $bundle }
    return $null
}

# AGP 8.11 要求 JDK 17+。系统 JAVA_HOME 可能指向旧版（如 1.8），
# 直接采用会让 Gradle 以 Java 8 运行并在 buildSrc:compileKotlin 失败，因此先校验版本再探测其他 JDK。
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

# --- JDK ---
# 顺序: JAVA_HOME（版本达标） → Android Studio 自带 jbr → Program Files 下常见发行版的最高版本
function Get-JdkHome {
    if ($env:JAVA_HOME -and (Get-JavaMajorVersion $env:JAVA_HOME) -ge 17) { return $env:JAVA_HOME }
    $candidates = @()
    $studioJbr = Join-Path $env:ProgramFiles "Android\Android Studio\jbr"
    if (Test-Path (Join-Path $studioJbr "bin\java.exe")) { $candidates += $studioJbr }
    foreach ($vendor in @("Java", "Eclipse Adoptium", "Zulu", "Microsoft", "Amazon Corretto")) {
        $vendorDir = Join-Path $env:ProgramFiles $vendor
        if (Test-Path $vendorDir) {
            $candidates += @(Get-ChildItem $vendorDir -Directory -ErrorAction SilentlyContinue |
                ForEach-Object { $_.FullName })
        }
    }
    return ($candidates |
        Where-Object { (Get-JavaMajorVersion $_) -ge 17 } |
        Sort-Object { Get-JavaMajorVersion $_ } -Descending |
        Select-Object -First 1)
}

$script:ANDROID_HOME = Get-AndroidSdkDir
if (-not $script:ANDROID_HOME) {
    Write-Host "FATAL: 未找到 Android SDK。请设置 ANDROID_HOME（或 ANDROID_SDK_ROOT）指向 SDK 目录，"
    Write-Host "       或确认 SDK 安装在默认位置 %LOCALAPPDATA%\Android\Sdk。"
    throw "Android SDK 未找到"
}
$script:ANDROID_NDK_HOME = Get-AndroidNdkDir $script:ANDROID_HOME
if (-not $script:ANDROID_NDK_HOME) {
    Write-Host "FATAL: 未在 $script:ANDROID_HOME\ndk 下找到 Android NDK。"
    Write-Host "       请用 sdkmanager 安装，或设置 ANDROID_NDK_HOME 指向已有 NDK。"
    throw "Android NDK 未找到"
}
$script:JAVA_HOME = Get-JdkHome
if (-not $script:JAVA_HOME) {
    Write-Host "FATAL: 未找到 JDK 17+（AGP 要求）。请安装 JDK 17 及以上并设置 JAVA_HOME，"
    Write-Host "       或安装 Android Studio（将自动使用其自带的 jbr）。"
    throw "JDK 17+ 未找到"
}

$script:NDK_BIN = "$script:ANDROID_NDK_HOME\toolchains\llvm\prebuilt\windows-x86_64\bin"

Write-Host "Android SDK: $script:ANDROID_HOME"
Write-Host "Android NDK: $script:ANDROID_NDK_HOME"
Write-Host "JDK: $script:JAVA_HOME"

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
# 顺序: 已设置的 PROTOC → <SDK>\protoc\bin\protoc.exe（项目自带布局） → PATH
$script:PROTOC = $env:PROTOC
if (-not $script:PROTOC) {
    $bundledProtoc = Join-Path $script:ANDROID_HOME "protoc\bin\protoc.exe"
    if (Test-Path $bundledProtoc) { $script:PROTOC = $bundledProtoc }
}
if (-not $script:PROTOC) {
    $onPathProtoc = Get-Command protoc -ErrorAction SilentlyContinue
    if ($onPathProtoc) { $script:PROTOC = $onPathProtoc.Source }
}
if ($script:PROTOC) {
    $env:PROTOC = $script:PROTOC
} else {
    Write-Host "WARN: 未找到 protoc（Android 原生依赖构建需要），可设置 PROTOC 或将其加入 PATH"
}

# --- Cargo 网络配置 ---
$env:CARGO_NET_GIT_FETCH_WITH_CLI = "true"
$env:CARGO_HTTP_MULTIPLEXING      = "false"
$env:CARGO_HTTP_TIMEOUT           = "120"
$env:CARGO_NET_RETRY              = "10"
