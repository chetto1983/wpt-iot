#!/usr/bin/env bash
# =============================================================================
# WPT IoT - Offline Bundle Builder
# =============================================================================
# Run this on a Linux build host that:
#   1. Has internet access (can pull from Docker Hub + npm registry)
#   2. Has Docker Engine + Compose v2 installed
#   3. Has the wpt-iot repo checked out
#
# Produces a single tarball that contains everything an air-gapped edge PC
# needs to bring up the stack:
#   - All 5 Docker images (db, mosquitto, backend, frontend, nginx)
#   - docker-compose.yml + docker-compose.https.yml
#   - nginx template + init-timescaledb.sql + mosquitto config
#   - install-offline.sh + generate-local-tls.sh + wpt-local-alias.sh
#   - VERSION file with the source git SHA + build timestamp
# =============================================================================

set -euo pipefail

OUTPUT_DIR="${OUTPUT_DIR:-/tmp}"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://wpt.local/api}"
SKIP_BUILD="${SKIP_BUILD:-0}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
step() { echo -e "\n${BLUE}==>${NC} $1"; }
ok()   { echo -e "  ${GREEN}OK${NC} $1"; }
info() { echo -e "  ${YELLOW}..${NC} $1"; }
fail() { echo -e "  ${RED}!!${NC} $1" >&2; exit 1; }

[[ -f "package.json" && -d "apps/backend" && -d "apps/frontend" ]] || \
  fail "Run this script from the wpt-iot repo root."
command -v docker >/dev/null 2>&1 || fail "docker not in PATH."
docker compose version >/dev/null 2>&1 || fail "docker compose v2 not available."

GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
GIT_DIRTY=""
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  GIT_DIRTY="-dirty"
fi
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BUNDLE_NAME="wpt-iot-bundle-${GIT_SHA}${GIT_DIRTY}-${TIMESTAMP}"
BUNDLE_DIR="${OUTPUT_DIR}/${BUNDLE_NAME}"
BUNDLE_TARBALL="${OUTPUT_DIR}/${BUNDLE_NAME}.tar.gz"

step "Bundle: ${BUNDLE_NAME}"
info "Output dir: ${OUTPUT_DIR}"
info "API URL baked into frontend: ${NEXT_PUBLIC_API_URL}"

step "Step 1/5  Build backend + frontend images"

if [[ "${SKIP_BUILD}" == "1" ]]; then
  info "SKIP_BUILD=1 - reusing existing local images"
  docker image inspect timescale/timescaledb:latest-pg17 >/dev/null 2>&1 || \
    fail "timescale/timescaledb:latest-pg17 not found locally."
  docker image inspect eclipse-mosquitto:2 >/dev/null 2>&1 || \
    fail "eclipse-mosquitto:2 not found locally."
  docker image inspect wpt-iot-backend:latest >/dev/null 2>&1 || \
    fail "wpt-iot-backend:latest not found locally."
  docker image inspect wpt-iot-frontend:latest >/dev/null 2>&1 || \
    fail "wpt-iot-frontend:latest not found locally."
  docker image inspect nginx:1.28.3-alpine >/dev/null 2>&1 || \
    fail "nginx:1.28.3-alpine not found locally."
else
  info "Pulling base images (db, mosquitto, nginx)..."
  docker pull timescale/timescaledb:latest-pg17
  docker pull eclipse-mosquitto:2
  docker pull nginx:1.28.3-alpine

  info "Building backend image..."
  docker compose -f docker-compose.yml build backend

  info "Building frontend image with NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}..."
  NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL}" docker compose -f docker-compose.yml build frontend
fi
ok "Images ready."

step "Step 2/5  Stage bundle directory"

rm -rf "${BUNDLE_DIR}"
mkdir -p "${BUNDLE_DIR}"

cp docker-compose.yml "${BUNDLE_DIR}/"
cp docker-compose.https.yml "${BUNDLE_DIR}/"
mkdir -p "${BUNDLE_DIR}/docker"
cp docker/init-timescaledb.sql "${BUNDLE_DIR}/docker/"
mkdir -p "${BUNDLE_DIR}/docker/nginx/templates"
cp docker/nginx/templates/wpt.conf.template "${BUNDLE_DIR}/docker/nginx/templates/"
mkdir -p "${BUNDLE_DIR}/mosquitto/config"
cp -r mosquitto/config/. "${BUNDLE_DIR}/mosquitto/config/"

cp scripts/install-offline.sh "${BUNDLE_DIR}/"
cp scripts/generate-local-tls.sh "${BUNDLE_DIR}/"
cp scripts/wpt-local-alias.sh "${BUNDLE_DIR}/"
chmod +x \
  "${BUNDLE_DIR}/install-offline.sh" \
  "${BUNDLE_DIR}/generate-local-tls.sh" \
  "${BUNDLE_DIR}/wpt-local-alias.sh"

ok "Config + scripts staged at ${BUNDLE_DIR}"

step "Step 3/5  docker save images"

mkdir -p "${BUNDLE_DIR}/images"

info "Saving timescale/timescaledb:latest-pg17..."
docker save timescale/timescaledb:latest-pg17 | gzip > "${BUNDLE_DIR}/images/db.tar.gz"

info "Saving eclipse-mosquitto:2..."
docker save eclipse-mosquitto:2 | gzip > "${BUNDLE_DIR}/images/mosquitto.tar.gz"

info "Saving wpt-iot-backend:latest..."
docker save wpt-iot-backend:latest | gzip > "${BUNDLE_DIR}/images/backend.tar.gz"

info "Saving wpt-iot-frontend:latest..."
docker save wpt-iot-frontend:latest | gzip > "${BUNDLE_DIR}/images/frontend.tar.gz"

info "Saving nginx:1.28.3-alpine..."
docker save nginx:1.28.3-alpine | gzip > "${BUNDLE_DIR}/images/nginx.tar.gz"

ok "Images saved:"
ls -lh "${BUNDLE_DIR}/images/" | awk 'NR>1 {printf "    %-25s %s\n", $9, $5}'

step "Step 4/5  VERSION + checksums"

cat > "${BUNDLE_DIR}/VERSION" <<VERSIONEOF
wpt-iot offline bundle
======================
git_sha:           ${GIT_SHA}${GIT_DIRTY}
built_at:          $(date -Iseconds)
built_on_host:     $(hostname)
built_by_user:     $(whoami)
next_public_api:   ${NEXT_PUBLIC_API_URL}
docker_version:    $(docker --version)
compose_version:   $(docker compose version | head -1)

# Image digests (sha256)
db:                $(docker image inspect timescale/timescaledb:latest-pg17 --format '{{.Id}}')
mosquitto:         $(docker image inspect eclipse-mosquitto:2 --format '{{.Id}}')
backend:           $(docker image inspect wpt-iot-backend:latest --format '{{.Id}}')
frontend:          $(docker image inspect wpt-iot-frontend:latest --format '{{.Id}}')
nginx:             $(docker image inspect nginx:1.28.3-alpine --format '{{.Id}}')
VERSIONEOF

( cd "${BUNDLE_DIR}" && find . -type f -not -name SHA256SUMS -exec sha256sum {} + > SHA256SUMS )

ok "VERSION + SHA256SUMS written."

step "Step 5/5  Tarball ${BUNDLE_TARBALL}"

tar -C "${OUTPUT_DIR}" -czf "${BUNDLE_TARBALL}" "${BUNDLE_NAME}"
BUNDLE_SIZE="$(du -h "${BUNDLE_TARBALL}" | cut -f1)"
BUNDLE_SHA="$(sha256sum "${BUNDLE_TARBALL}" | awk '{print $1}')"

ok "Bundle ready."
echo ""
echo -e "${GREEN}=========================================="
echo "  WPT IoT bundle ready"
echo -e "==========================================${NC}"
echo ""
echo "  File:        ${BUNDLE_TARBALL}"
echo "  Size:        ${BUNDLE_SIZE}"
echo "  Source SHA:  ${GIT_SHA}${GIT_DIRTY}"
echo "  SHA256:      ${BUNDLE_SHA}"
echo ""
echo "Next steps:"
echo "  1. Transfer to the edge PC (USB stick, scp, sneakernet)"
echo "  2. On the edge PC, as root or via sudo:"
echo "       tar xzf ${BUNDLE_NAME}.tar.gz"
echo "       cd ${BUNDLE_NAME}"
echo "       sudo bash install-offline.sh"
echo ""
