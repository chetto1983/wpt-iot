#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# OnLogic Production Setup Script
# =============================================================================
# Configures the OnLogic industrial PC for WPT IoT production deployment:
#   1. avahi-daemon for wpt.local mDNS resolution
#   2. Docker log rotation via daemon.json
#   3. GHCR authentication for Docker pulls + Watchtower
#   4. Production .env file from template
#
# Usage: sudo ./setup-onlogic.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
ok()    { echo -e "${GREEN}[ OK ]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# --- Root check ---
if [[ $EUID -ne 0 ]]; then
  fail "This script must be run as root (sudo ./setup-onlogic.sh)"
fi

echo ""
echo "=========================================="
echo "  WPT IoT — OnLogic Production Setup"
echo "=========================================="
echo ""

# =============================================================================
# 1. AVAHI-DAEMON (mDNS: wpt.local)
# =============================================================================
info "Installing avahi-daemon for mDNS (wpt.local)..."

apt-get update -qq
apt-get install -y -qq avahi-daemon avahi-utils libnss-mdns > /dev/null 2>&1
ok "avahi-daemon installed"

info "Setting hostname to 'wpt'..."
hostnamectl set-hostname wpt
ok "Hostname set to 'wpt'"

info "Writing avahi-daemon.conf..."
if [[ -f /etc/avahi/avahi-daemon.conf ]]; then
  cp /etc/avahi/avahi-daemon.conf /etc/avahi/avahi-daemon.conf.bak
  warn "Backed up existing avahi-daemon.conf to avahi-daemon.conf.bak"
fi

cat > /etc/avahi/avahi-daemon.conf << 'AVAHI_CONF'
[server]
host-name=wpt
domain-name=local
use-ipv4=yes
use-ipv6=no
allow-interfaces=eth0,enp0s31f6,eno1
ratelimit-interval-usec=1000000
ratelimit-burst=1000

[wide-area]
enable-wide-area=no

[publish]
publish-hinfo=no
publish-workstation=no
publish-domain=yes
publish-addresses=yes

[reflector]

[rlimits]
AVAHI_CONF
ok "avahi-daemon.conf written"

# Disable systemd-resolved mDNS to avoid conflict
info "Disabling systemd-resolved mDNS..."
if [[ -f /etc/systemd/resolved.conf ]]; then
  if grep -q "^MulticastDNS=" /etc/systemd/resolved.conf; then
    sed -i 's/^MulticastDNS=.*/MulticastDNS=no/' /etc/systemd/resolved.conf
  elif grep -q "^#MulticastDNS=" /etc/systemd/resolved.conf; then
    sed -i 's/^#MulticastDNS=.*/MulticastDNS=no/' /etc/systemd/resolved.conf
  else
    echo "MulticastDNS=no" >> /etc/systemd/resolved.conf
  fi
  systemctl restart systemd-resolved 2>/dev/null || true
  ok "systemd-resolved mDNS disabled"
else
  warn "systemd-resolved.conf not found — skipping"
fi

# Ensure nsswitch.conf has mdns_minimal
info "Checking nsswitch.conf for mdns_minimal..."
if grep -q "mdns_minimal" /etc/nsswitch.conf; then
  ok "nsswitch.conf already has mdns_minimal"
else
  sed -i 's/^hosts:.*/hosts:          files mdns_minimal [NOTFOUND=return] dns/' /etc/nsswitch.conf
  ok "nsswitch.conf updated with mdns_minimal"
fi

# Enable and restart avahi-daemon
systemctl enable avahi-daemon
systemctl restart avahi-daemon
ok "avahi-daemon enabled and started"

echo ""

# =============================================================================
# 2. DOCKER LOG ROTATION
# =============================================================================
info "Configuring Docker log rotation..."

if [[ -f /etc/docker/daemon.json ]]; then
  warn "Docker daemon.json already exists — skipping (verify log-opts manually)"
else
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json << 'DOCKER_CONF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
DOCKER_CONF
  ok "Docker daemon.json created with log rotation (10MB x 3)"
  info "Restart Docker to apply: systemctl restart docker"
fi

echo ""

# =============================================================================
# 3. GHCR AUTHENTICATION
# =============================================================================
info "Setting up GHCR authentication for image pulls..."
echo ""
read -rp "  GitHub username: " GH_USERNAME
read -rsp "  GitHub PAT (read:packages scope): " GH_PAT
echo ""

if [[ -z "$GH_USERNAME" || -z "$GH_PAT" ]]; then
  fail "GitHub username and PAT are required"
fi

# Docker CLI auth
echo "$GH_PAT" | docker login ghcr.io -u "$GH_USERNAME" --password-stdin
ok "Docker CLI authenticated with GHCR"

# Watchtower config (separate auth file)
info "Creating Watchtower GHCR auth config..."
mkdir -p /etc/watchtower/config
AUTH_B64=$(echo -n "${GH_USERNAME}:${GH_PAT}" | base64)
cat > /etc/watchtower/config/config.json << WATCHTOWER_CONF
{"auths":{"ghcr.io":{"auth":"${AUTH_B64}"}}}
WATCHTOWER_CONF
chmod 600 /etc/watchtower/config/config.json
ok "Watchtower config created at /etc/watchtower/config/config.json"

echo ""

# =============================================================================
# 4. PRODUCTION .ENV FILE
# =============================================================================
info "Creating production .env file..."

ENV_FILE="${PROJECT_DIR}/.env"
ENV_EXAMPLE="${PROJECT_DIR}/.env.example"

if [[ -f "$ENV_FILE" ]]; then
  warn ".env file already exists — skipping (review manually)"
else
  if [[ ! -f "$ENV_EXAMPLE" ]]; then
    fail ".env.example not found at ${ENV_EXAMPLE}"
  fi

  cp "$ENV_EXAMPLE" "$ENV_FILE"

  # Apply production overrides
  sed -i 's/^PG_HOST=.*/PG_HOST=127.0.0.1/' "$ENV_FILE"
  sed -i 's/^CORS_ORIGIN=.*/CORS_ORIGIN=http:\/\/wpt.local:3001/' "$ENV_FILE"
  sed -i 's/^NEXT_PUBLIC_API_URL=.*/NEXT_PUBLIC_API_URL=http:\/\/wpt.local:3000/' "$ENV_FILE"

  # Remove simulator config (not used in production)
  sed -i '/^SIM_HOST=/d' "$ENV_FILE"

  # Generate random secrets
  SESSION_SECRET=$(openssl rand -base64 32 | tr -d '/+=' | head -c 40)
  sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=${SESSION_SECRET}/" "$ENV_FILE"

  PG_PWD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
  sed -i "s/^PG_PASSWORD=.*/PG_PASSWORD=${PG_PWD}/" "$ENV_FILE"

  ok ".env file created with production overrides"
  warn "Review and set ADMIN_PASSWORD in ${ENV_FILE}"
fi

echo ""

# =============================================================================
# SUMMARY
# =============================================================================
echo "=========================================="
echo "  Setup Complete"
echo "=========================================="
echo ""
info "Hostname:      wpt (resolves as wpt.local via mDNS)"
info "GHCR auth:     configured for Docker CLI + Watchtower"
info "Log rotation:  10MB x 3 files (Docker daemon-level)"
info "Env file:      ${ENV_FILE}"
echo ""
echo "Next steps:"
echo "  1. Review ${ENV_FILE} — set ADMIN_PASSWORD"
echo "  2. Restart Docker if daemon.json was created:"
echo "       systemctl restart docker"
echo "  3. Start the production stack:"
echo "       cd ${PROJECT_DIR}"
echo "       docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d"
echo "  4. Verify wpt.local resolves:"
echo "       avahi-resolve -n wpt.local"
echo "  5. Open browser: http://wpt.local:3001"
echo ""
