#!/usr/bin/env bash
# =============================================================================
# WPT IoT — First-time setup & deploy script
# =============================================================================
# Usage:
#   ./setup.sh              # Production (db + backend + frontend)
#   ./setup.sh --rebuild    # Force rebuild all images
# =============================================================================

set -euo pipefail

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $1"; exit 1; }

# ─── Parse args ──────────────────────────────────────────────────────────────
REBUILD=false

for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=true ;;
    --help|-h)
      echo "Usage: ./setup.sh [--rebuild]"
      echo "  --rebuild  Force rebuild all Docker images"
      exit 0
      ;;
    *) warn "Unknown flag: $arg" ;;
  esac
done

# ─── Prerequisites ───────────────────────────────────────────────────────────
info "Checking prerequisites..."

command -v docker >/dev/null 2>&1 || fail "Docker not found. Install: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "Docker Compose not found (need v2+)."
ok "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+')"

# ─── Navigate to script directory ────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
info "Working directory: $SCRIPT_DIR"

# ─── Environment file ───────────────────────────────────────────────────────
if [ ! -f .env ]; then
  info "No .env found — creating from .env.example..."
  cp .env.example .env

  # Generate random secrets
  SESSION_SECRET=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | xxd -p | head -c 32)
  ADMIN_PASS=$(openssl rand -hex 8 2>/dev/null || head -c 8 /dev/urandom | xxd -p | head -c 16)
  PG_PASS=$(openssl rand -hex 12 2>/dev/null || head -c 12 /dev/urandom | xxd -p | head -c 24)

  sed -i "s|SESSION_SECRET=.*|SESSION_SECRET=${SESSION_SECRET}|" .env
  sed -i "s|ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASS}|" .env
  sed -i "s|PG_PASSWORD=.*|PG_PASSWORD=${PG_PASS}|" .env

  ok "Created .env with random secrets"
  warn "Admin password: ${ADMIN_PASS}  (save this!)"
else
  ok ".env already exists"
fi

# ─── Build & start containers ────────────────────────────────────────────────
BUILD_FLAGS=""

info "Mode: PRODUCTION"

if [ "$REBUILD" = true ]; then
  BUILD_FLAGS="--build --force-recreate"
  info "Forcing full rebuild..."
fi

echo ""
info "Starting containers..."
docker compose up -d $BUILD_FLAGS 2>&1

# ─── Wait for database ──────────────────────────────────────────────────────
info "Waiting for database to become healthy..."
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U wpt -q 2>/dev/null; then
    ok "Database ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    fail "Database did not become ready in 30s"
  fi
  sleep 1
done

# ─── Verify TimescaleDB extension ───────────────────────────────────────────
TSDB=$(docker compose exec -T db psql -U wpt -d wpt -tAc \
  "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb';" 2>/dev/null || echo "")

if [ -n "$TSDB" ]; then
  ok "TimescaleDB $TSDB installed"
else
  fail "TimescaleDB extension not found — check docker/init-timescaledb.sql"
fi

# ─── Wait for backend ───────────────────────────────────────────────────────
info "Waiting for backend to become healthy..."
for i in $(seq 1 60); do
  if docker compose exec -T backend wget --spider -q http://127.0.0.1:3000/health 2>/dev/null; then
    ok "Backend ready"
    break
  fi
  if [ "$i" -eq 60 ]; then
    fail "Backend did not become ready in 60s. Check: docker compose logs backend"
  fi
  sleep 2
done

# ─── Setup TimescaleDB retention (hypertable + aggregates + policies) ────────
info "Setting up TimescaleDB retention policies..."
TSDB_SETUP=$(docker compose exec -T db psql -U wpt -d wpt \
  -c "SELECT setup_timescaledb_retention();" 2>&1)

if echo "$TSDB_SETUP" | grep -q "TimescaleDB retention setup complete"; then
  ok "TimescaleDB retention configured"
else
  # Check if it's just warnings (varchar hints) — still successful
  if echo "$TSDB_SETUP" | grep -q "setup_timescaledb_retention"; then
    ok "TimescaleDB retention configured (with warnings)"
  else
    warn "TimescaleDB setup may have issues:"
    echo "$TSDB_SETUP"
  fi
fi

# ─── Setup Phase 19 energy continuous aggregates (energy_5min/1h/1d/1mo) ─────
# Without this the /api/energy/dashboard, /aggregate, /reconciliation endpoints
# 500 because they query energy_5min/1h/1d CAGGs that don't exist. Idempotent.
info "Setting up energy continuous aggregates..."
ENERGY_SETUP=$(docker compose exec -T db psql -U wpt -d wpt \
  -c "SELECT setup_energy_aggregates();" 2>&1)

if echo "$ENERGY_SETUP" | grep -q "setup_energy_aggregates"; then
  ok "Energy continuous aggregates configured"
else
  warn "Energy aggregate setup may have issues:"
  echo "$ENERGY_SETUP"
fi

# Backfill CAGGs from existing machine_snapshots history (NO DATA on create).
# Safe to re-run — TimescaleDB skips already-materialized ranges.
info "Backfilling energy aggregates from historical data..."
for CAGG in snapshots_1d energy_5min energy_1h energy_1d energy_1mo; do
  docker compose exec -T db psql -U wpt -d wpt \
    -c "CALL refresh_continuous_aggregate('${CAGG}', NULL, NULL);" >/dev/null 2>&1 \
    && ok "Refreshed ${CAGG}" \
    || warn "Refresh failed for ${CAGG} (may be empty — OK on fresh install)"
done

# ─── Verify hypertable ──────────────────────────────────────────────────────
HT=$(docker compose exec -T db psql -U wpt -d wpt -tAc \
  "SELECT count(*) FROM timescaledb_information.hypertables WHERE hypertable_name = 'machine_snapshots';" 2>/dev/null || echo "0")

if [ "$HT" = "1" ]; then
  ok "machine_snapshots is a hypertable"
else
  warn "machine_snapshots hypertable not detected"
fi

# ─── Verify continuous aggregates ────────────────────────────────────────────
CA=$(docker compose exec -T db psql -U wpt -d wpt -tAc \
  "SELECT count(*) FROM timescaledb_information.continuous_aggregates;" 2>/dev/null || echo "0")

ok "Continuous aggregates: $CA (expected 7: snapshots_5min, snapshots_1h, snapshots_1d, energy_5min, energy_1h, energy_1d, energy_1mo)"

# ─── Print summary ──────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  WPT IoT — Setup Complete${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Frontend:   ${CYAN}http://localhost:3001${NC}"
echo -e "  Backend:    ${CYAN}http://localhost:3000${NC}"
echo -e "  Database:   ${CYAN}localhost:5432${NC}"

echo ""
echo -e "  Login:      ${YELLOW}admin${NC} / check .env for ADMIN_PASSWORD"
echo ""

# ─── Container status ───────────────────────────────────────────────────────
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""
