<#
.SYNOPSIS
  Fast iterative deploy of @wpt to a Raspberry Pi (no GitHub, no CI).

.DESCRIPTION
  Two modes:
    -Mode Local       (default) — Sync source to the Pi, run `docker compose up -d --build`
                                  on the Pi. Leverages the BuildKit pnpm-store cache mount
                                  in the Dockerfiles, so rebuilds after the first one finish
                                  in seconds for code-only changes.
    -Mode CrossBuild  Build linux/arm64 images on the local PC via `docker buildx`
                                  (requires Docker Desktop running with buildx + QEMU),
                                  docker save → scp → docker load on the Pi, then compose up.

  Defaults are tuned for a single dev Pi at 192.168.0.102 reached via plink/pscp (PuTTY).

.PARAMETER PiHost     Pi hostname or IP. Default: 192.168.0.102
.PARAMETER PiUser     SSH user. Default: wpt
.PARAMETER PiPass     SSH password. Default: wpt (env WPT_PI_PASS overrides)
.PARAMETER InstallDir Remote install dir. Default: /opt/wpt-iot
.PARAMETER Mode       Local | CrossBuild. Default: Local
.PARAMETER FreshDb    If set, removes the pgdata volume before bringing the stack up
                      (admin password from local .env is honored).

.EXAMPLE
  # Daily dev iteration:
  ./scripts/quick-deploy.ps1

  # Re-deploy with clean DB:
  ./scripts/quick-deploy.ps1 -FreshDb

  # Build on PC, deploy as tar:
  ./scripts/quick-deploy.ps1 -Mode CrossBuild

.NOTES
  Tools required on the PC:
    * PuTTY (plink.exe + pscp.exe) — typically at C:\Program Files\PuTTY\
    * tar.exe                       — built-in on Windows 10/11
    * Docker Desktop                — only when -Mode CrossBuild
#>
[CmdletBinding()]
param(
  [string]$PiHost     = '192.168.0.102',
  [string]$PiUser     = 'wpt',
  [string]$PiPass     = $(if ($env:WPT_PI_PASS) { $env:WPT_PI_PASS } else { 'wpt' }),
  [string]$InstallDir = '/opt/wpt-iot',
  [ValidateSet('Local', 'CrossBuild')]
  [string]$Mode       = 'Local',
  [switch]$FreshDb
)

$ErrorActionPreference = 'Stop'
$script:RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$script:Plink    = 'C:\Program Files\PuTTY\plink.exe'
$script:Pscp     = 'C:\Program Files\PuTTY\pscp.exe'
$script:Tar      = "$env:WINDIR\System32\tar.exe"

function Test-Tools {
  $missing = @()
  foreach ($t in @($script:Plink, $script:Pscp, $script:Tar)) {
    if (-not (Test-Path $t)) { $missing += $t }
  }
  if ($missing.Count) {
    throw "Missing tools:`n  $($missing -join `"`n  `")"
  }
}

function Invoke-PiSsh([string]$Cmd) {
  & $script:Plink -ssh -batch -pw $PiPass "$PiUser@$PiHost" $Cmd
  if ($LASTEXITCODE -ne 0) { throw "SSH command failed (exit $LASTEXITCODE): $Cmd" }
}

function Push-PiFile([string]$Local, [string]$Remote) {
  & $script:Pscp -batch -pw $PiPass $Local "${PiUser}@${PiHost}:$Remote" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "scp failed for $Local -> $Remote" }
}

function Write-Step([string]$Msg) {
  Write-Host ""
  Write-Host "==> $Msg" -ForegroundColor Cyan
}

function Deploy-Local {
  $tar = Join-Path $env:TEMP 'wpt-iot-src.tar.gz'
  if (Test-Path $tar) { Remove-Item $tar -Force }

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
  & $script:Tar @($exc + @('-czf', $tar, '-C', $parent, $leaf))
  Write-Host "  Tarball: $([math]::Round((Get-Item $tar).Length / 1MB, 1)) MB"

  Write-Step "Upload tarball + .env to Pi"
  Push-PiFile $tar               '/tmp/wpt-iot-src.tar.gz'
  $envPath = Join-Path $script:RepoRoot '.env'
  if (Test-Path $envPath) {
    Push-PiFile $envPath '/tmp/wpt-local.env'
  } else {
    Write-Warning "No .env in repo root — Pi will keep its current /opt/wpt-iot/.env"
  }

  Write-Step "Extract source on Pi and rsync into $InstallDir"
  # rsync keeps /opt/wpt-iot/.env and certs intact
  Invoke-PiSsh @"
set -euo pipefail
tar -xzf /tmp/wpt-iot-src.tar.gz -C /tmp/
sudo mkdir -p $InstallDir
sudo rsync -a --delete --exclude='/.env' --exclude='/certs/' /tmp/$leaf/ $InstallDir/
rm -rf /tmp/$leaf
if [ -f /tmp/wpt-local.env ]; then
  sudo install -m 600 -o root -g root /tmp/wpt-local.env $InstallDir/.env
fi
"@

  if ($FreshDb) {
    Write-Step "Tearing down with -v (pgdata volume will be reset)"
    Invoke-PiSsh "cd $InstallDir && sudo docker compose down -v"
  } else {
    Write-Step "Tearing down (volumes preserved)"
    Invoke-PiSsh "cd $InstallDir && sudo docker compose down"
  }

  Write-Step "docker compose up -d --build (uses BuildKit cache mount)"
  Invoke-PiSsh "cd $InstallDir && DOCKER_BUILDKIT=1 sudo -E docker compose up -d --build"

  Wait-PiHealth
}

function Deploy-CrossBuild {
  # Verify Docker Desktop is running
  try { docker info --format '{{.Architecture}}' | Out-Null } catch {
    throw "Docker Desktop is not running. Start it and retry, or use -Mode Local."
  }

  # Ensure a buildx builder with multi-arch support exists
  $builderName = 'wpt-arm64'
  $existing = (docker buildx ls) -match $builderName
  if (-not $existing) {
    Write-Step "Creating buildx builder '$builderName' with QEMU arm64 support"
    docker run --privileged --rm tonistiigi/binfmt --install arm64 | Out-Null
    docker buildx create --name $builderName --driver docker-container --use --platform linux/arm64,linux/amd64 | Out-Null
    docker buildx inspect --bootstrap | Out-Null
  } else {
    docker buildx use $builderName | Out-Null
  }

  $tag = "wpt-cross-build:$(Get-Date -Format yyyyMMdd-HHmmss)"
  $beTag = "wpt-backend:$tag"
  $feTag = "wpt-frontend:$tag"

  Write-Step "Build linux/arm64 backend image"
  docker buildx build --platform linux/arm64 -f apps/backend/Dockerfile -t $beTag --load $script:RepoRoot
  if ($LASTEXITCODE -ne 0) { throw "Backend buildx build failed" }

  Write-Step "Build linux/arm64 frontend image"
  docker buildx build --platform linux/arm64 -f apps/frontend/Dockerfile -t $feTag --load $script:RepoRoot
  if ($LASTEXITCODE -ne 0) { throw "Frontend buildx build failed" }

  Write-Step "docker save → scp → docker load on Pi"
  $beTarLocal = Join-Path $env:TEMP "be-arm64.tar"
  $feTarLocal = Join-Path $env:TEMP "fe-arm64.tar"
  docker save -o $beTarLocal $beTag
  docker save -o $feTarLocal $feTag
  Push-PiFile $beTarLocal '/tmp/wpt-backend-arm64.tar'
  Push-PiFile $feTarLocal '/tmp/wpt-frontend-arm64.tar'
  Invoke-PiSsh "sudo docker load -i /tmp/wpt-backend-arm64.tar && sudo docker load -i /tmp/wpt-frontend-arm64.tar"

  # Re-tag to what docker-compose.yml expects (override via env)
  Invoke-PiSsh @"
sudo docker tag $beTag wpt-iot-backend:latest
sudo docker tag $feTag wpt-iot-frontend:latest
"@

  # NB: this assumes docker-compose.yml uses `image:` fields (not `build:`).
  # The current compose file uses `build:`, so this mode also needs a compose
  # override that points to the pre-built images. Left as a TODO.
  Write-Warning "CrossBuild mode requires a docker-compose.override.yml on the Pi that uses 'image:' instead of 'build:' for backend/frontend. Skipping compose up — finish manually or use -Mode Local."
}

function Wait-PiHealth {
  Write-Step "Waiting for backend /api/health (up to 5 min)"
  $script = @'
for i in $(seq 1 60); do
  if curl -fsS -m 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "OK after $((i*5))s"
    exit 0
  fi
  sleep 5
done
echo "TIMEOUT"
exit 1
'@
  Invoke-PiSsh $script
  Write-Step "docker compose ps"
  Invoke-PiSsh "cd $InstallDir && sudo docker compose ps"
}

# ---- main ----
Test-Tools
Write-Host "Target: $PiUser@$PiHost  ->  $InstallDir  (mode: $Mode)" -ForegroundColor Yellow
switch ($Mode) {
  'Local'      { Deploy-Local }
  'CrossBuild' { Deploy-CrossBuild }
}
Write-Host ""
Write-Host "Deploy completed." -ForegroundColor Green
