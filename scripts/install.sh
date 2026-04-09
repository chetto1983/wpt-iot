#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd 2>/dev/null || pwd)"

if [[ -f "${SCRIPT_DIR}/VERSION" && -d "${SCRIPT_DIR}/images" && -f "${SCRIPT_DIR}/install-offline.sh" ]]; then
  exec bash "${SCRIPT_DIR}/install-offline.sh" "$@"
fi

if [[ -f "${SCRIPT_DIR}/install-prod.sh" ]]; then
  exec bash "${SCRIPT_DIR}/install-prod.sh" "$@"
fi

REPO_OWNER="${REPO_OWNER:-chetto1983}"
REPO_NAME="${REPO_NAME:-wpt-iot}"
BRANCH="${BRANCH:-master}"
RAW_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/scripts/install.sh"

echo "[INFO] install.sh did not find a local installer. Downloading ${RAW_URL}" >&2
exec bash <(curl -fsSL "${RAW_URL}") "$@"
