$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

$minikubeIp = (minikube ip -p yoizen-arch).Trim()
if ([string]::IsNullOrWhiteSpace($minikubeIp)) {
  throw "Could not resolve minikube IP for profile 'yoizen-arch'."
}

$env:MINIKUBE_IP = $minikubeIp

$kourierReachable = $false
try {
  $connection = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction Stop
  if ($connection) {
    $kourierReachable = $true
  }
} catch {
  $kourierReachable = $false
}

Write-Host "MINIKUBE_IP=$env:MINIKUBE_IP"

if (-not $kourierReachable) {
  Write-Warning "Kourier port-forward was not detected on localhost:8080."
  Write-Host "Run this in another terminal:"
  Write-Host "kubectl port-forward -n kourier-system svc/kourier 8080:80"
}

Set-Location $projectRoot
npm run start
