#!/usr/bin/env bash
# Pull and apply the latest WPT application images on an edge installation.
# Database, Mosquitto and nginx stay pinned and are never touched by this job.

set -Eeuo pipefail

[[ -f /etc/default/wpt-iot ]] && source /etc/default/wpt-iot

INSTALL_DIR="${INSTALL_DIR:-/opt/wpt-iot}"
LOCK_FILE="${WPT_IMAGE_UPDATE_LOCK:-/run/lock/wpt-image-update.lock}"
HEALTH_TIMEOUT_SECONDS="${WPT_IMAGE_UPDATE_HEALTH_TIMEOUT:-120}"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Another WPT image update is already running; skipping."
  exit 0
fi

cd "${INSTALL_DIR}"
[[ -f docker-compose.yml ]] || {
  echo "Missing ${INSTALL_DIR}/docker-compose.yml" >&2
  exit 1
}

container_image_id() {
  local container_id
  container_id="$(docker compose ps -q "$1")"
  if [[ -z "${container_id}" ]]; then
    printf 'missing'
    return
  fi
  docker inspect --format '{{.Image}}' "${container_id}"
}

service_is_healthy() {
  local container_id state health
  container_id="$(docker compose ps -q "$1")"
  [[ -n "${container_id}" ]] || return 1

  state="$(docker inspect --format '{{.State.Status}}' "${container_id}")"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${container_id}")"
  [[ "${state}" == 'running' && ( "${health}" == 'healthy' || "${health}" == 'none' ) ]]
}

backend_before="$(container_image_id backend)"
frontend_before="$(container_image_id frontend)"

docker compose pull backend frontend
docker compose up -d --no-deps backend frontend

deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
until service_is_healthy backend && service_is_healthy frontend; do
  if (( SECONDS >= deadline )); then
    echo "WPT containers did not become healthy within ${HEALTH_TIMEOUT_SECONDS}s" >&2
    docker compose ps backend frontend >&2
    exit 1
  fi
  sleep 2
done

backend_after="$(container_image_id backend)"
frontend_after="$(container_image_id frontend)"

echo "backend: ${backend_before} -> ${backend_after}"
echo "frontend: ${frontend_before} -> ${frontend_after}"

# Remove only untagged images left behind by a successful replacement.
docker image prune --force >/dev/null
echo "WPT image update completed; backend and frontend are healthy."
