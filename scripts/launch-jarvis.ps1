$ErrorActionPreference = "Stop"

$project = Split-Path $PSScriptRoot -Parent
$electron = Join-Path $project "node_modules\electron\dist\electron.exe"
$main = Join-Path $project "electron\main.cjs"
$hermesPort = 8643

$listening = Get-NetTCPConnection -LocalPort $hermesPort -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  $hermes = Join-Path $env:LOCALAPPDATA "hermes\bin\hermes.exe"
  if (Test-Path $hermes) {
    try {
      & $hermes gateway start *> $null
    } catch {
      # Hermes may be managed by Hermes Desktop; opening the app is still useful.
    }
    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep -Milliseconds 500
      if (Get-NetTCPConnection -LocalPort $hermesPort -State Listen -ErrorAction SilentlyContinue) {
        break
      }
    }
  }
}

if (-not (Test-Path $electron)) {
  Set-Location $project
  & npm.cmd exec electron electron/main.cjs
  exit $LASTEXITCODE
}

if (-not (Test-Path (Join-Path $project "dist\index.html"))) {
  Set-Location $project
  & npm.cmd run build
}

& $electron $main
