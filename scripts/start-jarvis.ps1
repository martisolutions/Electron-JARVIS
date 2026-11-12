$ErrorActionPreference = "Stop"

& "$PSScriptRoot\hermes-tunnel.ps1"
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path "dist\index.html")) {
  npm run build
}

npx electron electron/main.cjs
