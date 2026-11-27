# CareSpeak one-click demo launcher.
# Double-click START-DEMO.bat (or this script) to:
#   1. auto-connect to the paired ESP32 (CareSpeak-ESP32) over Bluetooth,
#   2. start the local website if it is not already running,
#   3. start the USB/Bluetooth serial bridge if it is not already running,
#   4. open the nurse dashboard in the default browser.
$ErrorActionPreference = "Continue"

$project = "C:\Users\mohda\Desktop\projects\carespeak\CareSpeak-CALLING AGENT\CareSpeak"
$session = "ZCAUEL6J"
$url     = "http://localhost:3000/nurse-view?session=$session"
$bridge  = Join-Path $project "tools\serial-bridge.ps1"
$btMac   = "C0CDD6D12C8E"

Set-Location $project

function Test-Port([int]$port) {
    try { return ($null -ne (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) }
    catch { return $false }
}

function Test-BridgeRunning {
    try {
        foreach ($p in (Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue)) {
            if ($p.CommandLine -and $p.CommandLine -like "*serial-bridge.ps1*" -and $p.CommandLine -notlike "*Get-CimInstance*") { return $true }
        }
        return $false
    } catch { return $false }
}

function Get-BtPorts {
    $list = @()
    foreach ($d in (Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue)) {
        if ($d.Name -notmatch 'Standard Serial over Bluetooth') { continue }
        $m = [regex]::Match($d.Name, '\((COM\d+)\)')
        if (-not $m.Success) { continue }
        $list += [pscustomobject]@{ Port = $m.Groups[1].Value; PNP = $d.PNPDeviceID; MacMatch = ($d.PNPDeviceID -match $btMac) }
    }
    # Prefer the port whose PNPDeviceID contains the ESP32 MAC.
    $preferred = $list | Where-Object { $_.MacMatch } | Select-Object -First 1
    $rest = $list | Where-Object { -not $_.MacMatch }
    if ($preferred) { $ordered = @($preferred) + $rest } else { $ordered = $rest }
    return $ordered
}

function Try-BtConnect {
    # Try each candidate port; return the one that yields live data.
    $candidates = Get-BtPorts
    if ($candidates.Count -eq 0) {
        Write-Host "[demo] No Bluetooth serial ports found at all."
        return $null
    }
    foreach ($c in $candidates) {
        Write-Host "[demo] Trying $($c.Port) ..."
        $sp = $null
        try {
            $sp = New-Object System.IO.Ports.SerialPort($c.Port, 115200, 'None', 8, 'One')
            $sp.ReadTimeout = 1000
            $sp.DtrEnable = $false
            $sp.RtsEnable = $false
            $sp.Open()
            $deadline = (Get-Date).AddSeconds(8)
            $gotData = $false
            while ((Get-Date) -lt $deadline -and -not $gotData) {
                try {
                    $line = $sp.ReadLine()
                    if ($line -and $line -match 'TX vitals|CareSpeak|MAXIM') { $gotData = $true }
                } catch { }
            }
            if ($gotData) {
                Write-Host "[demo] Connected on $($c.Port) - live data flowing."
                return $c.Port
            } else {
                Write-Host "[demo] $($c.Port) opened but no data."
            }
        } catch {
            Write-Host "[demo] $($c.Port) could not be opened: $($_.Exception.Message)"
        } finally {
            if ($sp -and $sp.IsOpen) { try { $sp.Close() } catch { } }
        }
    }
    return $null
}

# 1. Bluetooth auto-connect (skip if bridge already owns a port)
$bridgeAlready = Test-BridgeRunning
if ($bridgeAlready) {
    Write-Host "[demo] Bridge already running - skipping Bluetooth pre-connect."
} else {
    Write-Host "[demo] Auto-connecting to CareSpeak-ESP32 over Bluetooth..."
    $connectedPort = $null
    # Give Windows a moment to expose the port after radio on.
    for ($attempt = 1; $attempt -le 3 -and -not $connectedPort; $attempt++) {
        if ($attempt -gt 1) { Start-Sleep -Seconds 3 }
        $connectedPort = Try-BtConnect
    }
    if ($connectedPort) {
        Write-Host "[demo] Bluetooth connected on $connectedPort."
    } else {
        Write-Host "[demo] Could not auto-connect over Bluetooth."
        Write-Host "[demo] Checklist: Bluetooth ON in Windows Settings; 'CareSpeak-ESP32' paired; ESP32 powered on battery."
        Write-Host "[demo] The bridge will keep retrying on its own."
    }
}

# 2. Website
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

# 3. Bridge (quote the path because it contains spaces)
if (-not (Test-BridgeRunning)) {
    Write-Host "[demo] Starting serial bridge (USB or Bluetooth) ..."
    $bridgeQuoted = '"' + $bridge + '"'
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File $bridgeQuoted" -WindowStyle Normal
    Start-Sleep -Seconds 4
} else {
    Write-Host "[demo] Bridge already running."
}

# 4. Confirm data is actually flowing into the website
Write-Host "[demo] Verifying readings reach the website..."
$flowing = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    try {
        $v = Invoke-RestMethod -Uri "http://localhost:3000/api/sync?session=$session&since=0" -TimeoutSec 5
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $d = $v.vitals.esp32_mohd_bed1
        if ($d -and $d.receivedAt -and ($now - $d.receivedAt) -lt 12000) { $flowing = $true; break }
    } catch { }
}
if ($flowing) {
    Write-Host "[demo] Readings are flowing into the website. Opening dashboard..."
} else {
    Write-Host "[demo] No fresh readings yet - the bridge is still connecting. Opening dashboard anyway."
}

# 5. Open dashboard
Start-Process $url

Write-Host "[demo] Done. Keep the 'CareSpeak Website' and bridge windows open during the demo."
Start-Sleep -Seconds 2