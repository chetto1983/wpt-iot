#!/usr/bin/env bash
# =============================================================================
# wpt-local-alias.sh — publishes wpt.local as an mDNS A-record alias
# =============================================================================
# Invoked by the wpt-local-alias.service systemd unit (installed by
# scripts/install-linux.sh). Resolves the current primary LAN IP at start
# time via `hostname -I` so DHCP renewals / IP changes are picked up on
# service restart without re-running the installer.
#
# Why a wrapper and not ExecStart=/usr/bin/avahi-publish directly?
# Because the LAN IP must be resolved AT START TIME, not at install time.
# install-prod.sh bakes the IP into the unit file, which breaks if the VM
# gets a new DHCP lease. This wrapper re-resolves on every restart.
#
# Runs as root (required for avahi-publish to publish on all interfaces).
# =============================================================================
set -euo pipefail

# Resolve the primary LAN IPv4 (first non-loopback). Excludes docker bridges
# because they come later in the `hostname -I` ordering on Linux kernels with
# the default `ip -4 route` behaviour — first entry is the default-route iface.
LAN_IP="$(hostname -I | awk '{print $1}')"

if [[ -z "${LAN_IP}" ]]; then
  echo "[wpt-local-alias] FAIL: hostname -I returned no IPv4 address" >&2
  exit 1
fi

echo "[wpt-local-alias] Publishing wpt.local -> ${LAN_IP}"

# -a: publish an A record (hostname -> IP)
# -R: allow multiple records for same name (safe if another service is also
#     publishing wpt.local on a different interface)
# Runs foreground so systemd can monitor + restart on failure.
exec /usr/bin/avahi-publish -a -R wpt.local "${LAN_IP}"
