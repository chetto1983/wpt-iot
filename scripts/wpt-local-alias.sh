#!/usr/bin/env bash
# =============================================================================
# wpt-local-alias.sh — advertise wpt.local + wpt-<serial>.local via Avahi
# =============================================================================
# Published for every scope-global NIC on the box so clients on any subnet
# reachable from any interface can resolve the device without knowing the
# IP. Revolution Pi / Home Assistant pattern — see Phase 37.3 research.
#
# Hostnames:
#   wpt.local            — generic, works for single-device sites
#   wpt-<serial>.local   — disambiguator for multi-device customer sites
#
# Serial source, in order of preference:
#   1. $WPT_SERIAL environment variable
#   2. /etc/wpt/serial          (baked at manufacturing; preferred)
#   3. first 8 chars of /etc/machine-id (systemd-generated, unique per box)
#   4. hostname, sanitised      (last resort)
#
# NIC selection: all scope-global IPv4s from `ip -4 addr`, minus docker
# bridge pools (172.16.0.0/12) and link-local (169.254.0.0/16).
#
# Supervision: one avahi-publish child per (hostname, IP) pair. If any
# child dies the script exits so systemd restarts the whole group.
# =============================================================================
set -euo pipefail

SERIAL_FILE="${SERIAL_FILE:-/etc/wpt/serial}"

if [[ -n "${WPT_SERIAL:-}" ]]; then
  SERIAL="${WPT_SERIAL}"
elif [[ -f "${SERIAL_FILE}" && -r "${SERIAL_FILE}" ]]; then
  SERIAL="$(tr -d '\n\r \t' < "${SERIAL_FILE}")"
elif [[ -r /etc/machine-id ]]; then
  SERIAL="$(head -c 8 /etc/machine-id)"
else
  SERIAL="$(hostname | tr -dc 'a-z0-9' | head -c 8)"
fi

[[ -n "${SERIAL}" ]] || { echo "[wpt-local-alias] FAIL: could not derive serial" >&2; exit 1; }

HOSTS=("wpt.local" "wpt-${SERIAL}.local")

mapfile -t IPS < <(ip -4 -o addr show scope global 2>/dev/null \
  | awk '{print $4}' \
  | awk -F/ '{print $1}' \
  | grep -vE '^(172\.1[6-9]|172\.2[0-9]|172\.3[0-1])\.' \
  | grep -vE '^169\.254\.' \
  | sort -u)

if [[ ${#IPS[@]} -eq 0 ]]; then
  echo "[wpt-local-alias] FAIL: no scope-global IPv4 found" >&2
  exit 1
fi

command -v avahi-publish >/dev/null 2>&1 || {
  echo "[wpt-local-alias] FAIL: avahi-publish not installed" >&2
  exit 1
}

pids=()
cleanup() {
  for p in "${pids[@]}"; do
    kill "${p}" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for h in "${HOSTS[@]}"; do
  for ip in "${IPS[@]}"; do
    echo "[wpt-local-alias] advertise ${h} -> ${ip}"
    /usr/bin/avahi-publish -a -R "${h}" "${ip}" &
    pids+=($!)
  done
done

# Exit as soon as any child dies so systemd restarts the whole group.
# `wait -n` is available in bash >= 4.3 (Ubuntu 22.04 ships 5.1).
wait -n "${pids[@]}"
exit $?
