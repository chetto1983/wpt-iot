#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# WPT IoT - Offline Installer (air-gapped edge PC)
# =============================================================================

INSTALL_DIR="${INSTALL_DIR:-/opt/wpt-iot}"
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
step() { echo -e "\n${BLUE}==>${NC} $1"; }
ok()   { echo -e "  ${GREEN}OK${NC} $1"; }
info() { echo -e "  ${YELLOW}..${NC} $1"; }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; }
fail() { echo -e "  ${RED}!!${NC} $1" >&2; exit 1; }

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

[[ $EUID -eq 0 ]] || fail "Must run as root (sudo bash install.sh)."
[[ -f "${BUNDLE_DIR}/VERSION" ]] || fail "VERSION file not found."
[[ -f "${BUNDLE_DIR}/docker-compose.yml" ]] || fail "docker-compose.yml not found in bundle."
[[ -d "${BUNDLE_DIR}/images" ]] || fail "images/ directory not found in bundle."
[[ -f "${BUNDLE_DIR}/generate-local-tls.sh" ]] || fail "generate-local-tls.sh not found in bundle."
command -v docker >/dev/null 2>&1 || fail "docker not in PATH."
docker compose version >/dev/null 2>&1 || fail "docker compose v2 not available."
command -v openssl >/dev/null 2>&1 || fail "openssl not in PATH."

LAN_IP="$(hostname -I | awk '{print $1}')"
[[ -n "${LAN_IP}" ]] || fail "Could not detect LAN IP via hostname -I."

step "Bundle: $(grep '^git_sha:' "${BUNDLE_DIR}/VERSION" | awk '{print $2}')"
info "Built at: $(grep '^built_at:' "${BUNDLE_DIR}/VERSION" | awk '{print $2}')"
info "Edge PC LAN IP: ${LAN_IP}"
info "Install dir: ${INSTALL_DIR}"

step "Step 1/10  Verify bundle integrity"

if [[ -f "${BUNDLE_DIR}/SHA256SUMS" ]]; then
  if ( cd "${BUNDLE_DIR}" && sha256sum -c --quiet --ignore-missing SHA256SUMS ); then
    ok "All files match SHA256SUMS."
  else
    fail "SHA256SUMS verification failed."
  fi
else
  warn "SHA256SUMS not found - skipping integrity check."
fi

step "Step 2/10  Load Docker images"

for img in db mosquitto backend frontend nginx; do
  [[ -f "${BUNDLE_DIR}/images/${img}.tar.gz" ]] || fail "Missing image tarball: images/${img}.tar.gz"
  info "Loading ${img}..."
  gunzip -c "${BUNDLE_DIR}/images/${img}.tar.gz" | docker load >/dev/null
done
ok "All images loaded."

step "Step 3/10  Free conflicting ports"

if systemctl list-unit-files 2>/dev/null | grep -q '^snap.mosquitto'; then
  info "Disabling snap mosquitto..."
  snap stop mosquitto 2>/dev/null || true
  snap disable mosquitto 2>/dev/null || true
fi

if systemctl is-enabled grafana-server >/dev/null 2>&1; then
  info "Disabling grafana-server (was holding :3000)..."
  systemctl disable --now grafana-server 2>/dev/null || true
fi
ok "Conflicting host services stopped."

step "Step 4/10  avahi-daemon + mDNS aliases"

# Device serial — baked at manufacturing if possible, else derived from
# /etc/machine-id. Drives wpt-<serial>.local mDNS + the cert DNS SAN.
mkdir -p /etc/wpt
if [[ ! -s /etc/wpt/serial ]]; then
  if [[ -n "${WPT_SERIAL:-}" ]]; then
    echo -n "${WPT_SERIAL}" > /etc/wpt/serial
  elif [[ -r /etc/machine-id ]]; then
    head -c 8 /etc/machine-id > /etc/wpt/serial
  else
    hostname | tr -dc 'a-z0-9' | head -c 8 > /etc/wpt/serial
  fi
  chmod 644 /etc/wpt/serial
fi
SERIAL="$(tr -d '\n\r \t' < /etc/wpt/serial)"
info "Device serial: ${SERIAL} (wpt-${SERIAL}.local)"

if ! command -v avahi-publish >/dev/null 2>&1; then
  warn "avahi-daemon/avahi-utils not installed. HTTPS will still work by IP override, but mDNS aliases will be missing."
else
  systemctl enable --now avahi-daemon >/dev/null 2>&1 || true
  install -m 0755 "${BUNDLE_DIR}/wpt-local-alias.sh" /usr/local/sbin/wpt-local-alias.sh

  cat > /etc/systemd/system/wpt-local-alias.service <<'UNITEOF'
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
    warn "wpt.local resolution unconfirmed - check systemctl status wpt-local-alias.service"
  fi
fi

step "Step 5/8  Install dir ${INSTALL_DIR}"

mkdir -p "${INSTALL_DIR}/docker/nginx/templates" "${INSTALL_DIR}/mosquitto/config" "${INSTALL_DIR}/certs"
cp "${BUNDLE_DIR}/docker-compose.yml" "${INSTALL_DIR}/"
cp "${BUNDLE_DIR}/docker/init-timescaledb.sql" "${INSTALL_DIR}/docker/"
cp "${BUNDLE_DIR}/docker/nginx/templates/wpt.conf.template" "${INSTALL_DIR}/docker/nginx/templates/"
cp -r "${BUNDLE_DIR}/mosquitto/config/." "${INSTALL_DIR}/mosquitto/config/"
cp "${BUNDLE_DIR}/generate-local-tls.sh" "${INSTALL_DIR}/"
chmod +x "${INSTALL_DIR}/generate-local-tls.sh"
ok "Compose, nginx template, DB init, and helpers copied."

step "Step 6/8  .env"

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
    ADMIN_PASSWORD="$(head -c 16 /dev/urandom | base64 | tr -d '/+=' | head -c 18)"
    info "Generated random ADMIN_PASSWORD (printed at the end)."
  fi
  SESSION_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  PG_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)"

  cat > "${INSTALL_DIR}/.env" <<ENVEOF
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
NEXT_PUBLIC_API_URL=
SESSION_COOKIE_SECURE=true
TRUST_PROXY=true
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
else
  # Phase 37.3: CORS_ORIGIN no longer used (same-origin via nginx).
  # NEXT_PUBLIC_API_URL defaults empty so the frontend uses relative URLs.
  sed -i -e '/^CORS_ORIGIN=/d' "${INSTALL_DIR}/.env" || true
  upsert_env "${INSTALL_DIR}/.env" "NEXT_PUBLIC_API_URL" ""
  upsert_env "${INSTALL_DIR}/.env" "SESSION_COOKIE_SECURE" "true"
  upsert_env "${INSTALL_DIR}/.env" "TRUST_PROXY" "true"
  ok ".env preserved and updated for same-origin HTTPS."
fi

step "Step 7/8  Generate local TLS certificates"

( cd "${INSTALL_DIR}" && bash ./generate-local-tls.sh ./certs )
ok "TLS assets ready in ${INSTALL_DIR}/certs (auto-detected NICs)."

# Zero-maintenance TLS refresh: systemd timer re-runs the generator at
# boot and every 15 min. Cert SAN stays in sync with current LAN IPs
# without operator intervention.
if [[ -f "${BUNDLE_DIR}/wpt-tls-refresh.service" && -f "${BUNDLE_DIR}/wpt-tls-refresh.timer" ]]; then
  install -m 0644 "${BUNDLE_DIR}/wpt-tls-refresh.service" /etc/systemd/system/wpt-tls-refresh.service
  install -m 0644 "${BUNDLE_DIR}/wpt-tls-refresh.timer"   /etc/systemd/system/wpt-tls-refresh.timer
  systemctl daemon-reload
  systemctl enable --now wpt-tls-refresh.timer
  ok "wpt-tls-refresh timer enabled (boot + every 15 min)."
else
  warn "wpt-tls-refresh service units missing from bundle — skipping auto-refresh install."
fi

step "Step 8/8  docker compose up -d + health checks"

cd "${INSTALL_DIR}"
docker compose up -d

info "Waiting for backend /health..."
for i in {1..30}; do
  if curl -fsS -m 2 "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
    ok "backend /api/health responds."
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && fail "backend /health did not respond in 60s."
done

info "Waiting for nginx health..."
for i in {1..30}; do
  if curl -fsS -m 2 "http://127.0.0.1/nginx-health" >/dev/null 2>&1; then
    ok "nginx /nginx-health responds."
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && fail "nginx /nginx-health did not respond in 60s."
done

info "Waiting for HTTPS frontend..."
for i in {1..30}; do
  if curl --silent --show-error --fail --cacert "${INSTALL_DIR}/certs/wpt-local-ca.crt" --resolve wpt.local:443:127.0.0.1 "https://wpt.local/" >/dev/null 2>&1; then
    ok "HTTPS frontend responds."
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && fail "HTTPS frontend did not respond in 60s."
done

echo ""
echo -e "${GREEN}=========================================="
echo "  WPT IoT installed and running"
echo -e "==========================================${NC}"
echo ""
echo "  Frontend:    https://wpt.local"
echo "  API:         https://wpt.local/api/health"
echo "  Local CA:    ${INSTALL_DIR}/certs/wpt-local-ca.crt"
echo "  Install dir: ${INSTALL_DIR}"
echo ""
if [[ -n "${ADMIN_PASSWORD:-}" ]]; then
  echo "  Admin login: admin / ${ADMIN_PASSWORD}"
fi
echo ""
echo "Next steps:"
echo "  1. Trust ${INSTALL_DIR}/certs/wpt-local-ca.crt on the client devices."
echo "  2. Open https://wpt.local in a LAN browser."
echo "  3. In CODESYS, set GVL_WPT.sTargetIp := '${LAN_IP}' so the PLC streams here."
echo ""
