#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# WPT IoT — Local TLS generator
#
# Generates (or refreshes) a local self-signed CA and a server certificate
# valid for wpt.local + the edge box's current LAN IPs.
#
# Zero-maintenance design:
#   * If LAN_IP is empty, auto-detect every scope-global IPv4 on the host
#     (skipping docker bridge ranges). Multi-homed boxes get one cert that
#     covers every NIC.
#   * If the existing server cert already covers the current IP set, exit
#     as a no-op. Safe to run on every boot.
#   * CA is reused as long as it exists on disk. Clients that already
#     trust it stay trusted across NIC/IP changes. FORCE=1 is the only way
#     to regenerate the CA.
#
# Arguments:
#   $1 OUTPUT_DIR   default: certs
#   $2 LAN_IP       comma-separated list; empty = auto-detect
#
# Environment:
#   FORCE=1           regenerate CA + server cert unconditionally
#   NO_AUTODETECT=1   skip auto-detect (use LAN_IP as given, even if empty)
# =============================================================================

OUTPUT_DIR="${1:-certs}"
LAN_IP="${2:-}"
FORCE="${FORCE:-0}"
NO_AUTODETECT="${NO_AUTODETECT:-0}"

CA_CERT="${OUTPUT_DIR}/wpt-local-ca.crt"
CA_KEY="${OUTPUT_DIR}/wpt-local-ca.key"
SERVER_CERT="${OUTPUT_DIR}/server.crt"
SERVER_KEY="${OUTPUT_DIR}/server.key"
OPENSSL_CONFIG="${OUTPUT_DIR}/openssl-san.cnf"

mkdir -p "${OUTPUT_DIR}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate local TLS assets." >&2
  exit 1
fi

# Auto-detect LAN IPs when none supplied. Exclude docker bridge pools
# (172.16.0.0/12) and link-local (169.254.0.0/16).
if [[ -z "${LAN_IP}" && "${NO_AUTODETECT}" != "1" ]]; then
  if command -v ip >/dev/null 2>&1; then
    LAN_IP=$(ip -4 -o addr show scope global 2>/dev/null \
      | awk '{print $4}' \
      | awk -F/ '{print $1}' \
      | grep -vE '^(172\.1[6-9]|172\.2[0-9]|172\.3[0-1])\.' \
      | grep -vE '^169\.254\.' \
      | sort -u \
      | paste -sd, -)
  fi
fi

# Build the desired sorted, deduplicated IP set the cert should cover.
declare -A desired_set=()
desired_set["127.0.0.1"]=1
if [[ -n "${LAN_IP}" ]]; then
  IFS=',' read -ra _ips <<< "${LAN_IP}"
  for ip in "${_ips[@]}"; do
    ip="${ip// /}"
    [[ -z "${ip}" ]] && continue
    desired_set["${ip}"]=1
  done
fi
desired_ips_sorted=$(printf '%s\n' "${!desired_set[@]}" | sort -u | paste -sd, -)

# Resolve the serial hostname early so the short-circuit check can
# compare DNS SANs accurately (serial changes → cert must refresh).
_CHECK_SERIAL=""
if [[ -n "${WPT_SERIAL:-}" ]]; then
  _CHECK_SERIAL="${WPT_SERIAL}"
elif [[ -r /etc/wpt/serial ]]; then
  _CHECK_SERIAL="$(tr -d '\n\r \t' < /etc/wpt/serial 2>/dev/null || true)"
fi
declare -A desired_dns_set=()
desired_dns_set["wpt.local"]=1
desired_dns_set["localhost"]=1
[[ -n "${_CHECK_SERIAL}" ]] && desired_dns_set["wpt-${_CHECK_SERIAL}.local"]=1
desired_dns_sorted=$(printf '%s\n' "${!desired_dns_set[@]}" | sort -u | paste -sd, -)

# Short-circuit: if the existing server cert already covers this exact
# IP + DNS set AND the CA is intact, there is nothing to do.
if [[ "${FORCE}" != "1" && -f "${CA_CERT}" && -f "${CA_KEY}" && -f "${SERVER_CERT}" && -f "${SERVER_KEY}" ]]; then
  current_ips_sorted=$(openssl x509 -in "${SERVER_CERT}" -noout -ext subjectAltName 2>/dev/null \
    | grep -oE 'IP Address:[0-9.]+' \
    | awk -F: '{print $2}' \
    | sort -u \
    | paste -sd, -)
  current_dns_sorted=$(openssl x509 -in "${SERVER_CERT}" -noout -ext subjectAltName 2>/dev/null \
    | grep -oE 'DNS:[A-Za-z0-9.-]+' \
    | awk -F: '{print $2}' \
    | sort -u \
    | paste -sd, -)
  if [[ "${current_ips_sorted}" == "${desired_ips_sorted}" && "${current_dns_sorted}" == "${desired_dns_sorted}" ]]; then
    echo "TLS cert already covers current SANs (DNS: ${desired_dns_sorted}; IPs: ${desired_ips_sorted:-none}); nothing to do."
    exit 0
  fi
  echo "Cert SAN drift detected:"
  echo "  DNS:  have [${current_dns_sorted}] want [${desired_dns_sorted}]"
  echo "  IPs:  have [${current_ips_sorted}] want [${desired_ips_sorted}]"
  echo "Refreshing server cert (CA preserved)."
fi

# DNS SAN entries. Include the device's serial hostname so clients on
# multi-device customer sites can reach the disambiguated wpt-<serial>.local
# without a cert warning. Serial is sourced from /etc/wpt/serial (baked
# at install time) or $WPT_SERIAL env. Missing/unreadable → generic only.
DNS_ENTRIES="DNS.1 = wpt.local"$'\n'"DNS.2 = localhost"
SERIAL=""
if [[ -n "${WPT_SERIAL:-}" ]]; then
  SERIAL="${WPT_SERIAL}"
elif [[ -r /etc/wpt/serial ]]; then
  SERIAL="$(tr -d '\n\r \t' < /etc/wpt/serial 2>/dev/null || true)"
fi
if [[ -n "${SERIAL}" ]]; then
  DNS_ENTRIES+=$'\n'"DNS.3 = wpt-${SERIAL}.local"
fi

# Build the openssl SAN list (numeric entries required by X.509).
ALT_NAMES="${DNS_ENTRIES}"
IP_COUNT=0
while IFS= read -r ip; do
  [[ -z "${ip}" ]] && continue
  IP_COUNT=$((IP_COUNT + 1))
  ALT_NAMES+=$'\nIP.'"${IP_COUNT}"$' = '"${ip}"
done < <(printf '%s\n' "${!desired_set[@]}" | sort -u)

cat > "${OPENSSL_CONFIG}" <<EOF
[ req ]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = dn
req_extensions     = req_ext

[ dn ]
C  = IT
ST = RM
L  = Rome
O  = WPT
OU = Edge
CN = wpt.local

[ req_ext ]
subjectAltName = @alt_names

[ alt_names ]
${ALT_NAMES}
EOF

if [[ ! -f "${CA_CERT}" || ! -f "${CA_KEY}" || "${FORCE}" == "1" ]]; then
  openssl req -x509 -new -nodes -sha256 -days 3650 \
    -newkey rsa:2048 \
    -keyout "${CA_KEY}" \
    -out "${CA_CERT}" \
    -subj "/C=IT/ST=RM/L=Rome/O=WPT/OU=Edge/CN=WPT Local Root CA"
fi

CSR_FILE="${OUTPUT_DIR}/server.csr"
SERIAL_FILE="${OUTPUT_DIR}/wpt-local-ca.srl"

openssl req -new -nodes -newkey rsa:2048 \
  -keyout "${SERVER_KEY}" \
  -out "${CSR_FILE}" \
  -config "${OPENSSL_CONFIG}"

openssl x509 -req -sha256 -days 825 \
  -in "${CSR_FILE}" \
  -CA "${CA_CERT}" \
  -CAkey "${CA_KEY}" \
  -CAcreateserial \
  -CAserial "${SERIAL_FILE}" \
  -out "${SERVER_CERT}" \
  -extensions req_ext \
  -extfile "${OPENSSL_CONFIG}"

rm -f "${CSR_FILE}" "${OPENSSL_CONFIG}"

echo "Generated local CA: ${CA_CERT}"
echo "Generated server cert/key: ${SERVER_CERT} ${SERVER_KEY}"
