#!/usr/bin/env bash
# =============================================================================
# wpt-local-alias.sh - publishes wpt.local as an mDNS alias
# =============================================================================
set -euo pipefail

LAN_IP="$(hostname -I | awk '{print $1}')"

if [[ -z "${LAN_IP}" ]]; then
  echo "[wpt-local-alias] FAIL: hostname -I returned no IPv4 address" >&2
  exit 1
fi

echo "[wpt-local-alias] Publishing wpt.local -> ${LAN_IP}"
exec /usr/bin/avahi-publish -a -R wpt.local "${LAN_IP}"
