[CmdletBinding()]
param(
    [string]$Version = "",
    [string]$Image = "",
    [string]$Fnpack = ""
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $root "lighttier"
$pkgPath = Join-Path $root "../../package.json"
$pkg = [System.IO.File]::ReadAllText($pkgPath, (New-Object System.Text.UTF8Encoding($false))) | ConvertFrom-Json
if (-not $Version) { $Version = $pkg.version }
if ($Version -ne $pkg.version) {
    throw "Version parameter '$Version' must equal package.json version '$($pkg.version)'"
}
if (-not $Image) { $Image = "ghcr.io/beafjerky/lighttier-agent:$Version" }

$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Lf([string]$Path) {
    $text = [System.IO.File]::ReadAllText($Path, $utf8).Replace("`r`n", "`n")
    [System.IO.File]::WriteAllText($Path, $text, $utf8)
}

# 1) Single source of truth: package.json -> manifest.version and compose image tag.
$manifestPath = Join-Path $appDir "manifest"
$composePath = Join-Path $appDir "app/docker/docker-compose.yaml"
Write-Lf $manifestPath
Write-Lf $composePath
$manifest = [System.IO.File]::ReadAllText($manifestPath, $utf8)
$manifest = [regex]::Replace($manifest, "(?m)^version\s*=.*$", "version               = $Version")
[System.IO.File]::WriteAllText($manifestPath, $manifest, $utf8)
$compose = [System.IO.File]::ReadAllText($composePath, $utf8)
$compose = [regex]::Replace($compose, "(?m)^\s*image:.*$", "    image: $Image")
[System.IO.File]::WriteAllText($composePath, $compose, $utf8)

# 2) CRLF would break the shell scripts on fnOS; normalize every text file.
$textFiles = @(
    "app/ui/config",
    "config/privilege",
    "config/resource",
    "wizard/install",
    "wizard/config",
    "wizard/uninstall"
)
$textFiles += Get-ChildItem (Join-Path $appDir "cmd") -File | ForEach-Object { "cmd/" + $_.Name }
foreach ($rel in $textFiles) { Write-Lf (Join-Path $appDir $rel) }

# 3) Template leftovers must never be packed.
Get-ChildItem $appDir -Recurse -Force -Filter ".DS_Store" | Remove-Item -Force
$oldFpk = Join-Path $appDir "lighttier.fpk"
if (Test-Path $oldFpk) { Remove-Item $oldFpk -Force }

# 4) Resolve fnpack. Windows builds of fnpack ship without a .exe suffix, and
#    invoking such a file from PowerShell silently does nothing, so always run
#    through a temporary .exe copy.
if (-not $Fnpack) { $Fnpack = $env:FNPACK }
if (-not $Fnpack) {
    $cmd = Get-Command fnpack -ErrorAction SilentlyContinue
    if ($cmd) { $Fnpack = $cmd.Source }
}
if (-not $Fnpack) {
    $candidate = "D:\develop\otherProjects\fnos\fnpack-1.2.3-windows-amd64"
    if (Test-Path $candidate) { $Fnpack = $candidate }
}
if (-not $Fnpack -or -not (Test-Path $Fnpack)) {
    throw "fnpack not found. Pass -Fnpack <path> or set FNPACK. Download: https://developer.fnnas.com/docs/cli/fnpack/"
}

$fnpackExe = Join-Path $env:TEMP ("fnpack-" + [guid]::NewGuid().ToString("N") + ".exe")
Copy-Item $Fnpack $fnpackExe
Push-Location $appDir
try {
    & $fnpackExe build
    $buildExit = $LASTEXITCODE
}
finally {
    Pop-Location
    Remove-Item $fnpackExe -Force -ErrorAction SilentlyContinue
}
if ($buildExit -ne 0) { throw "fnpack build failed with exit code $buildExit" }
if (-not (Test-Path $oldFpk)) { throw "fnpack build did not produce lighttier.fpk" }

# 5) Unpack and verify the artifact. Every value that appears in more than one
#    place is asserted equal here, so a partial edit cannot ship silently.
$platform = ([regex]::Match([System.IO.File]::ReadAllText($manifestPath, $utf8), "(?m)^platform\s*=\s*(\S+)")).Groups[1].Value
$temp = Join-Path $env:TEMP ("lt-fpk-check-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temp | Out-Null
$assertions = 0
function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "self-check failed: $Message" }
    $script:assertions++
}
function Read-Text([string]$Path) { [System.IO.File]::ReadAllText($Path, $utf8) }

try {
    & "$env:SystemRoot\System32\tar.exe" -xzf $oldFpk -C $temp
    Assert ($LASTEXITCODE -eq 0) "tar extract of fpk"
    foreach ($required in @("manifest", "ICON.PNG", "ICON_256.PNG", "app.tgz", "cmd/main", "cmd/install_callback", "cmd/common.sh", "config/privilege", "config/resource", "wizard/install", "wizard/config", "wizard/uninstall")) {
        Assert (Test-Path (Join-Path $temp $required)) "missing $required in fpk"
    }

    $packedManifest = Read-Text (Join-Path $temp "manifest")
    $versionInPack = ([regex]::Match($packedManifest, "(?m)^version\s*=\s*(\S+)")).Groups[1].Value
    Assert ($versionInPack -eq $Version) "manifest.version '$versionInPack' != '$Version'"
    $checksum = ([regex]::Match($packedManifest, "(?m)^checksum\s*=\s*([0-9A-Fa-f]{32})")).Groups[1].Value
    Assert ($checksum.Length -eq 32) "manifest.checksum missing"
    $appTgz = Join-Path $temp "app.tgz"
    $md5 = (Get-FileHash -Algorithm MD5 -Path $appTgz).Hash.ToLower()
    Assert ($checksum.ToLower() -eq $md5) "checksum != MD5(app.tgz)"
    $servicePort = ([regex]::Match($packedManifest, "(?m)^service_port\s*=\s*(\d+)")).Groups[1].Value
    Assert ($servicePort -eq "17800") "manifest.service_port '$servicePort' != 17800"

    foreach ($json in @("config/privilege", "config/resource", "wizard/install", "wizard/config", "wizard/uninstall")) {
        Assert ($null -ne (Read-Text (Join-Path $temp $json) | ConvertFrom-Json)) "$json is not valid JSON"
    }
    $wizardInstall = Read-Text (Join-Path $temp "wizard/install")
    Assert ($wizardInstall -match '"field"\s*:\s*"wizard_admin_password"') "wizard/install lacks wizard_admin_password"
    Assert (-not ($wizardInstall -match '"required"\s*:\s*true')) "wizard_admin_password must stay optional"

    $appOut = Join-Path $temp "appx"
    New-Item -ItemType Directory -Path $appOut | Out-Null
    & "$env:SystemRoot\System32\tar.exe" -xzf $appTgz -C $appOut
    Assert ($LASTEXITCODE -eq 0) "tar extract of app.tgz"
    $packedCompose = Read-Text (Join-Path $appOut "docker/docker-compose.yaml")
    $imageInPack = ([regex]::Match($packedCompose, "(?m)^\s*image:\s*(\S+)\s*$")).Groups[1].Value
    Assert ($imageInPack -eq $Image) "compose image '$imageInPack' != '$Image'"
    Assert ($packedCompose -match "container_name:\s*lighttier") "compose container_name != lighttier"
    Assert ($packedCompose -match '\$\{TRIM_PKGVAR:\?\}/data:/data') "compose data mount must use \${TRIM_PKGVAR:?}/data"
    Assert ($packedCompose -match 'devices:\s*\["/dev/net/tun:/dev/net/tun"\]') "compose TUN device missing"
    Assert ($packedCompose -match 'cap_add:\s*\["NET_ADMIN", "NET_RAW", "DAC_OVERRIDE"\]') "compose capabilities missing"
    Assert ($packedCompose -match 'lighttier-agent"\s*,\s*"healthcheck') "compose healthcheck missing"
    Assert ($packedCompose -match 'LT_BIND=0\.0\.0\.0:17800') "compose LT_BIND port != 17800"

    $uiConfig = Read-Text (Join-Path $appOut "ui/config") | ConvertFrom-Json
    $entry = $uiConfig.'.url'.'lighttier.Application'
    Assert ($entry.port -eq "17800") "ui/config port '$($entry.port)' != 17800"
    Assert ($entry.type -eq "iframe") "ui/config type must be iframe"
    Assert ($entry.icon -eq "images/icon_{0}.png") "ui/config icon pattern wrong"
    Assert (Test-Path (Join-Path $appOut "ui/images/icon_64.png")) "ui icon_64 missing"
    Assert (Test-Path (Join-Path $appOut "ui/images/icon_256.png")) "ui icon_256 missing"

    $common = Read-Text (Join-Path $temp "cmd/common.sh")
    Assert ($common -match 'CONTAINER_NAME="lighttier"') "cmd/common.sh container name drifted"
    Assert ($common -match '--entrypoint /usr/local/bin/lighttier-agent') "auto-setup must override entrypoint"
    Assert ($common -match '\$image" setup') "auto-setup command missing"
    Assert ($common -match 'devices: \[\]') "no-TUN fallback for devices missing"
    Assert ($common -match 'cap_add: \["DAC_OVERRIDE"\]') "no-TUN fallback must keep DAC_OVERRIDE"
    $installCallback = Read-Text (Join-Path $temp "cmd/install_callback")
    Assert ($installCallback -match 'auto_setup') "install_callback does not run auto_setup"
    Assert ((Read-Text (Join-Path $temp "cmd/main")) -match 'source .*common\.sh') "cmd/main does not share common.sh"

    Add-Type -AssemblyName System.Drawing
    foreach ($icon in @(@{ Path = "ICON.PNG"; Size = 64 }, @{ Path = "ICON_256.PNG"; Size = 256 })) {
        $img = [System.Drawing.Image]::FromFile((Join-Path $temp $icon.Path))
        try {
            Assert ($img.Width -eq $icon.Size -and $img.Height -eq $icon.Size) "$($icon.Path) is not $($icon.Size)x$($icon.Size)"
        }
        finally { $img.Dispose() }
    }
}
finally {
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}

$outDir = Join-Path $root "out"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$artifact = Join-Path $outDir ("lighttier_{0}_{1}.fpk" -f $Version, $platform)
Move-Item $oldFpk $artifact -Force
Write-Host ("OK: {0} ({1:N1} KB), {2} assertions, image {3}" -f $artifact, ((Get-Item $artifact).Length / 1KB), $assertions, $Image)