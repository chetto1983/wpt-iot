#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:-certs}"
LAN_IP="${2:-}"
FORCE="${FORCE:-0}"

CA_CERT="${OUTPUT_DIR}/wpt-local-ca.crt"
CA_KEY="${OUTPUT_DIR}/wpt-local-ca.key"
SERVER_CERT="${OUTPUT_DIR}/server.crt"
SERVER_KEY="${OUTPUT_DIR}/server.key"
OPENSSL_CONFIG="${OUTPUT_DIR}/openssl-san.cnf"

mkdir -p "${OUTPUT_DIR}"

if [[ -f "${CA_CERT}" && -f "${CA_KEY}" && -f "${SERVER_CERT}" && -f "${SERVER_KEY}" && "${FORCE}" != "1" ]]; then
  echo "TLS assets already exist in ${OUTPUT_DIR}; skipping generation."
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate local TLS assets." >&2
  exit 1
fi

ALT_NAMES=$'DNS.1 = wpt.local\nDNS.2 = localhost\nIP.1 = 127.0.0.1'
# LAN_IP accepts a comma-separated list so a multi-homed edge box gets a
# single cert valid for every LAN interface (e.g. "192.168.0.10,192.168.101.151").
if [[ -n "${LAN_IP}" ]]; then
  IP_COUNT=1
  IFS=',' read -ra IPS <<< "${LAN_IP}"
  for ip in "${IPS[@]}"; do
    ip="${ip// /}"
    [[ -z "${ip}" ]] && continue
    IP_COUNT=$((IP_COUNT + 1))
    ALT_NAMES+=$'\nIP.'"${IP_COUNT}"$' = '"${ip}"
  done
fi

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
