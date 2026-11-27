# CareSpeak wearable bridge (USB serial OR Bluetooth Classic SPP)
#
# Reads "TX vitals: {...}" lines from the ESP32 and forwards them to the local
# CareSpeak server. Works in three modes with no venue Wi-Fi and no internet:
#   1. USB cable  -> CP210x COM port (preferred)
#   2. Battery     -> Bluetooth SPP virtual COM port (untethered)
#   3. Either      -> the same local HTTP endpoint
#
# Keep this window open during the demo.
param([switch]$BtOnly)
$ErrorActionPreference = "Continue"

$api   = "http://127.0.0.1:3000/api/ingest"
$token = "937a7b8ba22a6b61643d506fa534452e8b2f2309443bc1c4acaed1692d51f396"
$btMac = "C0CDD6D12C8E"          # ESP32 Bluetooth address (CareSpeak-ESP32)
$log   = Join-Path $env:TEMP "carespeak-serial-bridge.log"

function Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $log -Value $line -ErrorAction SilentlyContinue
}

# Return the ports worth trying, in priority order: USB first, then the
# Bluetooth SPP port that belongs to this ESP32.
function Get-PortCandidates {
    $candidates = New-Object System.Collections.Generic.List[object]
    $seen = @{}
    $devices = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue

    foreach ($d in $devices) {
        if ($BtOnly) { break }
        if ($d.Name -notmatch 'CP210|CH340|USB-SERIAL|Silicon Labs') { continue }
        $m = [regex]::Match($d.Name, '\((COM\d+)\)')
        if (-not $m.Success) { continue }
        $com = $m.Groups[1].Value
        if ($seen.ContainsKey($com)) { continue }
        $seen[$com] = $true
        [void]$candidates.Add([pscustomobject]@{ Port = $com; Kind = "USB"; FirstDataTimeout = 15 })
    }

    $btOther = New-Object System.Collections.Generic.List[object]
    foreach ($d in $devices) {
        if ($d.Name -notmatch 'Standard Serial over Bluetooth') { continue }
        $m = [regex]::Match($d.Name, '\((COM\d+)\)')
        if (-not $m.Success) { continue }
        $com = $m.Groups[1].Value
        if ($seen.ContainsKey($com)) { continue }

        if ($d.PNPDeviceID -and $d.PNPDeviceID -match $btMac) {
            $seen[$com] = $true
            [void]$candidates.Add([pscustomobject]@{ Port = $com; Kind = "BT-ESP32"; FirstDataTimeout = 15 })
        } else {
            [void]$btOther.Add([pscustomobject]@{ Port = $com; Kind = "BT-other"; FirstDataTimeout = 6 })
        }
    }

    # If the ESP32's own port was not found, try the other Bluetooth ports as a
    # last resort (some Windows builds hide the remote address from the name).
    $hasEspBt = @($candidates | Where-Object { $_.Kind -eq "BT-ESP32" }).Count -gt 0
    if (-not $hasEspBt) {
        foreach ($c in $btOther) {
            if (-not $seen.ContainsKey($c.Port)) {
                $seen[$c.Port] = $true
                [void]$candidates.Add($c)
            }
        }
    }

    return $candidates
}

function Post-Vitals([string]$json) {
    try {
        $body = $json | ConvertFrom-Json -ErrorAction Stop
        Invoke-RestMethod -Uri $api -Method POST -ContentType 'application/json' `
            -Headers @{ 'x-device-token' = $token } -Body $json -TimeoutSec 5 | Out-Null
        Log ("POST ok  hr={0} spo2={1} finger={2}" -f $body.heartRate, $body.spo2, $body.finger)
    } catch {
        Log ("POST failed: {0}" -f $_.Exception.Message)
    }
}

Log "=== CareSpeak bridge starting (USB or Bluetooth, no Wi-Fi needed) ==="

while ($true) {
    $candidates = @(Get-PortCandidates)
    if ($candidates.Count -eq 0) {
        Log "No ESP32 serial port found; waiting..."
        Start-Sleep -Seconds 3
        continue
    }

    foreach ($c in $candidates) {
        $sp = $null
        $dataSeen = $false
        try {
            $sp = New-Object System.IO.Ports.SerialPort($c.Port, 115200, 'None', 8, 'One')
            $sp.ReadTimeout  = 500
            $sp.WriteTimeout = 500
            # Never assert DTR/RTS: the CP2102 auto-reset circuit would reboot
            # the board every time the bridge opens the USB port.
            $sp.DtrEnable = $false
            $sp.RtsEnable = $false
            $sp.Open()
            Log ("Listening on {0} ({1}) at 115200 baud..." -f $c.Port, $c.Kind)

            $lastData = Get-Date
            while ($true) {
                $line = $null
                try {
                    $line = $sp.ReadLine()
                } catch [System.TimeoutException] {
                    $line = $null
                }

                if ($null -eq $line) {
                    $silence = ((Get-Date) - $lastData).TotalSeconds
                    $limit = if ($dataSeen) { 120 } else { $c.FirstDataTimeout }
                    if ($silence -gt $limit) {
                        Log ("No data on {0} for {1:N0}s; trying next port..." -f $c.Port, $silence)
                        break
                    }
                    continue
                }

                if ($line.Length -eq 0) { continue }
                $lastData = Get-Date

                if (-not $dataSeen) {
                    $dataSeen = $true
                    Log ("Live data on {0} ({1})" -f $c.Port, $c.Kind)
                }

                if ($line -match 'TX vitals:\s*(\{.*\})') {
                    Post-Vitals $Matches[1]
                } elseif ($line -match 'MAXIM:|BT:|Wi-Fi: connected|Server: (loaded|discovered|UDP)|CareSpeak Wearable|Sensor: finger|Wi-Fi: OFF') {
                    Log $line.Trim()
                }
            }
        } catch {
            Log ("Serial error on {0}: {1}" -f $c.Port, $_.Exception.Message)
        } finally {
            if ($sp -and $sp.IsOpen) {
                try {
                    $sp.DtrEnable = $false
                    $sp.RtsEnable = $false
                    $sp.Close()
                } catch {}
            }
        }
    }

    Start-Sleep -Seconds 2
}
