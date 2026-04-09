#!/usr/bin/env bash
# =============================================================================
# WPT IoT — Offline Installer (air-gapped edge PC)
# =============================================================================
# Run this on a fresh Ubuntu 22.04 / 24.04 edge PC that:
#   1. Has Docker Engine + Compose v2 already installed (one-time prereq —
#      bundle Docker .deb packages alongside this if your edge PCs don't ship
#      with Docker. Pilz IndustrialPI 4 ships with Docker by default.)
#   2. Has NO outbound internet access
#   3. Has the bundle directory extracted in the current working directory
#
# What it does, in order:
#   1. Verifies bundle integrity via SHA256SUMS
#   2. Loads the 4 Docker images via `docker load`
#   3. Stops conflicting host services (snap mosquitto, grafana, etc.)
#   4. Sets up avahi-daemon + wpt.local mDNS alias
#   5. Creates /opt/wpt-iot, copies compose + db init + mosquitto config
#   6. Generates docker-compose.host.yml with the LAN IP baked in
#   7. Generates .env with random secrets (or uses ADMIN_PASSWORD env override)
#   8. Brings up the stack
#   9. Health-checks backend /health and frontend /
#  10. Prints the admin password and the LAN URLs
#
# Re-running is safe — every step checks current state before acting.
# If .env already exists it is preserved (back it up before re-running if
# you want fresh secrets).
# =============================================================================

set -euo pipefail

# --- Config ---
INSTALL_DIR="${INSTALL_DIR:-/opt/wpt-iot}"
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
step() { echo -e "\n${BLUE}==>${NC} $1"; }
ok()   { echo -e "  ${GREEN}OK${NC} $1"; }
info() { echo -e "  ${YELLOW}··${NC} $1"; }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; }
fail() { echo -e "  ${RED}!!${NC} $1" >&2; exit 1; }

# --- Sanity ---
[[ $EUID -eq 0 ]] || fail "Must run as root (sudo bash install-offline.sh)."
[[ -f "${BUNDLE_DIR}/VERSION" ]] || fail "VERSION file not found — are you in the bundle directory?"
[[ -f "${BUNDLE_DIR}/docker-compose.yml" ]] || fail "docker-compose.yml not found in bundle."
[[ -d "${BUNDLE_DIR}/images" ]] || fail "images/ directory not found in bundle."
command -v docker >/dev/null 2>&1 || fail "docker not in PATH — install Docker Engine first (one-time prereq)."
docker compose version >/dev/null 2>&1 || fail "docker compose v2 not available."

LAN_IP="$(hostname -I | awk '{print $1}')"
[[ -n "${LAN_IP}" ]] || fail "Could not detect LAN IP via hostname -I."

step "Bundle: $(grep '^git_sha:' "${BUNDLE_DIR}/VERSION" | awk '{print $2}')"
info "Built at: $(grep '^built_at:' "${BUNDLE_DIR}/VERSION" | awk '{print $2}')"
info "Edge PC LAN IP: ${LAN_IP}"
info "Install dir: ${INSTALL_DIR}"

# =============================================================================
# 1. Verify bundle integrity
# =============================================================================
step "Step 1/10  Verify bundle integrity"

if [[ -f "${BUNDLE_DIR}/SHA256SUMS" ]]; then
  if ( cd "${BUNDLE_DIR}" && sha256sum -c --quiet --ignore-missing SHA256SUMS ); then
    ok "All files match SHA256SUMS."
  else
    fail "SHA256SUMS verification failed — bundle is corrupted or tampered with."
  fi
else
  warn "SHA256SUMS not found — skipping integrity check."
fi

# =============================================================================
# 2. Load Docker images
# =============================================================================
step "Step 2/10  Load Docker images (~60 s)"

for img in db mosquitto backend frontend; do
  if [[ ! -f "${BUNDLE_DIR}/images/${img}.tar.gz" ]]; then
    fail "Missing image tarball: images/${img}.tar.gz"
  fi
  info "Loading ${img}..."
  gunzip -c "${BUNDLE_DIR}/images/${img}.tar.gz" | docker load >/dev/null
done
ok "All 4 images loaded."

# =============================================================================
# 3. Stop conflicting host services
# =============================================================================
step "Step 3/10  Free conflicting ports"

# snap mosquitto grabs :1883
if systemctl list-unit-files 2>/dev/null | grep -q '^snap.mosquitto'; then
  info "Disabling snap mosquitto..."
  snap stop mosquitto 2>/dev/null || true
  snap disable mosquitto 2>/dev/null || true
fi

# grafana grabs :3000
if systemctl is-enabled grafana-server >/dev/null 2>&1; then
  info "Disabling grafana-server (was holding :3000)..."
  systemctl disable --now grafana-server 2>/dev/null || true
fi

ok "Conflicting host services stopped."

# =============================================================================
# 4. avahi-daemon + wpt.local mDNS alias
# =============================================================================
step "Step 4/10  avahi-daemon + wpt.local mDNS"

if ! command -v avahi-daemon >/dev/null 2>&1; then
  warn "avahi-daemon not installed. Install offline with:"
  warn "  sudo dpkg -i avahi-daemon_*.deb avahi-utils_*.deb libavahi-*.deb"
  warn "Skipping mDNS alias setup — frontend will only be reachable via raw LAN IP."
else
  systemctl enable --now avahi-daemon >/dev/null 2>&1 || true

  install -m 0755 "${BUNDLE_DIR}/wpt-local-alias.sh" /usr/local/sbin/wpt-local-alias.sh

  cat > /etc/systemd/system/wpt-local-alias.service <<UNITEOF
[Unit]
Description=Publish wpt.local as an mDNS alias of this host
After=avahi-daemon.service network-online.target
Requires=avahi-daemon.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/sbin/wpt-local-alias.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNITEOF

  systemctl daemon-reload
  systemctl enable --now wpt-local-alias.service >/dev/null 2>&1
  sleep 1
  if avahi-resolve-host-name wpt.local 2>/dev/null | grep -q "${LAN_IP}"; then
    ok "wpt.local resolves to ${LAN_IP}"
  else
    warn "wpt.local resolution unconfirmed — check: systemctl status wpt-local-alias.service"
  fi
fi

# =============================================================================
# 5. Install dir + copy compose files
# =============================================================================
step "Step 5/10  Install dir ${INSTALL_DIR}"

mkdir -p "${INSTALL_DIR}/docker" "${INSTALL_DIR}/mosquitto/config"
cp "${BUNDLE_DIR}/docker-compose.yml" "${INSTALL_DIR}/"
cp "${BUNDLE_DIR}/docker/init-timescaledb.sql" "${INSTALL_DIR}/docker/"
cp -r "${BUNDLE_DIR}/mosquitto/config/." "${INSTALL_DIR}/mosquitto/config/"
ok "Compose + DB init + mosquitto config copied."

# =============================================================================
# 6. Generate docker-compose.host.yml with LAN IP
# =============================================================================
step "Step 6/10  docker-compose.host.yml (LAN_IP=${LAN_IP})"

cat > "${INSTALL_DIR}/docker-compose.host.yml" <<HOSTEOF
# Auto-generated by install-offline.sh
# Re-run install-offline.sh to regenerate with the current LAN IP.
#
# Layers on top of the base docker-compose.yml to:
#   - Put backend in network_mode: host (REQUIRED for real PLC UDP frames)
#   - Allow CORS from wpt.local + LAN IP + localhost
#   - Pin NEXT_PUBLIC_API_URL to the bundle build value (already baked into image)
services:
  backend:
    network_mode: host
    ports: !override []
    environment:
      MQTT_HOST: 127.0.0.1
      PG_HOST: 127.0.0.1
      CORS_ORIGIN: http://wpt.local:3001,http://${LAN_IP}:3001,http://localhost:3001
HOSTEOF
ok "host overlay generated."

# =============================================================================
# 7. Generate .env with secure defaults if missing
# =============================================================================
step "Step 7/10  .env"

if [[ -f "${INSTALL_DIR}/.env" ]]; then
  ok ".env already exists — preserving."
  ADMIN_PASSWORD="(unchanged — see ${INSTALL_DIR}/.env)"
else
  if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
    ADMIN_PASSWORD="$(head -c 16 /dev/urandom | base64 | tr -d '/+=' | head -c 18)"
    info "Generated random ADMIN_PASSWORD (printed at the end)."
  fi
  SESSION_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  PG_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)"

  cat > "${INSTALL_DIR}/.env" <<ENVEOF
# Auto-generated by install-offline.sh
# Regeneration is destructive — back this file up before re-running.

PG_HOST=127.0.0.1
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

MQTT_HOST=127.0.0.1
MQTT_PORT=1883
MQTT_USERNAME=wpt-backend
MQTT_PASSWORD=wpt_mqtt_dev_password
MQTT_ENABLED=true
MQTT_SITE_ID=site-01
MQTT_MACHINE_ID=wpt40-001
ENVEOF
  chmod 600 "${INSTALL_DIR}/.env"
  ok ".env generated with random secrets."
fi

# =============================================================================
# 8. Bring up the stack
# =============================================================================
step "Step 8/10  docker compose up -d"

cd "${INSTALL_DIR}"
docker compose -f docker-compose.yml -f docker-compose.host.yml up -d

# =============================================================================
# 9. Health checks
# =============================================================================
step "Step 9/10  Health checks"

info "Waiting for backend /health..."
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
# 10. Done
# =============================================================================
step "Step 10/10  Done"
echo ""
echo -e "${GREEN}=========================================="
echo "  WPT IoT installed and running"
echo -e "==========================================${NC}"
echo ""
echo "  Frontend:    http://wpt.local:3001  (and http://${LAN_IP}:3001)"
echo "  Backend:     http://wpt.local:3000/health"
echo "  Install dir: ${INSTALL_DIR}"
echo ""
if [[ "${ADMIN_PASSWORD}" != "(unchanged"* ]]; then
  echo "  ─────────────────────────────────────────"
  echo "  Admin login: admin / ${ADMIN_PASSWORD}"
  echo "  (Save this — it's stored only in ${INSTALL_DIR}/.env)"
  echo "  ─────────────────────────────────────────"
fi
echo ""
echo "Next steps:"
echo "  1. Open http://wpt.local:3001 in a LAN browser (Bonjour/avahi for mDNS)"
echo "  2. Login as admin → /plc → set PLC Address to your ABB AC500 IP → Save"
echo "  3. In CODESYS, set GVL_WPT.sTargetIp := '${LAN_IP}' so PLC streams here"
echo ""
echo "To check status later:"
echo "  cd ${INSTALL_DIR}"
echo "  docker compose -f docker-compose.yml -f docker-compose.host.yml ps"
echo "  docker compose -f docker-compose.yml -f docker-compose.host.yml logs -f backend"
echo ""
echo "To update later: ship a new bundle and re-run install-offline.sh."
echo "  - .env is preserved (DB password + admin password kept)"
echo "  - pgdata + uploads volumes are preserved (machine history + RFID users kept)"
echo "  - Images are reloaded from the new bundle"
echo "  - Containers are recreated with the new images"
echo ""
