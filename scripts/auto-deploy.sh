#!/usr/bin/env bash
# =============================================================================
# WPT IoT — Auto Deploy (golden master poll → rebuild → ship)
# =============================================================================
# Runs on a Linux GOLDEN MASTER host that:
#   1. Has internet access (Docker Hub + npm registry + GitHub reachable)
#   2. Has Docker Engine + Compose v2 installed
#   3. Has a checked-out clone of chetto1983/wpt-iot at REPO_DIR
#   4. Has SSH keys to all customer edge PCs (passwordless or via ssh-agent)
#
# What it does, on every invocation:
#   1. git fetch origin master
#   2. If origin/master == HEAD: nothing to do, exit 0
#   3. Otherwise: git pull --ff-only
#   4. bash scripts/build-bundle.sh → /var/lib/wpt-deploy/bundles/wpt-iot-bundle-<sha>-<ts>.tar.gz
#   5. For each customer in CUSTOMERS_CONF:
#        scp the bundle → tar xz on remote → sudo bash install.sh
#        Log success/failure per customer
#   6. Symlink /var/lib/wpt-deploy/latest.tar.gz to the freshest bundle
#   7. Prune older bundles (keep KEEP_BUNDLES = last 5 by default)
#
# Designed for:
#   - cron */5 (poll every 5 minutes)
#   - systemd OnCalendar timer (recommended — see scripts/wpt-auto-deploy.timer)
#   - manual one-shot (after a `git push` you know is ready)
#
# Idempotent: if HEAD already matches origin/master, exits 0 silently. Safe to
# run as often as you like.
#
# Logs everything to ${LOG_FILE}. journalctl -u wpt-auto-deploy if running via
# systemd.
# =============================================================================

set -euo pipefail

# --- Config (override via env or /etc/default/wpt-auto-deploy) ---
[[ -f /etc/default/wpt-auto-deploy ]] && source /etc/default/wpt-auto-deploy

REPO_DIR="${REPO_DIR:-/opt/wpt-deploy/wpt-iot}"
BUNDLE_DIR="${BUNDLE_DIR:-/var/lib/wpt-deploy/bundles}"
LOG_FILE="${LOG_FILE:-/var/log/wpt-auto-deploy.log}"
CUSTOMERS_CONF="${CUSTOMERS_CONF:-/etc/wpt-auto-deploy/customers.conf}"
KEEP_BUNDLES="${KEEP_BUNDLES:-5}"
SKIP_SHIP="${SKIP_SHIP:-0}"          # 1 = build only, do not ship to customers

# --- Logging helpers ---
log() {
  local ts
  ts="$(date -Iseconds)"
  echo "${ts}  $1" | tee -a "${LOG_FILE}"
}
log_err() {
  local ts
  ts="$(date -Iseconds)"
  echo "${ts}  ERROR  $1" | tee -a "${LOG_FILE}" >&2
}

# --- Sanity ---
mkdir -p "${BUNDLE_DIR}" "$(dirname "${LOG_FILE}")"

[[ -d "${REPO_DIR}/.git" ]] || {
  log_err "REPO_DIR (${REPO_DIR}) is not a git repo. Clone it first:"
  log_err "  sudo mkdir -p $(dirname ${REPO_DIR}) && sudo chown \$USER $(dirname ${REPO_DIR})"
  log_err "  git clone https://github.com/chetto1983/wpt-iot.git ${REPO_DIR}"
  exit 1
}

command -v docker >/dev/null 2>&1 || { log_err "docker not in PATH"; exit 1; }
command -v git >/dev/null 2>&1 || { log_err "git not in PATH"; exit 1; }

cd "${REPO_DIR}"

# =============================================================================
# 1. Poll origin/master
# =============================================================================
log "poll: git fetch origin master"
if ! git fetch origin master --quiet 2>>"${LOG_FILE}"; then
  log_err "git fetch failed (no network? auth issue?)"
  exit 2
fi

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/master)"

if [[ "${LOCAL_SHA}" == "${REMOTE_SHA}" ]]; then
  log "poll: HEAD == origin/master (${LOCAL_SHA:0:7}) — nothing to do"
  exit 0
fi

log "poll: new commits detected (${LOCAL_SHA:0:7} → ${REMOTE_SHA:0:7})"
log "poll: $(git log --oneline ${LOCAL_SHA}..${REMOTE_SHA} | wc -l) new commit(s):"
git log --oneline "${LOCAL_SHA}..${REMOTE_SHA}" | tee -a "${LOG_FILE}" | sed 's/^/    /'

# =============================================================================
# 2. Pull
# =============================================================================
log "pull: git pull --ff-only origin master"
if ! git pull --ff-only origin master --quiet 2>>"${LOG_FILE}"; then
  log_err "git pull --ff-only failed (working tree dirty? non-ff?)"
  exit 3
fi

# =============================================================================
# 3. Build bundle
# =============================================================================
log "build: scripts/build-bundle.sh"
if ! OUTPUT_DIR="${BUNDLE_DIR}" \
     bash scripts/build-bundle.sh >>"${LOG_FILE}" 2>&1; then
  log_err "build-bundle.sh failed — see ${LOG_FILE}"
  exit 4
fi

# Find the bundle that was just produced (newest .tar.gz in BUNDLE_DIR)
NEW_BUNDLE="$(ls -1t "${BUNDLE_DIR}"/wpt-iot-bundle-*.tar.gz 2>/dev/null | head -1)"
[[ -f "${NEW_BUNDLE}" ]] || {
  log_err "build succeeded but no bundle tarball found in ${BUNDLE_DIR}"
  exit 5
}
NEW_BUNDLE_NAME="$(basename "${NEW_BUNDLE}")"
log "build: produced ${NEW_BUNDLE_NAME} ($(du -h "${NEW_BUNDLE}" | cut -f1))"

# Update the "latest" symlink atomically
ln -sfn "${NEW_BUNDLE}" "${BUNDLE_DIR}/latest.tar.gz"
log "symlink: ${BUNDLE_DIR}/latest.tar.gz → ${NEW_BUNDLE_NAME}"

# =============================================================================
# 4. Prune older bundles (keep KEEP_BUNDLES newest)
# =============================================================================
TOTAL_BUNDLES="$(ls -1 "${BUNDLE_DIR}"/wpt-iot-bundle-*.tar.gz 2>/dev/null | wc -l)"
if [[ "${TOTAL_BUNDLES}" -gt "${KEEP_BUNDLES}" ]]; then
  PRUNE_COUNT=$((TOTAL_BUNDLES - KEEP_BUNDLES))
  log "prune: removing ${PRUNE_COUNT} old bundle(s) (keeping newest ${KEEP_BUNDLES})"
  ls -1t "${BUNDLE_DIR}"/wpt-iot-bundle-*.tar.gz | tail -n "+$((KEEP_BUNDLES + 1))" | while read -r old; do
    log "prune:   $(basename "${old}")"
    rm -f "${old}"
  done
fi

# =============================================================================
# 5. Ship to customers (unless SKIP_SHIP=1)
# =============================================================================
if [[ "${SKIP_SHIP}" == "1" ]]; then
  log "ship: SKIP_SHIP=1 — bundle built but not shipped"
  exit 0
fi

if [[ ! -f "${CUSTOMERS_CONF}" ]]; then
  log "ship: ${CUSTOMERS_CONF} not found — bundle built but not shipped"
  log "ship: see scripts/customers.conf.example for the format"
  exit 0
fi

# Read customers.conf — one customer per line, format:
#   <name> <user@host[:port]> <remote_install_dir>
# Lines starting with # are comments. Blank lines are skipped.
SHIP_OK=0
SHIP_FAIL=0
while IFS=' ' read -r CUST_NAME CUST_TARGET CUST_REMOTE_DIR; do
  [[ -z "${CUST_NAME}" || "${CUST_NAME}" =~ ^# ]] && continue
  [[ -z "${CUST_TARGET}" || -z "${CUST_REMOTE_DIR}" ]] && continue

  log "ship: ${CUST_NAME} → ${CUST_TARGET}:${CUST_REMOTE_DIR}"

  # Parse user@host[:port]
  CUST_PORT="22"
  CUST_HOST="${CUST_TARGET}"
  if [[ "${CUST_TARGET}" =~ :([0-9]+)$ ]]; then
    CUST_PORT="${BASH_REMATCH[1]}"
    CUST_HOST="${CUST_TARGET%:*}"
  fi

  # Probe SSH first
  if ! ssh -p "${CUST_PORT}" -o ConnectTimeout=5 -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
       "${CUST_HOST}" "true" 2>>"${LOG_FILE}"; then
    log_err "ship: ${CUST_NAME} unreachable via ssh — skipping"
    SHIP_FAIL=$((SHIP_FAIL + 1))
    continue
  fi

  # Ensure remote directory exists
  ssh -p "${CUST_PORT}" "${CUST_HOST}" "mkdir -p ${CUST_REMOTE_DIR}" 2>>"${LOG_FILE}" || {
    log_err "ship: ${CUST_NAME} could not create ${CUST_REMOTE_DIR}"
    SHIP_FAIL=$((SHIP_FAIL + 1))
    continue
  }

  # scp the bundle
  if ! scp -P "${CUST_PORT}" -q "${NEW_BUNDLE}" "${CUST_HOST}:${CUST_REMOTE_DIR}/" 2>>"${LOG_FILE}"; then
    log_err "ship: ${CUST_NAME} scp failed"
    SHIP_FAIL=$((SHIP_FAIL + 1))
    continue
  fi

  # Extract + run the canonical installer on the remote
  REMOTE_BUNDLE_NAME="${NEW_BUNDLE_NAME%.tar.gz}"
  if ! ssh -p "${CUST_PORT}" "${CUST_HOST}" "
    set -e
    cd ${CUST_REMOTE_DIR}
    tar xzf ${NEW_BUNDLE_NAME}
    sudo bash ${REMOTE_BUNDLE_NAME}/install.sh
  " 2>>"${LOG_FILE}"; then
    log_err "ship: ${CUST_NAME} remote install.sh failed"
    SHIP_FAIL=$((SHIP_FAIL + 1))
    continue
  fi

  log "ship: ${CUST_NAME} OK"
  SHIP_OK=$((SHIP_OK + 1))
done < "${CUSTOMERS_CONF}"

log "ship: done (${SHIP_OK} ok, ${SHIP_FAIL} failed)"
[[ "${SHIP_FAIL}" -gt 0 ]] && exit 6 || exit 0
