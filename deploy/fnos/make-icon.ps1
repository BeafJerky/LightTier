param(
    [string]$Source = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $root "lighttier"
if (-not $Source) {
    $Source = Join-Path $root "../../src-tauri/icons/icon.png"
}
Add-Type -AssemblyName System.Drawing

$image = [System.Drawing.Image]::FromFile((Resolve-Path $Source))

function Save-Resized([int]$Size, [string]$Path) {
    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.DrawImage($script:image, 0, 0, $Size, $Size)
    $graphics.Dispose()
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
}

Save-Resized 64 (Join-Path $appDir "ICON.PNG")
Save-Resized 256 (Join-Path $appDir "ICON_256.PNG")
Save-Resized 64 (Join-Path $appDir "app/ui/images/icon_64.png")
Save-Resized 256 (Join-Path $appDir "app/ui/images/icon_256.png")
$image.Dispose()
Write-Host "fpk icons written from $Source"