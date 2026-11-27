# CareSpeak one-click demo launcher.
# Double-click START-DEMO.bat (or this script) to:
#   1. start the local website if it is not already running,
#   2. start the USB/Bluetooth serial bridge if it is not already running,
#   3. open the nurse dashboard in the default browser.
$ErrorActionPreference = "Continue"

$project = "C:\Users\mohda\Desktop\projects\carespeak\CareSpeak-CALLING AGENT\CareSpeak"
$session = "ZCAUEL6J"
$url     = "http://localhost:3000/nurse-view?session=$session"
$bridge  = Join-Path $project "tools\serial-bridge.ps1"

Set-Location $project

function Test-Port([int]$port) {
    try {
        $c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
        return ($null -ne $c)
    } catch { return $false }
}

function Test-BridgeRunning {
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue
        foreach ($p in $procs) {
            if ($p.CommandLine -and $p.CommandLine -like "*serial-bridge.ps1*") { return $true }
        }
        return $false
    } catch { return $false }
}

# 1. Website
if (-not (Test-Port 3000)) {
    Write-Host "[demo] Starting local website on http://localhost:3000 ..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k","title CareSpeak Website && cd /d `"$project`" && npm run dev -- -H 0.0.0.0" -WindowStyle Normal
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Port 3000) { $ready = $true; break }
    }
    if (-not $ready) {
        Write-Host "[demo] Website did not start within 60s. Check the 'CareSpeak Website' window."
    } else {
        Write-Host "[demo] Website is up."
    }
} else {
    Write-Host "[demo] Website already running on port 3000."
}

# 2. Bridge
if (-not (Test-BridgeRunning)) {
    Write-Host "[demo] Starting serial bridge (USB or Bluetooth) ..."
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File",$bridge -WindowStyle Normal
    Start-Sleep -Seconds 3
} else {
    Write-Host "[demo] Bridge already running."
}

# 3. Open dashboard
Write-Host "[demo] Opening dashboard: $url"
Start-Process $url

Write-Host "[demo] Done. Keep the 'CareSpeak Website' and bridge windows open during the demo."
Start-Sleep -Seconds 2