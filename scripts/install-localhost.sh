#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# WPT IoT - Localhost Install Script
# =============================================================================
# Use this when the browser runs on the same machine as the stack.
# Browsers treat http://localhost as a secure context for service workers,
# so this avoids certificate warnings while keeping PWA features available.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
ok()    { echo -e "${GREEN}[ OK ]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }
step()  { echo ""; echo -e "${CYAN}========== $1 ==========${NC}"; }

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

[[ "$(uname -s)" == "Linux" ]] || fail "This script targets Linux only."
[[ $EUID -ne 0 ]] || fail "Do not run as root. Run as your normal user."
command -v docker >/dev/null 2>&1 || fail "Docker not installed."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 not available."
[[ -f docker-compose.yml ]] || fail "docker-compose.yml not found."
[[ -f docker-compose.localhost.yml ]] || fail "docker-compose.localhost.yml not found."

step "WPT IoT Localhost Installer"
info "Project dir: $PROJECT_DIR"
info "Frontend URL: http://localhost"
info "API URL: http://localhost/api"
info "Backend UDP path: host networking"

step "Step 1/6  Stop conflicting host services"

if systemctl is-active --quiet grafana-server 2>/dev/null; then
  warn "Found grafana-server bound on :3000 - stopping it."
  sudo systemctl stop grafana-server
  sudo systemctl disable grafana-server 2>/dev/null || true
fi

if snap list mosquitto >/dev/null 2>&1; then
  warn "Found snap mosquitto - removing it."
  sudo snap remove --purge mosquitto
elif systemctl is-active --quiet mosquitto 2>/dev/null; then
  warn "Found systemd mosquitto - stopping it."
  sudo systemctl stop mosquitto
  sudo systemctl disable mosquitto 2>/dev/null || true
fi
ok "Conflicting host services handled."

step "Step 2/6  Configure .env"

if [[ ! -f .env ]]; then
  [[ -f .env.example ]] || fail "No .env and no .env.example to copy from."
  cp .env.example .env
  info "Created .env from .env.example."
fi

upsert_env "CORS_ORIGIN" "http://localhost,http://127.0.0.1,http://localhost:80,http://127.0.0.1:80"
upsert_env "NEXT_PUBLIC_API_URL" "http://localhost/api"
upsert_env "SESSION_COOKIE_SECURE" "false"
upsert_env "TRUST_PROXY" "true"
ok ".env updated for localhost PWA mode."

step "Step 3/6  Generate docker-compose.host.yml"

cat > docker-compose.host.yml <<'EOF'
services:
  backend:
    network_mode: host
    ports: !override []
    environment:
      MQTT_HOST: 127.0.0.1
      PG_HOST: 127.0.0.1
      CORS_ORIGIN: http://localhost,http://127.0.0.1,http://localhost:80,http://127.0.0.1:80
      SESSION_COOKIE_SECURE: "false"
      TRUST_PROXY: "true"

  frontend:
    build:
      args:
        NEXT_PUBLIC_API_URL: http://localhost/api
    environment:
      NEXT_PUBLIC_API_URL: http://localhost/api
EOF
ok "docker-compose.host.yml written."

step "Step 4/6  Ensure user is in docker group"

if id -nG "$USER" | grep -qw docker; then
  ok "$USER is already in the docker group."
  DOCKER="docker"
else
  warn "Adding $USER to docker group (sudo)."
  sudo usermod -aG docker "$USER"
  warn "You must log out and back in for docker group membership to apply in new sessions."
  DOCKER="sudo docker"
fi

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.host.yml -f docker-compose.localhost.yml)

step "Step 5/6  Start db + mosquitto"

$DOCKER compose "${COMPOSE_FILES[@]}" up -d db mosquitto

info "Waiting for db to become healthy..."
for i in {1..30}; do
  if $DOCKER compose "${COMPOSE_FILES[@]}" ps db --format json 2>/dev/null | grep -q '"Health":"healthy"'; then
    ok "db is healthy."
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && fail "db failed to become healthy in 60s."
done

step "Step 6/6  Build and start backend + frontend + localhost proxy"

$DOCKER compose "${COMPOSE_FILES[@]}" up -d --build backend frontend nginx

info "Waiting for backend /health..."
for i in {1..30}; do
  if curl -fsS -m 2 "http://127.0.0.1:3000/health" >/dev/null 2>&1; then
    ok "backend /health responds."
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && fail "backend /health did not respond in 60s."
done

info "Waiting for localhost frontend..."
for i in {1..30}; do
  if curl -fsS -m 2 "http://127.0.0.1/" >/dev/null 2>&1; then
    ok "localhost frontend responds."
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && fail "localhost frontend did not respond in 60s."
done

echo ""
echo -e "${GREEN}=========================================="
echo "  WPT IoT installed and running"
echo -e "==========================================${NC}"
echo ""
echo "  Frontend:    http://localhost"
echo "  API:         http://localhost/api/health"
echo "  Backend:     http://127.0.0.1:3000/health"
echo ""
echo "This mode is intended for the same local machine only."
echo "Browsers treat localhost as a secure context, so service workers and PWA install remain available without custom certificates."
echo ""
