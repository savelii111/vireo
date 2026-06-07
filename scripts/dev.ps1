# Vireo dev runner (Windows/PowerShell) — starts 5 core agents in background.
# Usage: .\scripts\dev.ps1 [start|stop|status|logs]

param(
  [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$ROOT = (Get-Item $PSScriptRoot).Parent.FullName
$LOGDIR = if ($env:VIREO_LOGDIR) { $env:VIREO_LOGDIR } else { "$env:TEMP" }

function Start-One($name, $cmd) {
  $logfile = "$LOGDIR/vireo-$name.log"
  Write-Host "▶ $name → $logfile"
  $arg = "-NoProfile -Command `"Set-Location -LiteralPath '$ROOT'; $cmd 2>&1 | Out-File -Encoding utf8 '$logfile'`""
  $process = Start-Process -FilePath "powershell" `
    -ArgumentList $arg `
    -PassThru -WindowStyle Hidden
  $process.Id | Out-File "$LOGDIR/vireo-$name.pid" -Encoding ascii
}

function Stop-One($name) {
  $pidfile = "$LOGDIR/vireo-$name.pid"
  if (Test-Path -LiteralPath $pidfile) {
    $pid_val = Get-Content $pidfile
    try {
      Stop-Process -Id $pid_val -Force -ErrorAction SilentlyContinue
      Write-Host "■ $name (pid $pid_val)"
    } catch {
      Write-Host "■ $name (already stopped)"
    }
    Remove-Item -LiteralPath $pidfile -Force
  }
}

function Status-One($name) {
  $pidfile = "$LOGDIR/vireo-$name.pid"
  if (Test-Path -LiteralPath $pidfile) {
    $pid_val = Get-Content $pidfile
    $proc = Get-Process -Id $pid_val -ErrorAction SilentlyContinue
    if ($proc) {
      Write-Host "● $name (pid $pid_val)"
    } else {
      Write-Host "○ $name (stopped)"
    }
  } else {
    Write-Host "○ $name (not started)"
  }
}

function Logs-One($name) {
  $logfile = "$LOGDIR/vireo-$name.log"
  if (Test-Path -LiteralPath $logfile) {
    Get-Content $logfile -Tail 30
  } else {
    Write-Host "No log for $name"
  }
}

switch ($Action) {
  "start" {
    Start-One "style-learner" "python -m vireo_style_learner.server"
    Start-One "editor"        "python -m vireo_editor.server"
    Start-One "video"         "python -m vireo_video.server"
    Start-One "distributor"   "node agents/distributor/src/server.js"
    Start-One "dashboard"     "node apps/dashboard/server.js"
    Write-Host ""
    Write-Host "Vireo running. Dashboard: http://localhost:3000"
    Write-Host "Logs: $env:TEMP\vireo-*.log"
    Write-Host "Stop with: .\scripts\dev.ps1 stop"
    Start-Sleep -Seconds 3
    Write-Host ""
    Write-Host "Health check:"
    & curl.exe -s http://127.0.0.1:8001/health 2>&1 | Select-Object -First 5
    & curl.exe -s http://127.0.0.1:8002/health 2>&1 | Select-Object -First 5
    & curl.exe -s http://127.0.0.1:8007/health 2>&1 | Select-Object -First 5
    & curl.exe -s http://127.0.0.1:8003/health 2>&1 | Select-Object -First 5
    & curl.exe -s http://127.0.0.1:3000/health 2>&1 | Select-Object -First 5
  }
  "stop" {
    Stop-One "dashboard"
    Stop-One "distributor"
    Stop-One "video"
    Stop-One "editor"
    Stop-One "style-learner"
    Write-Host "All stopped."
  }
  "status" {
    Status-One "style-learner"
    Status-One "editor"
    Status-One "video"
    Status-One "distributor"
    Status-One "dashboard"
  }
  "logs" {
    $name = $args[0]
    if ($name) {
      Logs-One $name
    } else {
      Get-ChildItem -Path "$LOGDIR" -Filter "vireo-*.log" | ForEach-Object {
        Write-Host "===== $($_.Name) ====="
        Get-Content $_.FullName -Tail 10
        Write-Host ""
      }
    }
  }
  default {
    Write-Host "Usage: .\dev.ps1 [start|stop|status|logs [name]]"
  }
}
