#!/usr/bin/env bash
# Pull and apply the latest WPT application images on an edge installation.
# The backend performs the complete repository-owned DB bootstrap before it
# becomes healthy. Database data, Mosquitto and nginx are never replaced here.

set -Eeuo pipefail

[[ -f /etc/default/wpt-iot ]] && source /etc/default/wpt-iot

INSTALL_DIR="${INSTALL_DIR:-/opt/wpt-iot}"
LOCK_FILE="${WPT_IMAGE_UPDATE_LOCK:-/run/lock/wpt-image-update.lock}"
HEALTH_TIMEOUT_SECONDS="${WPT_IMAGE_UPDATE_HEALTH_TIMEOUT:-600}"

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

verify_database_bootstrap() {
  local aggregate_count
  aggregate_count="$(
    docker compose exec -T db sh -ec \
      'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq' <<'SQL'
WITH expected_views(view_name) AS (
  VALUES
    ('snapshots_5min'), ('snapshots_1h'), ('snapshots_1d'),
    ('energy_5min'), ('energy_1h'), ('energy_1d'), ('energy_1mo')
)
SELECT COUNT(*)
FROM expected_views
INNER JOIN timescaledb_information.continuous_aggregates USING (view_name);
SQL
  )"
  aggregate_count="${aggregate_count//[[:space:]]/}"
  if [[ "${aggregate_count}" != '7' ]]; then
    echo "Database bootstrap incomplete: expected 7 continuous aggregates, found ${aggregate_count:-0}." >&2
    return 1
  fi
  echo "Database bootstrap verified: 7 continuous aggregates installed."
}

sync_runtime_sql() {
  local runtime_sql_tmp
  mkdir -p docker
  runtime_sql_tmp="$(mktemp "${INSTALL_DIR}/docker/.init-timescaledb.sql.XXXXXX")"
  if ! docker compose cp backend:/app/docker/init-timescaledb.sql "${runtime_sql_tmp}"; then
    rm -f "${runtime_sql_tmp}"
    echo "Unable to copy the runtime TimescaleDB SQL from the backend image." >&2
    return 1
  fi
  if [[ ! -s "${runtime_sql_tmp}" ]] \
    || ! grep -q 'CREATE OR REPLACE FUNCTION setup_timescaledb_retention()' "${runtime_sql_tmp}" \
    || ! grep -q 'CREATE OR REPLACE FUNCTION setup_energy_aggregates()' "${runtime_sql_tmp}"; then
    rm -f "${runtime_sql_tmp}"
    echo "Backend image contains an invalid TimescaleDB runtime SQL asset." >&2
    return 1
  fi
  chmod 0644 "${runtime_sql_tmp}"
  mv -f "${runtime_sql_tmp}" docker/init-timescaledb.sql
  echo "Host TimescaleDB runtime SQL synchronized from the backend image."
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

# Backend health is only exposed after every Drizzle/runtime migration and all
# Timescale setup/backfill operations finish. Verify the resulting DB objects
# explicitly, then keep the host bootstrap asset current for future DB volumes.
verify_database_bootstrap
sync_runtime_sql

backend_after="$(container_image_id backend)"
frontend_after="$(container_image_id frontend)"

echo "backend: ${backend_before} -> ${backend_after}"
echo "frontend: ${frontend_before} -> ${frontend_after}"

# Remove only untagged images left behind by a successful replacement.
docker image prune --force >/dev/null
echo "WPT image update completed; backend and frontend are healthy."
