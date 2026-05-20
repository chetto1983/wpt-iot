<#
.SYNOPSIS
  Fast iterative deploy of @wpt to a Raspberry Pi (no GitHub, no CI).

.DESCRIPTION
  Tarballs the source, scp to Pi, rsync into /opt/wpt-iot, runs
  docker compose up -d --build. Leverages BuildKit cache mount in the
  Dockerfiles so rebuilds after the first one finish in seconds when
  code is unchanged.

.PARAMETER PiHost     Pi hostname or IP. Default: 192.168.0.102
.PARAMETER PiUser     SSH user. Default: wpt
.PARAMETER PiPass     SSH password. Env WPT_PI_PASS overrides default.
.PARAMETER InstallDir Remote install dir. Default: /opt/wpt-iot
.PARAMETER FreshDb    If set, removes the pgdata volume before bringing up.

.EXAMPLE
  ./scripts/quick-deploy.ps1
  ./scripts/quick-deploy.ps1 -FreshDb
  ./scripts/quick-deploy.ps1 -PiHost 10.0.0.50

.NOTES
  Requires plink.exe + pscp.exe at C:\Program Files\PuTTY\ and tar.exe (built-in).
#>
[CmdletBinding()]
param(
  [string]$PiHost     = '192.168.0.102',
  [string]$PiUser     = 'wpt',
  [string]$PiPass     = $(if ($env:WPT_PI_PASS) { $env:WPT_PI_PASS } else { 'wpt' }),
  [string]$InstallDir = '/opt/wpt-iot',
  [switch]$FreshDb
)

$ErrorActionPreference = 'Stop'
$script:RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$script:Plink    = 'C:\Program Files\PuTTY\plink.exe'
$script:Pscp     = 'C:\Program Files\PuTTY\pscp.exe'
$script:Tar      = "$env:WINDIR\System32\tar.exe"

function Test-Tools {
  foreach ($t in @($script:Plink, $script:Pscp, $script:Tar)) {
    if (-not (Test-Path $t)) { throw "Missing tool: $t" }
  }
}

function Invoke-PiSsh([string]$Cmd) {
  & $script:Plink -ssh -batch -pw $PiPass "$PiUser@$PiHost" $Cmd
  if ($LASTEXITCODE -ne 0) { throw "SSH failed (exit $LASTEXITCODE): $Cmd" }
}

function Push-PiFile([string]$Local, [string]$Remote) {
  & $script:Pscp -batch -pw $PiPass $Local "${PiUser}@${PiHost}:$Remote" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "scp failed for $Local -> $Remote" }
}

function Write-Step([string]$Msg) {
  Write-Host ""
  Write-Host "==> $Msg" -ForegroundColor Cyan
}

# ---- main ----
Test-Tools
Write-Host "Target: $PiUser@$PiHost  ->  $InstallDir" -ForegroundColor Yellow

# 1) Tarball source
$tarball = Join-Path $env:TEMP 'wpt-iot-src.tar.gz'
if (Test-Path $tarball) { Remove-Item $tarball -Force }

Write-Step "Tarball source (excluding heavy/ephemeral dirs)"
$exc = @(
  '--exclude=node_modules', '--exclude=.next', '--exclude=.turbo',
  '--exclude=dist',         '--exclude=coverage',
  '--exclude=playwright-report', '--exclude=test-results',
  '--exclude=.git',         '--exclude=*.log',
  '--exclude=.env',         '--exclude=.env.local'
)
$parent = Split-Path $script:RepoRoot -Parent
$leaf   = Split-Path $script:RepoRoot -Leaf
$tarArgs = $exc + @('-czf', $tarball, '-C', $parent, $leaf)
& $script:Tar @tarArgs
Write-Host ("  Tarball: {0:N1} MB" -f ((Get-Item $tarball).Length / 1MB))

# 2) Upload tarball + .env
Write-Step "Upload tarball + .env to Pi"
Push-PiFile $tarball '/tmp/wpt-iot-src.tar.gz'
$envPath = Join-Path $script:RepoRoot '.env'
if (Test-Path $envPath) {
  Push-PiFile $envPath '/tmp/wpt-local.env'
} else {
  Write-Warning "No .env in repo root - Pi will keep its current $InstallDir/.env"
}

# 3) Extract + rsync on Pi (build bash script as one string, force LF)
Write-Step "Extract source on Pi and rsync into $InstallDir"
$remoteScript = "D:\tmp\quick-deploy-extract.sh"
$extractContent = @"
#!/bin/bash
set -euo pipefail
INSTALL_DIR="$InstallDir"
LEAF="$leaf"
tar -xzf /tmp/wpt-iot-src.tar.gz -C /tmp/
sudo mkdir -p "`$INSTALL_DIR"
sudo rsync -a --delete --exclude="/.env" --exclude="/certs/" "/tmp/`$LEAF/" "`$INSTALL_DIR/"
rm -rf "/tmp/`$LEAF"
if [ -f /tmp/wpt-local.env ]; then
  sudo install -m 600 -o root -g root /tmp/wpt-local.env "`$INSTALL_DIR/.env"
fi
"@
$extractContent = $extractContent -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($remoteScript, $extractContent, [System.Text.UTF8Encoding]::new($false))
Push-PiFile $remoteScript '/tmp/quick-deploy-extract.sh'
Invoke-PiSsh "bash /tmp/quick-deploy-extract.sh"

# 4) Tear down + bring up
if ($FreshDb) {
  Write-Step "Tearing down with -v (pgdata reset)"
  Invoke-PiSsh "cd $InstallDir; echo $PiPass | sudo -S docker compose down -v"
} else {
  Write-Step "Tearing down (volumes preserved)"
  Invoke-PiSsh "cd $InstallDir; echo $PiPass | sudo -S docker compose down"
}

Write-Step "docker compose up -d --build (BuildKit cache mount active)"
$buildSw = [System.Diagnostics.Stopwatch]::StartNew()
Invoke-PiSsh "cd $InstallDir; echo $PiPass | sudo -S env DOCKER_BUILDKIT=1 docker compose up -d --build"
$buildSw.Stop()
Write-Host ("  Build+up duration: {0:N1}s" -f $buildSw.Elapsed.TotalSeconds) -ForegroundColor Green

# 5) Health wait
Write-Step "Waiting for backend /api/health (up to 5 min)"
$healthScript = "D:\tmp\quick-deploy-health.sh"
$healthContent = @'
#!/bin/bash
for i in $(seq 1 60); do
  if curl -fsS -m 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "backend healthy after $((i*5))s"
    exit 0
  fi
  sleep 5
done
echo "TIMEOUT"
exit 1
'@
$healthContent = $healthContent -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($healthScript, $healthContent, [System.Text.UTF8Encoding]::new($false))
Push-PiFile $healthScript '/tmp/quick-deploy-health.sh'
Invoke-PiSsh "bash /tmp/quick-deploy-health.sh"

Write-Step "docker compose ps"
Invoke-PiSsh "cd $InstallDir; echo $PiPass | sudo -S docker compose ps"

Write-Host ""
Write-Host "Deploy completed." -ForegroundColor Green
