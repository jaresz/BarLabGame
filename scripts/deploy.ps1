$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $projectDir 'public_html'
$configPath = Join-Path $PSScriptRoot 'deploy.local.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "Deployment configuration not found: $configPath. Copy deploy.local.example.json to deploy.local.json and fill in the server settings."
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json

$requiredSettings = @('DeployDestination', 'DeployRemoteHost', 'DeployRemoteAssets', 'DeploySshPort')
$missingSettings = @($requiredSettings | Where-Object {
    $name = $_
    $setting = $config.PSObject.Properties[$_]
    $null -eq $setting -or $null -eq $setting.Value -or
        [string]::IsNullOrWhiteSpace([string]$setting.Value) -or [string]$setting.Value -match '<[^>]+>' -or
        ($name -ne 'DeploySshPort' -and ($setting.Value -isnot [string] -or [string]$setting.Value -match '[\r\n]'))
})
if ($missingSettings.Count -gt 0) {
    throw "Deployment configuration is missing valid settings: $($missingSettings -join ', '). Edit scripts/deploy.local.json and try again."
}

$destination = [string]$config.DeployDestination
$remoteHost = [string]$config.DeployRemoteHost
$remoteAssets = [string]$config.DeployRemoteAssets
$remoteIcons = $remoteAssets -replace '/assets/?$', '/icons'
$remoteSounds = $remoteAssets -replace '/assets/?$', '/sounds'
$remoteGuideImages = $remoteAssets -replace '/assets/?$', '/user-guide-images'
if ($remoteIcons -eq $remoteAssets) { throw 'DeployRemoteAssets must end with /assets so icon and sound permissions can be set.' }
if ($remoteAssets.Contains("'")) { throw "DeployRemoteAssets cannot contain a single quote in the remote chmod command." }
$sshPort = 0
if (-not [int]::TryParse([string]$config.DeploySshPort, [ref]$sshPort) -or $sshPort -lt 1 -or $sshPort -gt 65535) {
    throw 'DeploySshPort must be an integer from 1 to 65535.'
}

Push-Location $projectDir
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; deployment stopped.' }

    if (-not (Test-Path -LiteralPath (Join-Path $buildDir 'index.html') -PathType Leaf)) {
        throw 'Build output does not contain public_html/index.html; deployment stopped.'
    }

    $assetDir = Join-Path $buildDir 'assets'
    if (-not (Test-Path -LiteralPath $assetDir -PathType Container)) {
        throw 'Build output does not contain public_html/assets; deployment stopped.'
    }
    $assetNames = @(Get-ChildItem -LiteralPath $assetDir -File | ForEach-Object { $_.Name })
    if ($assetNames.Count -eq 0) { throw 'Build output contains no assets; deployment stopped.' }
    if (@($assetNames | Where-Object { $_ -notmatch '^[A-Za-z0-9._-]+$' }).Count -gt 0) {
        throw 'Asset filenames contain unsupported characters.'
    }

    $iconDir = Join-Path $buildDir 'icons'
    $soundDir = Join-Path $buildDir 'sounds'
    $guideImageDir = Join-Path $buildDir 'user-guide-images'
    $manifest = Join-Path $buildDir 'manifest.json'
    $index = Join-Path $buildDir 'index.html'
    $guide = Join-Path $buildDir 'user-guide.html'
    $favicon = Join-Path $buildDir 'favicon.png'
    $worker = Join-Path $buildDir 'sw.js'
    $versionFile = Join-Path $buildDir 'version.json'
    foreach ($file in @($iconDir, $soundDir, $guideImageDir, $manifest, $guide, $favicon, $worker, $versionFile)) {
        if (-not (Test-Path -LiteralPath $file)) { throw "Build output is missing $file; deployment stopped." }
    }
    if (@(Get-ChildItem -LiteralPath $soundDir -File -Filter '*.wav').Count -eq 0) {
        throw 'Build output contains no WAV sounds; deployment stopped.'
    }

    # The worker precaches the player guide and its images, so upload them before sw.js.
    Write-Host "Uploading application assets, icons, sounds, and guide images to $destination"
    & scp -r -P $sshPort $assetDir $iconDir $soundDir $guideImageDir $destination
    if ($LASTEXITCODE -ne 0) { throw 'Asset upload failed.' }

    & scp -P $sshPort $manifest $index $guide $favicon $destination
    if ($LASTEXITCODE -ne 0) { throw 'Page upload failed.' }

    & ssh -p $sshPort $remoteHost "chmod -R a+rX '$remoteAssets' '$remoteIcons' '$remoteSounds' '$remoteGuideImages'"
    if ($LASTEXITCODE -ne 0) { throw 'Could not set permissions on uploaded assets, icons, sounds, and guide images.' }

    & scp -P $sshPort $worker $destination
    if ($LASTEXITCODE -ne 0) { throw 'Service worker upload failed.' }

    # Announce the release only after its files and service worker are uploaded.
    & scp -P $sshPort $versionFile $destination
    if ($LASTEXITCODE -ne 0) { throw 'Version metadata upload failed.' }

    Write-Host 'Deployment completed.'
}
finally {
    Pop-Location
}
