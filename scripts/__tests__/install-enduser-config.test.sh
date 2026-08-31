#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/scripts/install-enduser.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "${TMP_DIR}"' EXIT

write_config() {
  local destination="$1" install_dir="$2" serial="$3" password="$4" auto_update="$5"
  {
    printf 'format=1\n'
    printf 'install_dir_base64=%s\n' "$(printf '%s' "${install_dir}" | base64 | tr -d '\n')"
    printf 'device_serial_base64=%s\n' "$(printf '%s' "${serial}" | base64 | tr -d '\n')"
    printf 'admin_password_base64=%s\n' "$(printf '%s' "${password}" | base64 | tr -d '\n')"
    printf 'enable_auto_update=%s\n' "${auto_update}"
  } > "${destination}"
}

expect_rejected() {
  local fixture="$1"
  if load_install_config "${fixture}" 2>/dev/null; then
    echo "invalid config was accepted: ${fixture}" >&2
    exit 1
  fi
}

write_config "${TMP_DIR}/valid.conf" "/opt/wpt-iot" "wpt-0001" "correct horse battery" "false"
load_install_config "${TMP_DIR}/valid.conf"
[[ "${INSTALL_DIR}" == "/opt/wpt-iot" ]]
[[ "${WPT_SERIAL}" == "wpt-0001" ]]
[[ "${ADMIN_PASSWORD}" == "correct horse battery" ]]
[[ "${ENABLE_AUTO_UPDATE}" == "false" ]]

cat > "${TMP_DIR}/unknown.conf" <<'EOF'
format=1
unexpected_key=eHl6
EOF
expect_rejected "${TMP_DIR}/unknown.conf"

cat > "${TMP_DIR}/duplicate.conf" <<'EOF'
format=1
format=1
install_dir_base64=L29wdC93cHQtaW90
device_serial_base64=d3B0LTAwMDE=
admin_password_base64=
enable_auto_update=true
EOF
expect_rejected "${TMP_DIR}/duplicate.conf"

cat > "${TMP_DIR}/missing.conf" <<'EOF'
format=1
install_dir_base64=L29wdC93cHQtaW90
EOF
expect_rejected "${TMP_DIR}/missing.conf"

write_config "${TMP_DIR}/invalid-path.conf" "/" "wpt-0001" "correct horse battery" "true"
expect_rejected "${TMP_DIR}/invalid-path.conf"

write_config "${TMP_DIR}/invalid-serial.conf" "/opt/wpt-iot" "BAD SERIAL" "correct horse battery" "true"
expect_rejected "${TMP_DIR}/invalid-serial.conf"

write_config "${TMP_DIR}/invalid-update.conf" "/opt/wpt-iot" "wpt-0001" "correct horse battery" "sometimes"
expect_rejected "${TMP_DIR}/invalid-update.conf"

cat > "${TMP_DIR}/invalid-base64.conf" <<'EOF'
format=1
install_dir_base64=***not-base64***
device_serial_base64=d3B0LTAwMDE=
admin_password_base64=
enable_auto_update=true
EOF
expect_rejected "${TMP_DIR}/invalid-base64.conf"

help_output="$(bash "${ROOT_DIR}/scripts/install-enduser.sh" --help)"
[[ "${help_output}" == *'Usage: install-enduser.sh'* ]]
[[ "${help_output}" != *'correct horse battery'* ]]

if ! grep -Fq 'DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install' \
  "${ROOT_DIR}/scripts/install-enduser.sh"; then
  echo "apt prerequisites may restart remote network services" >&2
  exit 1
fi

write_config "${TMP_DIR}/new-without-password.conf" "${TMP_DIR}/new-install" "wpt-0001" "" "true"
if bash "${ROOT_DIR}/scripts/install-enduser.sh" --config "${TMP_DIR}/new-without-password.conf" >/dev/null 2>&1; then
  echo "new config-mode install accepted an empty password" >&2
  exit 1
fi
[[ ! -e "${TMP_DIR}/new-without-password.conf" ]]

if bash "${ROOT_DIR}/scripts/install-enduser.sh" --unknown >/dev/null 2>&1; then
  echo "unknown argument was accepted" >&2
  exit 1
fi

echo "install-enduser config tests passed"
