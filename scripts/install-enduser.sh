#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# WPT IoT — End-User Production Installer (GHCR image pull, no build)
#
# One-command install for a customer edge box (Pilz IndustrialPI 4 / Raspberry
# Pi 4 ARM64, or an amd64 bench host). Unlike install-prod.sh this NEVER builds
# from source: it pulls the prebuilt multi-arch backend/frontend images from
# GHCR and stands up the full stack (db, mosquitto, backend, frontend, nginx)
# behind TLS on https://wpt.local.
#
# Run on the target box:
#   curl -fsSL https://raw.githubusercontent.com/chetto1983/wpt-iot/master/scripts/install-enduser.sh | sudo bash
#
# Prerequisites on the target:
#   - 64-bit Linux (Debian/RPi OS Bookworm, Ubuntu 22.04/24.04). arm64 or amd64.
#   - Internet access to get.docker.com, ghcr.io, raw.githubusercontent.com.
#   - A LAN IP reachable by operator devices.
#
# Pin an immutable image digest instead of :latest by exporting before running:
#   WPT_BACKEND_IMAGE=ghcr.io/chetto1983/wpt-backend@sha256:...
#   WPT_FRONTEND_IMAGE=ghcr.io/chetto1983/wpt-frontend@sha256:...
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
  local file="$1" key="$2" value="$3"
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
    if [[ -n "$current" ]]; then return 0; fi
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

[[ "$(uname -s)" == "Linux" ]] || fail "Linux only."
[[ $EUID -eq 0 ]] || fail "Run as root: curl ... | sudo bash"
command -v curl >/dev/null 2>&1 || fail "curl is required."

ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64|x86_64|amd64) : ;;
  *) fail "Unsupported architecture '${ARCH}'. Need arm64 or amd64." ;;
esac

LAN_IP="$(hostname -I | awk '{print $1}')"
[[ -n "$LAN_IP" ]] || fail "Could not detect LAN IP via 'hostname -I'."

step "WPT IoT End-User Installer (GHCR image pull)"
info "Repo:     ${REPO_OWNER}/${REPO_NAME}@${BRANCH}"
info "Arch:     ${ARCH}"
info "Install:  ${INSTALL_DIR}"
info "LAN IP:   ${LAN_IP}"
info "Backend:  ${WPT_BACKEND_IMAGE:-ghcr.io/${REPO_OWNER}/wpt-backend:latest}"
info "Frontend: ${WPT_FRONTEND_IMAGE:-ghcr.io/${REPO_OWNER}/wpt-frontend:latest}"

step "Step 1/7  Preflight — reachability"
for host in get.docker.com ghcr.io raw.githubusercontent.com; do
  curl -fsS -o /dev/null -m 10 "https://${host}" 2>/dev/null \
    || fail "Cannot reach https://${host}. This installer needs internet (Docker, GHCR images, config files)."
done
ok "Internet reachability confirmed."

step "Step 2/7  Docker Engine + Compose v2"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "Docker already installed: $(docker --version)"
else
  info "Installing Docker via get.docker.com..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  ok "Docker installed and started."
fi

step "Step 3/7  Free conflicting host services"
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

step "Step 4/7  Install dir + runtime files"
apt-get update -qq
apt-get install -y -qq avahi-daemon avahi-utils libnss-mdns openssl >/dev/null

mkdir -p "${INSTALL_DIR}/docker/nginx/templates" \
         "${INSTALL_DIR}/mosquitto/config" \
         "${INSTALL_DIR}/certs" /etc/wpt
cd "${INSTALL_DIR}"

# Device serial — deterministic unique hostname wpt-<serial>.local, used when
# wpt.local collides on a multi-device customer site.
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

# Image-pull compose (saved as docker-compose.yml so `docker compose` finds it
# by default) plus every file it bind-mounts. install-prod.sh could skip the
# db/mosquitto assets because its build context carried them; the image path
# has no source tree, so we fetch them explicitly.
curl -fsSL "${RAW_URL}/docker-compose.ghcr.yml"                       -o docker-compose.yml
curl -fsSL "${RAW_URL}/docker/init-timescaledb.sql"                  -o docker/init-timescaledb.sql
curl -fsSL "${RAW_URL}/docker/nginx/templates/wpt.conf.template"     -o docker/nginx/templates/wpt.conf.template
curl -fsSL "${RAW_URL}/mosquitto/config/mosquitto.conf"             -o mosquitto/config/mosquitto.conf
curl -fsSL "${RAW_URL}/mosquitto/config/dynamic-security.json"      -o mosquitto/config/dynamic-security.json
curl -fsSL "${RAW_URL}/scripts/generate-local-tls.sh"               -o generate-local-tls.sh
curl -fsSL "${RAW_URL}/scripts/wpt-local-alias.sh"                  -o wpt-local-alias.sh
chmod +x generate-local-tls.sh wpt-local-alias.sh
ok "Compose file, DB/mosquitto/nginx assets, and helpers downloaded."

step "Step 5/7  avahi-daemon (mDNS aliases)"
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

step "Step 6/7  .env + TLS certificates"
if [[ ! -f .env ]]; then
  if [[ -z "${ADMIN_PASSWORD}" ]]; then
    ADMIN_PASSWORD="$(head -c 16 /dev/urandom | base64 | tr -d '/+=' | head -c 18)"
    info "Generated random ADMIN_PASSWORD (printed at the end)."
  fi
  SESSION_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  PG_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)"
  # AES-256-GCM key: full base64 of 32 random bytes (decodes to exactly 32 bytes).
  SECRETS_ENCRYPTION_KEY="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"

  cat > .env <<ENVEOF
# --- image pins (override :latest with an immutable @sha256 digest to freeze a release) ---
WPT_BACKEND_IMAGE=${WPT_BACKEND_IMAGE:-ghcr.io/${REPO_OWNER}/wpt-backend:latest}
WPT_FRONTEND_IMAGE=${WPT_FRONTEND_IMAGE:-ghcr.io/${REPO_OWNER}/wpt-frontend:latest}
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
# --- PostgreSQL tuning: defaults are bench-safe (small). On an 8 GB Pilz/Pi 4,
#     uncomment for headroom (see scripts/RUNBOOK.md "PG tuning"): ---
#PG_SHARED_BUFFERS=2GB
#PG_WORK_MEM=16MB
#PG_EFFECTIVE_CACHE_SIZE=5GB
#PG_MAINTENANCE_WORK_MEM=512MB
#PG_SYNCHRONOUS_COMMIT=off
# MQTT/Sparkplug config is DB-backed (mqtt_config table, admin UI), not env.
ENVEOF
  chmod 600 .env
  ok ".env generated with random secrets."
else
  sed -i -e '/^CORS_ORIGIN=/d' .env || true
  upsert_env .env "NEXT_PUBLIC_API_URL" ""
  upsert_env .env "SESSION_COOKIE_SECURE" "true"
  upsert_env .env "TRUST_PROXY" "true"
  upsert_env .env "WPT_BACKEND_IMAGE" "${WPT_BACKEND_IMAGE:-ghcr.io/${REPO_OWNER}/wpt-backend:latest}"
  upsert_env .env "WPT_FRONTEND_IMAGE" "${WPT_FRONTEND_IMAGE:-ghcr.io/${REPO_OWNER}/wpt-frontend:latest}"
  ensure_env_secret .env "SECRETS_ENCRYPTION_KEY" "$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
  ok ".env preserved and updated for same-origin HTTPS."
fi

bash ./generate-local-tls.sh ./certs
ok "TLS assets ready in ${INSTALL_DIR}/certs (auto-detected NICs)."

cat > /etc/default/wpt-iot <<DEFEOF
INSTALL_DIR=${INSTALL_DIR}
DEFEOF
chmod 644 /etc/default/wpt-iot
curl -fsSL "${RAW_URL}/scripts/wpt-tls-refresh.service" -o /etc/systemd/system/wpt-tls-refresh.service
curl -fsSL "${RAW_URL}/scripts/wpt-tls-refresh.timer"   -o /etc/systemd/system/wpt-tls-refresh.timer
systemctl daemon-reload
systemctl enable --now wpt-tls-refresh.timer
ok "wpt-tls-refresh timer enabled (boot + every 15 min)."

step "Step 7/7  Pull images + start stack"
docker compose pull
docker compose up -d

info "Waiting for backend /api/health..."
for i in {1..45}; do
  if curl -fsS -m 2 "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
    ok "backend /api/health responds."; break
  fi
  sleep 2
  [[ $i -eq 45 ]] && fail "backend /api/health did not respond in 90s. Check: docker compose logs backend"
done

info "Waiting for nginx /nginx-health..."
for i in {1..30}; do
  if curl -fsS -m 2 "http://127.0.0.1/nginx-health" >/dev/null 2>&1; then
    ok "nginx /nginx-health responds."; break
  fi
  sleep 2
  [[ $i -eq 30 ]] && fail "nginx /nginx-health did not respond in 60s. Check: docker compose logs nginx"
done

info "Waiting for HTTPS frontend..."
for i in {1..30}; do
  if curl --silent --show-error --fail --cacert "${INSTALL_DIR}/certs/wpt-local-ca.crt" --resolve wpt.local:443:127.0.0.1 "https://wpt.local/" >/dev/null 2>&1; then
    ok "HTTPS frontend responds."; break
  fi
  sleep 2
  [[ $i -eq 30 ]] && warn "HTTPS frontend not confirmed in 60s (frontend may still be warming). Check: docker compose ps"
done

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
echo "  3. Login as admin, then set the PLC Address and Byte Order (BE/LE) under /plc."
echo "  4. In CODESYS, set GVL_WPT.sTargetIp := '${LAN_IP}' so the PLC streams here."
echo ""
