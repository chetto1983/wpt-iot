#!/usr/bin/env bash
# =============================================================================
# WPT IoT — Offline Bundle Builder (golden master → portable tarball)
# =============================================================================
# Run this on a Linux build host that:
#   1. Has internet access (can pull from Docker Hub + npm registry)
#   2. Has Docker Engine + Compose v2 installed
#   3. Has the wpt-iot repo checked out
#
# Produces a single tarball that contains EVERYTHING an air-gapped edge PC
# needs to bring up the stack:
#   - All 4 Docker images (db, mosquitto, backend, frontend) via `docker save`
#   - docker-compose.yml + init-timescaledb.sql + mosquitto config
#   - install-offline.sh (the air-gap installer) + wpt-local-alias.sh
#   - VERSION file with the source git SHA + build timestamp
#
# The bundle is named:
#   wpt-iot-bundle-<git-short-sha>-<YYYYMMDD-HHMMSS>.tar.gz
#
# Typical flow:
#   1. On golden master:    bash scripts/build-bundle.sh
#                           → /tmp/wpt-iot-bundle-XXXX.tar.gz
#   2. Transfer to edge PC: scp / USB / sneakernet
#   3. On edge PC:          tar xzf wpt-iot-bundle-XXXX.tar.gz && cd wpt-iot-bundle-XXXX
#                           sudo bash install-offline.sh
#
# Re-run safe. Idempotent. Build host disk usage: ~1.5 GB during build, ~600 MB
# tarball, can be deleted after `docker save` finishes.
# =============================================================================

set -euo pipefail

# --- Config (override via env) ---
OUTPUT_DIR="${OUTPUT_DIR:-/tmp}"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://wpt.local:3000}"
SKIP_BUILD="${SKIP_BUILD:-0}"  # set to 1 to reuse existing local images instead of rebuilding

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
step() { echo -e "\n${BLUE}==>${NC} $1"; }
ok()   { echo -e "  ${GREEN}OK${NC} $1"; }
info() { echo -e "  ${YELLOW}··${NC} $1"; }
fail() { echo -e "  ${RED}!!${NC} $1" >&2; exit 1; }

# --- Sanity checks ---
[[ -f "package.json" && -d "apps/backend" && -d "apps/frontend" ]] || \
  fail "Run this script from the wpt-iot repo root (where package.json + apps/ live)."
command -v docker >/dev/null 2>&1 || fail "docker not in PATH — install Docker Engine first."
docker compose version >/dev/null 2>&1 || fail "docker compose v2 not available — upgrade Docker."

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

# =============================================================================
# 1. Build images (unless SKIP_BUILD=1)
# =============================================================================
step "Step 1/5  Build backend + frontend images"

if [[ "${SKIP_BUILD}" == "1" ]]; then
  info "SKIP_BUILD=1 — reusing existing wpt-iot-backend:latest + wpt-iot-frontend:latest"
  docker image inspect wpt-iot-backend:latest >/dev/null 2>&1 || \
    fail "wpt-iot-backend:latest not found locally — unset SKIP_BUILD or build it first."
  docker image inspect wpt-iot-frontend:latest >/dev/null 2>&1 || \
    fail "wpt-iot-frontend:latest not found locally — unset SKIP_BUILD or build it first."
else
  info "Pulling base images (db, mosquitto)..."
  docker pull timescale/timescaledb:latest-pg17
  docker pull eclipse-mosquitto:2

  info "Building backend image..."
  docker compose -f docker-compose.yml build backend

  info "Building frontend image with NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}..."
  NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL}" \
    docker compose -f docker-compose.yml build frontend
fi
ok "Images ready."

# =============================================================================
# 2. Stage bundle directory
# =============================================================================
step "Step 2/5  Stage bundle directory"

rm -rf "${BUNDLE_DIR}"
mkdir -p "${BUNDLE_DIR}"

# Copy compose + DB init + mosquitto config
cp docker-compose.yml "${BUNDLE_DIR}/"
mkdir -p "${BUNDLE_DIR}/docker"
cp docker/init-timescaledb.sql "${BUNDLE_DIR}/docker/"
mkdir -p "${BUNDLE_DIR}/mosquitto/config"
cp -r mosquitto/config/. "${BUNDLE_DIR}/mosquitto/config/"

# Copy installer + helpers
cp scripts/install-offline.sh "${BUNDLE_DIR}/"
cp scripts/wpt-local-alias.sh "${BUNDLE_DIR}/"
chmod +x "${BUNDLE_DIR}/install-offline.sh" "${BUNDLE_DIR}/wpt-local-alias.sh"

ok "Config + scripts staged at ${BUNDLE_DIR}"

# =============================================================================
# 3. docker save the 4 images
# =============================================================================
step "Step 3/5  docker save images (this is the slow part — 60–120 s)"

mkdir -p "${BUNDLE_DIR}/images"

info "Saving timescale/timescaledb:latest-pg17..."
docker save timescale/timescaledb:latest-pg17 | gzip > "${BUNDLE_DIR}/images/db.tar.gz"

info "Saving eclipse-mosquitto:2..."
docker save eclipse-mosquitto:2 | gzip > "${BUNDLE_DIR}/images/mosquitto.tar.gz"

info "Saving wpt-iot-backend:latest..."
docker save wpt-iot-backend:latest | gzip > "${BUNDLE_DIR}/images/backend.tar.gz"

info "Saving wpt-iot-frontend:latest..."
docker save wpt-iot-frontend:latest | gzip > "${BUNDLE_DIR}/images/frontend.tar.gz"

ok "Images saved:"
ls -lh "${BUNDLE_DIR}/images/" | awk 'NR>1 {printf "    %-25s %s\n", $9, $5}'

# =============================================================================
# 4. Write VERSION + checksums
# =============================================================================
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
VERSIONEOF

# SHA256 checksums for tamper detection on transit
( cd "${BUNDLE_DIR}" && find . -type f -not -name SHA256SUMS -exec sha256sum {} + > SHA256SUMS )

ok "VERSION + SHA256SUMS written."

# =============================================================================
# 5. Tarball it
# =============================================================================
step "Step 5/5  Tarball ${BUNDLE_TARBALL}"

tar -C "${OUTPUT_DIR}" -czf "${BUNDLE_TARBALL}" "${BUNDLE_NAME}"
BUNDLE_SIZE="$(du -h "${BUNDLE_TARBALL}" | cut -f1)"

# Compute final checksum of the tarball itself
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
echo "Re-running this script later will produce a new bundle with a fresh"
echo "timestamp — the old one is left intact in ${OUTPUT_DIR}."
echo ""

# Optional cleanup of the staging dir (the tarball is what matters)
# Uncomment if you want the staging dir auto-removed:
# rm -rf "${BUNDLE_DIR}"
