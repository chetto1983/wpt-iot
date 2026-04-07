#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# WPT IoT — Production Bootstrap Installer
# =============================================================================
# Brings up a fresh Ubuntu (22.04 / 24.04) machine in production mode:
#   - Installs Docker + Compose v2 if missing
#   - Pulls pre-built images from GHCR (no source code needed on the machine)
#   - Sets up avahi-daemon to publish wpt.local on the LAN
#   - Starts watchtower to auto-pull image updates every 5 minutes
#   - Persists state in /opt/wpt-iot
#
# Usage on a fresh machine:
#   curl -fsSL https://raw.githubusercontent.com/chetto1983/wpt-iot/master/scripts/install-prod.sh | sudo bash
#
# Or with a custom branch:
#   curl -fsSL https://raw.githubusercontent.com/chetto1983/wpt-iot/master/scripts/install-prod.sh | sudo BRANCH=master bash
#
# This is intentionally separate from install-linux.sh:
#   install-linux.sh   - DEV/STAGING: builds images locally from source
#   install-prod.sh    - PRODUCTION:  pulls pre-built images from GHCR
# =============================================================================

# --- Config (override via env) ---
REPO_OWNER="${REPO_OWNER:-chetto1983}"
REPO_NAME="${REPO_NAME:-wpt-iot}"
BRANCH="${BRANCH:-master}"
INSTALL_DIR="${INSTALL_DIR:-/opt/wpt-iot}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

RAW_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
ok()    { echo -e "${GREEN}[ OK ]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1" >&2; exit 1; }
step()  { echo ""; echo -e "${CYAN}========== $1 ==========${NC}"; }

# --- Sanity ---
[[ "$(uname -s)" == "Linux" ]] || fail "Linux only."
[[ $EUID -eq 0 ]] || fail "Run as root: curl ... | sudo bash"
command -v curl >/dev/null 2>&1 || fail "curl is required."

LAN_IP="$(hostname -I | awk '{print $1}')"
[[ -n "$LAN_IP" ]] || fail "Could not detect LAN IP via 'hostname -I'."

step "WPT IoT Production Installer"
info "Repo:     ${REPO_OWNER}/${REPO_NAME}@${BRANCH}"
info "Install:  ${INSTALL_DIR}"
info "LAN IP:   ${LAN_IP}"

# =============================================================================
# 1. Install Docker if missing
# =============================================================================
step "Step 1/7  Docker Engine + Compose v2"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "Docker already installed: $(docker --version)"
else
  info "Installing Docker via get.docker.com..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  ok "Docker installed and started."
fi

# =============================================================================
# 2. Stop conflicting host services (legacy mosquitto, grafana on :3000, etc.)
# =============================================================================
step "Step 2/7  Free conflicting host services"

if systemctl is-active --quiet grafana-server 2>/dev/null; then
  warn "Stopping grafana-server (holds :3000)..."
  systemctl stop grafana-server
  systemctl disable grafana-server 2>/dev/null || true
fi

if snap list mosquitto >/dev/null 2>&1; then
  warn "Removing snap mosquitto (will be replaced by container)..."
  snap remove --purge mosquitto
elif systemctl is-active --quiet mosquitto 2>/dev/null; then
  warn "Stopping host mosquitto..."
  systemctl stop mosquitto
  systemctl disable mosquitto 2>/dev/null || true
fi
ok "Host services cleared."

# =============================================================================
# 3. avahi-daemon for wpt.local
# =============================================================================
step "Step 3/7  avahi-daemon (mDNS wpt.local)"

apt-get update -qq
apt-get install -y -qq avahi-daemon avahi-utils libnss-mdns >/dev/null
systemctl enable --now avahi-daemon

# Restrict avahi to the primary LAN interface (skip docker bridges)
PRIMARY_IFACE="$(ip -o -4 route show to default | awk '{print $5}' | head -1)"
[[ -n "$PRIMARY_IFACE" ]] || fail "Could not detect primary network interface."

cat > /etc/avahi/avahi-daemon.conf << AVCONF
[server]
use-ipv4=yes
use-ipv6=no
allow-interfaces=${PRIMARY_IFACE}
ratelimit-interval-usec=1000000
ratelimit-burst=1000

[wide-area]
enable-wide-area=yes

[publish]
publish-hinfo=no
publish-workstation=no
publish-aaaa-on-ipv4=no
publish-a-on-ipv6=no

[reflector]

[rlimits]
rlimit-core=0
rlimit-data=4194304
rlimit-fsize=0
rlimit-nofile=768
rlimit-stack=4194304
rlimit-nproc=3
AVCONF

systemctl restart avahi-daemon

# Publish wpt.local as an alias of this host (separate from system hostname)
cat > /etc/systemd/system/avahi-publish-wpt.service << SVCEOF
[Unit]
Description=Publish wpt.local mDNS alias for WPT IoT
After=avahi-daemon.service network-online.target
Requires=avahi-daemon.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/avahi-publish -a -R wpt.local ${LAN_IP}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable --now avahi-publish-wpt.service
sleep 2
if avahi-resolve -n wpt.local >/dev/null 2>&1; then
  ok "wpt.local resolves to $(avahi-resolve -n wpt.local | awk '{print $2}')"
else
  warn "wpt.local did not resolve immediately — may take a few seconds."
fi

# =============================================================================
# 4. Install dir + compose files (pulled from GitHub raw, NOT the full repo)
# =============================================================================
step "Step 4/7  Compose files from GitHub raw"

mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

curl -fsSL "${RAW_URL}/docker-compose.yml" -o docker-compose.yml
curl -fsSL "${RAW_URL}/docker-compose.prod.yml" -o docker-compose.prod.yml

# Generate the host-networking override locally — NOT pulled from the repo
# because LAN_IP varies per machine. Pin NEXT_PUBLIC_API_URL to wpt.local so
# the baked frontend bundle calls the API same-site (SameSite=Lax cookies).
cat > docker-compose.host.yml << HOSTEOF
# Auto-generated by install-prod.sh — DO NOT EDIT BY HAND.
# Re-run install-prod.sh to regenerate with the current LAN IP.

services:
  backend:
    network_mode: host
    ports: !override []
    environment:
      MQTT_HOST: 127.0.0.1
      PG_HOST: 127.0.0.1
      CORS_ORIGIN: http://wpt.local:3001,http://${LAN_IP}:3001,http://localhost:3001

  frontend:
    environment:
      NEXT_PUBLIC_API_URL: http://wpt.local:3000
HOSTEOF

ok "Compose files in place."

# =============================================================================
# 5. Generate .env with secure defaults if missing
# =============================================================================
step "Step 5/7  .env"

if [[ -f .env ]]; then
  ok ".env already exists — preserving."
else
  if [[ -z "${ADMIN_PASSWORD}" ]]; then
    ADMIN_PASSWORD="$(head -c 16 /dev/urandom | base64 | tr -d '/+=' | head -c 18)"
    info "Generated random ADMIN_PASSWORD (printed at the end)."
  fi
  SESSION_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  PG_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)"

  cat > .env << ENVEOF
# Auto-generated by install-prod.sh
# Regeneration is destructive — back this file up before re-running.

PG_HOST=db
PG_PORT=5432
PG_DB=wpt
PG_USERNAME=wpt
PG_PASSWORD=${PG_PASSWORD}

PORT=3000
HOST=0.0.0.0

UDP_PORT_DATA=9090
UDP_PORT_ALARMS=9091
UDP_PORT_USERS=9092
UDP_PORT_ACK=9093
UDP_ADDRESS=0.0.0.0

SIM_ACK_PORT=9093
SIM_DATA_PORT=9090
SIM_USERS_PORT=9092

SESSION_SECRET=${SESSION_SECRET}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

CORS_ORIGIN=http://wpt.local:3001,http://${LAN_IP}:3001,http://localhost:3001
NEXT_PUBLIC_API_URL=http://wpt.local:3000
ENVEOF
  chmod 600 .env
  ok ".env generated with random secrets."
fi

# =============================================================================
# 6. Bring up the stack from GHCR
# =============================================================================
step "Step 6/7  docker compose pull + up (production)"

docker compose -f docker-compose.yml -f docker-compose.host.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.host.yml -f docker-compose.prod.yml up -d

info "Waiting for backend health..."
for i in {1..30}; do
  if curl -fsS -m 2 "http://127.0.0.1:3000/health" >/dev/null 2>&1; then
    ok "backend /health responds."
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && fail "backend /health did not respond in 60s. Check: docker logs wpt-iot-backend-1"
done

info "Waiting for frontend..."
for i in {1..30}; do
  if curl -fsS -m 2 -o /dev/null "http://127.0.0.1:3001/" 2>/dev/null; then
    ok "frontend / responds."
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && warn "frontend / did not respond in 60s — check: docker logs wpt-iot-frontend-1"
done

# =============================================================================
# 7. Done
# =============================================================================
step "Done"
echo ""
echo -e "${GREEN}=========================================="
echo "  WPT IoT installed and running"
echo -e "==========================================${NC}"
echo ""
echo "  Frontend:    http://wpt.local:3001  (and http://${LAN_IP}:3001)"
echo "  Backend:     http://wpt.local:3000/health"
echo "  Install dir: ${INSTALL_DIR}"
echo ""
if [[ -n "${ADMIN_PASSWORD}" ]]; then
  echo "  ─────────────────────────────────────────"
  echo "  Admin login: admin / ${ADMIN_PASSWORD}"
  echo "  (Save this — it's stored only in ${INSTALL_DIR}/.env)"
  echo "  ─────────────────────────────────────────"
fi
echo ""
echo "Next steps:"
echo "  1. Open http://wpt.local:3001 in a browser (any LAN client with mDNS support)"
echo "  2. Login as admin → /plc → set PLC Address to your ABB AC500 IP → Save"
echo "  3. In CODESYS, set GVL_WPT.sTargetIp := '${LAN_IP}' so the PLC streams here"
echo "  4. Watchtower auto-updates every 5 minutes from GHCR — no manual updates needed"
echo ""
echo "To roll back to a specific image version:"
echo "  cd ${INSTALL_DIR}"
echo "  docker compose -f docker-compose.yml -f docker-compose.host.yml -f docker-compose.prod.yml pull <image>:<sha>"
echo ""
