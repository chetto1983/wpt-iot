#!/usr/bin/env bash
# =============================================================================
# wpt-local-alias.sh - publishes wpt.local + api.wpt.local mDNS aliases
# =============================================================================
# Invoked by the wpt-local-alias.service systemd unit (installed by
# scripts/install-linux.sh). Resolves the current primary LAN IP at start
# time via `hostname -I` so DHCP renewals / IP changes are picked up on
# service restart without re-running the installer.
#
# Why a wrapper and not ExecStart=/usr/bin/avahi-publish directly?
# Because the LAN IP must be resolved at start time, not at install time.
# install-prod.sh bakes the IP into the unit file, which breaks if the VM
# gets a new DHCP lease. This wrapper re-resolves on every restart.
#
# Runs as root (required for avahi-publish to publish on all interfaces).
# =============================================================================
set -euo pipefail

LAN_IP="$(hostname -I | awk '{print $1}')"

if [[ -z "${LAN_IP}" ]]; then
  echo "[wpt-local-alias] FAIL: hostname -I returned no IPv4 address" >&2
  exit 1
fi

echo "[wpt-local-alias] Publishing wpt.local + api.wpt.local -> ${LAN_IP}"

/usr/bin/avahi-publish -a -R wpt.local "${LAN_IP}" &
PUBLISH_WPT_PID=$!
/usr/bin/avahi-publish -a -R api.wpt.local "${LAN_IP}" &
PUBLISH_API_PID=$!

cleanup() {
  kill "${PUBLISH_WPT_PID}" "${PUBLISH_API_PID}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM
wait -n "${PUBLISH_WPT_PID}" "${PUBLISH_API_PID}"
