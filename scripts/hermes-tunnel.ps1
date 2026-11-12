$ErrorActionPreference = "Stop"

$existing = Get-NetTCPConnection -LocalPort 8642 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Output "Hermes tunnel already active on 127.0.0.1:8642"
  exit 0
}

Start-Process -FilePath "ssh" -ArgumentList @(
  "-N",
  "-L", "8642:127.0.0.1:8642",
  "-o", "BatchMode=yes",
  "-o", "ExitOnForwardFailure=yes",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3",
  "jarvis"
) -WindowStyle Hidden

Start-Sleep -Seconds 2

if (Get-NetTCPConnection -LocalPort 8642 -State Listen -ErrorAction SilentlyContinue) {
  Write-Output "Hermes tunnel active on 127.0.0.1:8642"
} else {
  Write-Error "Could not open the SSH tunnel to 'jarvis'. Check that the SSH key and host alias still work."
  exit 1
}
