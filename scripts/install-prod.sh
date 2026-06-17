#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# WPT IoT - Production Bootstrap Installer
# =============================================================================

REPO_OWNER="${REPO_OWNER:-chetto1983}"
REPO_NAME="${REPO_NAME:-wpt-iot}"
BRANCH="${BRANCH:-master}"
INSTALL_DIR="${INSTALL_DIR:-/opt/wpt-iot}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

RAW_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}"

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

# Set KEY only if missing or empty; NEVER overwrite an existing non-empty value.
# SECRETS_ENCRYPTION_KEY must stay identical across reboots — rotating it makes
# already-encrypted secrets (e.g. mqtt_config.password) unrecoverable.
ensure_env_secret() {
  local file="$1" key="$2" value="$3" current
  if grep -q "^${key}=" "$file"; then
    current="$(grep -m1 "^${key}=" "$file" | cut -d= -f2-)"
    if [[ -n "$current" ]]; then
      return 0
    fi
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

[[ "$(uname -s)" == "Linux" ]] || fail "Linux only."
[[ $EUID -eq 0 ]] || fail "Run as root: curl ... | sudo bash"
command -v curl >/dev/null 2>&1 || fail "curl is required."

LAN_IP="$(hostname -I | awk '{print $1}')"
[[ -n "$LAN_IP" ]] || fail "Could not detect LAN IP via 'hostname -I'."

step "WPT IoT Production Installer"
info "Repo:     ${REPO_OWNER}/${REPO_NAME}@${BRANCH}"
info "Install:  ${INSTALL_DIR}"
info "LAN IP:   ${LAN_IP}"
info "Frontend: https://wpt.local"
info "API:      https://wpt.local/api"

step "Step 1/7  Docker Engine + Compose v2"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "Docker already installed: $(docker --version)"
else
  info "Installing Docker via get.docker.com..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  ok "Docker installed and started."
fi

step "Step 2/7  Free conflicting host services"

if systemctl is-active --quiet grafana-server 2>/dev/null; then
  warn "Stopping grafana-server (holds :3000)..."
  systemctl stop grafana-server
  systemctl disable grafana-server 2>/dev/null || true
fi

if snap list mosquitto >/dev/null 2>&1; then
  warn "Removing snap mosquitto..."
  snap remove --purge mosquitto
elif systemctl is-active --quiet mosquitto 2>/dev/null; then
  warn "Stopping host mosquitto..."
  systemctl stop mosquitto
  systemctl disable mosquitto 2>/dev/null || true
fi
ok "Host services cleared."

step "Step 3/7  Install dir + runtime files"

apt-get update -qq
apt-get install -y -qq avahi-daemon avahi-utils libnss-mdns openssl >/dev/null

mkdir -p "${INSTALL_DIR}/docker/nginx/templates" "${INSTALL_DIR}/certs" /etc/wpt
cd "${INSTALL_DIR}"

# Device serial — baked at manufacturing when possible, otherwise
# derived from /etc/machine-id so every box has a deterministic unique
# hostname like wpt-ab12cd34.local. This is what clients type in the
# browser when wpt.local collides on a multi-device customer site.
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
ok "Device serial: ${SERIAL} (wpt-${SERIAL}.local)"

curl -fsSL "${RAW_URL}/docker-compose.yml" -o docker-compose.yml
curl -fsSL "${RAW_URL}/docker/nginx/templates/wpt.conf.template" -o docker/nginx/templates/wpt.conf.template
curl -fsSL "${RAW_URL}/scripts/generate-local-tls.sh" -o generate-local-tls.sh
curl -fsSL "${RAW_URL}/scripts/wpt-local-alias.sh" -o wpt-local-alias.sh
chmod +x generate-local-tls.sh wpt-local-alias.sh

ok "Compose file and helpers downloaded."

step "Step 4/7  avahi-daemon (mDNS aliases)"

systemctl enable --now avahi-daemon
install -m 0755 "${INSTALL_DIR}/wpt-local-alias.sh" /usr/local/sbin/wpt-local-alias.sh

cat > /etc/systemd/system/wpt-local-alias.service <<'UNITEOF'
[Unit]
Description=Publish wpt.local mDNS alias for WPT IoT
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
systemctl enable --now wpt-local-alias.service
sleep 2
if avahi-resolve -n wpt.local >/dev/null 2>&1; then
  ok "wpt.local resolves to $(avahi-resolve -n wpt.local | awk '{print $2}')"
else
  warn "wpt.local did not resolve immediately. mDNS may need a few seconds."
fi

step "Step 5/7  .env + TLS certificates"

if [[ ! -f .env ]]; then
  if [[ -z "${ADMIN_PASSWORD}" ]]; then
    ADMIN_PASSWORD="$(head -c 16 /dev/urandom | base64 | tr -d '/+=' | head -c 18)"
    info "Generated random ADMIN_PASSWORD (printed at the end)."
  fi
  SESSION_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  PG_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)"
  # AES-256-GCM key for secrets at rest (mqtt_config.password). Full base64 of
  # 32 random bytes — must decode to exactly 32 bytes (see secretCipher.ts).
  # Do NOT reuse the SESSION_SECRET pattern: that truncates to 32 chars, which
  # decodes to ~24 bytes and the backend rejects it.
  SECRETS_ENCRYPTION_KEY="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"

  cat > .env <<ENVEOF
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
SECRETS_ENCRYPTION_KEY=${SECRETS_ENCRYPTION_KEY}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
NEXT_PUBLIC_API_URL=
SESSION_COOKIE_SECURE=true
TRUST_PROXY=true
# MQTT/Sparkplug config is DB-backed (mqtt_config table, set via the admin UI),
# not env-driven. See apps/backend/src/config.ts.
ENVEOF
  chmod 600 .env
  ok ".env generated with random secrets."
else
  # Phase 37.3: CORS_ORIGIN retired (same-origin via nginx). Empty
  # NEXT_PUBLIC_API_URL = relative URLs.
  sed -i -e '/^CORS_ORIGIN=/d' .env || true
  upsert_env .env "NEXT_PUBLIC_API_URL" ""
  upsert_env .env "SESSION_COOKIE_SECURE" "true"
  upsert_env .env "TRUST_PROXY" "true"
  # Backfill the encryption key on installs that predate it. Generate only if
  # missing/empty — preserve any existing key so encrypted secrets stay readable.
  ensure_env_secret .env "SECRETS_ENCRYPTION_KEY" "$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
  ok ".env preserved and updated for same-origin HTTPS."
fi

bash ./generate-local-tls.sh ./certs
ok "TLS assets ready in ${INSTALL_DIR}/certs (auto-detected NICs)."

# Install systemd unit + timer that re-runs generate-local-tls on every
# boot and every 15 min. If the cert SAN drifts (customer changes LAN,
# DHCP renews with a new IP, a NIC is added), the unit regenerates the
# server cert and restarts nginx. Zero operator intervention.
# /etc/default/wpt-iot carries INSTALL_DIR so the unit works with custom
# install paths without editing the unit file.
cat > /etc/default/wpt-iot <<DEFEOF
INSTALL_DIR=${INSTALL_DIR}
DEFEOF
chmod 644 /etc/default/wpt-iot
curl -fsSL "${RAW_URL}/scripts/wpt-tls-refresh.service" -o /etc/systemd/system/wpt-tls-refresh.service
curl -fsSL "${RAW_URL}/scripts/wpt-tls-refresh.timer" -o /etc/systemd/system/wpt-tls-refresh.timer
systemctl daemon-reload
systemctl enable --now wpt-tls-refresh.timer
ok "wpt-tls-refresh timer enabled (boot + every 15 min)."

step "Step 6/7  docker compose up"

docker compose up -d --build

info "Waiting for backend /health..."
for i in {1..30}; do
  if curl -fsS -m 2 "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
    ok "backend /api/health responds."
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && fail "backend /health did not respond in 60s."
done

info "Waiting for nginx /nginx-health..."
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

step "Step 7/7  Done"
echo ""
echo -e "${GREEN}=========================================="
echo "  WPT IoT installed and running"
echo -e "==========================================${NC}"
echo ""
echo "  Frontend:    https://wpt.local"
echo "  API:         https://wpt.local/api/health"
echo "  Local CA:    ${INSTALL_DIR}/certs/wpt-local-ca.crt"
echo "  CA download: https://wpt.local/setup/wpt-local-ca.crt"
echo "  Install dir: ${INSTALL_DIR}"
echo ""
if [[ -n "${ADMIN_PASSWORD}" ]]; then
  echo "  Admin login: admin / ${ADMIN_PASSWORD}"
fi
echo ""
echo "Next steps:"
echo "  1. On each client device, open https://wpt.local and download the CA from /setup/wpt-local-ca.crt."
echo "  2. Trust ${INSTALL_DIR}/certs/wpt-local-ca.crt on the client device."
echo "  3. Reopen the browser and verify https://wpt.local loads without certificate warnings."
echo "  4. Login as admin and set the PLC Address under /plc."
echo "  5. In CODESYS, set GVL_WPT.sTargetIp := '${LAN_IP}' so the PLC streams here."
echo ""
