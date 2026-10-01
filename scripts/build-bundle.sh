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
#   - All 4 Docker images (db, backend, frontend, nginx)
#   - docker-compose.yml (single file — overlays removed in Phase 37.3)
#   - nginx template + init-timescaledb.sql
#   - install.sh + internal helpers (install-offline.sh, generate-local-tls.sh, wpt-local-alias.sh + unit)
#   - VERSION file with the source git SHA + build timestamp
# =============================================================================

set -euo pipefail

OUTPUT_DIR="${OUTPUT_DIR:-/tmp}"
SKIP_BUILD="${SKIP_BUILD:-0}"
TARGET_ARCH="${TARGET_ARCH:-$(dpkg --print-architecture 2>/dev/null || uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')}"

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

if [[ "$TARGET_ARCH" != "amd64" && "$TARGET_ARCH" != "arm64" ]]; then
  fail "TARGET_ARCH must be amd64 or arm64 (got: $TARGET_ARCH)"
fi

# The bundle ships docker-compose.yml, so it saves exactly the third-party
# images that file pins. A separate copy here once drifted to an older db.
compose_image() {
  docker compose -f docker-compose.yml config --images | grep "^$1:" || \
    fail "docker-compose.yml pins no $1 image."
}
DB_IMAGE="$(compose_image timescale/timescaledb)"
NGINX_IMAGE="$(compose_image nginx)"

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
info "Target arch: linux/${TARGET_ARCH}"
info "Frontend image is IP/host-agnostic (same-origin via nginx)"

step "Step 1/5  Build backend + frontend images"

if [[ "${SKIP_BUILD}" == "1" ]]; then
  info "SKIP_BUILD=1 - reusing existing local images"
  for image in "${DB_IMAGE}" wpt-iot-backend:latest wpt-iot-frontend:latest "${NGINX_IMAGE}"; do
    docker image inspect "${image}" >/dev/null 2>&1 || fail "${image} not found locally."
  done
else
  info "Pulling base images (db, nginx) for linux/${TARGET_ARCH}..."
  docker pull --platform "linux/${TARGET_ARCH}" "${DB_IMAGE}"
  docker pull --platform "linux/${TARGET_ARCH}" "${NGINX_IMAGE}"

  # NOTE: backend/frontend built for host arch. For cross-arch Pilz targets,
  # prefer pulling CI images from GHCR with SKIP_BUILD=1.
  info "Building backend image..."
  docker compose build backend

  info "Building frontend image (same-origin, no NEXT_PUBLIC_API_URL bake)..."
  docker compose build frontend
fi
ok "Images ready."

step "Step 2/5  Stage bundle directory"

rm -rf "${BUNDLE_DIR}"
mkdir -p "${BUNDLE_DIR}"

cp docker-compose.yml "${BUNDLE_DIR}/"
mkdir -p "${BUNDLE_DIR}/docker"
cp docker/init-timescaledb.sql "${BUNDLE_DIR}/docker/"
mkdir -p "${BUNDLE_DIR}/docker/nginx/templates"
cp docker/nginx/templates/wpt.conf.template "${BUNDLE_DIR}/docker/nginx/templates/"

cp scripts/install.sh "${BUNDLE_DIR}/"
cp scripts/install-offline.sh "${BUNDLE_DIR}/"
cp scripts/generate-local-tls.sh "${BUNDLE_DIR}/"
cp scripts/wpt-local-alias.sh "${BUNDLE_DIR}/"
cp scripts/wpt-local-alias.service "${BUNDLE_DIR}/"
cp scripts/wpt-tls-refresh.service "${BUNDLE_DIR}/"
cp scripts/wpt-tls-refresh.timer "${BUNDLE_DIR}/"
chmod +x \
  "${BUNDLE_DIR}/install.sh" \
  "${BUNDLE_DIR}/install-offline.sh" \
  "${BUNDLE_DIR}/generate-local-tls.sh" \
  "${BUNDLE_DIR}/wpt-local-alias.sh"

ok "Config + scripts staged at ${BUNDLE_DIR}"

step "Step 3/5  docker save images"

mkdir -p "${BUNDLE_DIR}/images"

save_image() {
  info "Saving $2..."
  docker save "$2" | gzip > "${BUNDLE_DIR}/images/$1.tar.gz"
}
save_image db "${DB_IMAGE}"
save_image backend wpt-iot-backend:latest
save_image frontend wpt-iot-frontend:latest
save_image nginx "${NGINX_IMAGE}"

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
target_arch:       ${TARGET_ARCH}
docker_version:    $(docker --version)
compose_version:   $(docker compose version | head -1)

# Image digests (sha256)
db:                $(docker image inspect "${DB_IMAGE}" --format '{{.Id}}')
backend:           $(docker image inspect wpt-iot-backend:latest --format '{{.Id}}')
frontend:          $(docker image inspect wpt-iot-frontend:latest --format '{{.Id}}')
nginx:             $(docker image inspect "${NGINX_IMAGE}" --format '{{.Id}}')
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
echo "       sudo bash install.sh"
echo ""
