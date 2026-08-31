# WPT IoT Production Runbook

How to install, update, debug, and roll back `wpt-iot` on customer machines.
The production layout is:
- `https://wpt.local` for the frontend
- `https://wpt.local/api` for the API and websocket
- nginx terminates TLS on the edge machine
- the backend still runs with `network_mode: host` so PLC UDP reaches it

> **Related:** for field-deploy procedures (CODESYS flash, wire-verify, digest rollback,
> pre-flash `.EXP` commit rule) see
> [../../.planning/runbooks/deploy-runbook.md](../../.planning/runbooks/deploy-runbook.md).
> That runbook covers what happens AFTER install.sh has placed a working stack on the edge
> device; this runbook covers install + operational procedures.

## Provision a New Customer Machine

The recommended path is the interactive installer from a workstation with Node.js 22.13+:

```console
npx create-wpt-iot
```

Choose local mode when the command runs directly on the Linux target. Choose remote mode from Windows or Linux; it uses the workstation's native `ssh` and `scp`, and their normal password/host-key prompts. The wizard installs one target per run.

Supported target prerequisites:

- 64-bit Debian/Raspberry Pi OS/Ubuntu with `apt`, `systemd`, `sudo`, and `curl`;
- `linux/arm64` or `linux/amd64` architecture;
- at least 12 GiB free;
- network access to GitHub, GHCR, Docker, and the OS package repositories;
- a LAN IP reachable by operator devices.

Node.js is not required on a remote target. For a new install, the wizard asks twice for a hidden 12+ character application administrator password. SSH and remote sudo may separately ask for the Linux user's password more than once.

The direct Linux Bash fallback remains available:

```bash
curl -fsSL https://raw.githubusercontent.com/chetto1983/wpt-iot/master/scripts/install.sh | sudo bash
```

For an air-gapped target, run `scripts/build-bundle.sh` on an Internet-connected Linux host, transfer and extract the resulting tarball, then run:

```bash
sudo bash install-offline.sh
```

These are three distinct entrypoints:

```text
Guided local/remote online install: npx create-wpt-iot
Direct Linux Bash fallback:         scripts/install.sh
Air-gapped bundle install:          scripts/install-offline.sh
```

What it does:
1. Installs Docker Engine + Compose v2 if missing.
2. Stops conflicting host services such as Grafana and host Mosquitto.
3. Downloads the single `docker-compose.yml`, nginx template, and TLS helper into `/opt/wpt-iot`.
4. Publishes `wpt.local` over mDNS with Avahi.
5. Generates `.env` with random secrets if needed.
6. Generates a local CA plus the server cert for `wpt.local`.
7. Builds / pulls images and starts the stack with `docker compose up -d`.
8. Verifies backend health, nginx health, and the HTTPS frontend.

After install:
- app: `https://wpt.local`
- API: `https://wpt.local/api/health`
- local CA: `/opt/wpt-iot/certs/wpt-local-ca.crt`
- CA download URL: `https://wpt.local/setup/wpt-local-ca.crt`

Important: client devices must trust `/opt/wpt-iot/certs/wpt-local-ca.crt` or the browser will reject the certificate and the PWA secure-context checks will still fail.

After the first login, configure the PLC address/byte order, MQTT/Sparkplug, application timezone, energy settings, and users in the frontend. The installer intentionally does not configure or overwrite them. PostgreSQL remains configured in UTC; the selected application timezone is applied only when accepting or displaying dates.

Automatic backend/frontend image updates are enabled by default. They preserve the database, uploads, credentials, certificates, Mosquitto, nginx, and Docker volumes. On the target:

```bash
sudo systemctl status wpt-image-update.timer
sudo systemctl start wpt-image-update.service
sudo systemctl status --no-pager wpt-image-update.service
sudo systemctl disable --now wpt-image-update.timer
sudo systemctl enable --now wpt-image-update.timer
```

The wizard can explicitly disable the timer during installation. Reinstalling does not replace an existing `.env`, `SECRETS_ENCRYPTION_KEY`, database, uploads, or volumes.

## Pilz IndustrialPI 4 (ARM64) Deployment

The Pilz IndustrialPI 4 (RPi 4 SoC, Quad Cortex-A72 1.5 GHz, 8 GB RAM, 32 GB eMMC, RPi OS with real-time patches) is the current target hardware for customer edge boxes. This section covers the ARM64-specific steps on top of the `## Provision a New Customer Machine` flow above.

### Prerequisites on RPi OS

- RPi OS 64-bit (Bookworm or newer). 32-bit is NOT supported (containers assume `linux/arm64`).
- Docker Engine + Compose v2 installed. `install.sh` handles this if missing.
- At least 12 GB free on the eMMC before install (images + working headroom — see disk budget below).
- LAN access to `ghcr.io` (or a bundle tarball delivered via USB/scp if the site is air-gapped).
- `wpt.local` mDNS resolution (Avahi) — same as the x86 path.

### Image pull flow (online install)

`docker compose pull` selects the ARM64 variant of each image automatically based on the host arch — no `--platform` flag required on the edge. The multi-arch manifests produced by the CI workflow in `.github/workflows/docker-build.yml` carry both `linux/amd64` and `linux/arm64` entries, so the same `:latest` / `:sha-<short>` tag resolves correctly on both amd64 bench hosts and the arm64 Pilz.

### Bundle install (air-gapped site)

The ship path for air-gapped customers is `scripts/build-bundle.sh` on an internet-connected golden-master host, followed by `scp` + `install.sh` on the Pilz. When targeting the Pilz from an amd64 golden-master, run:

```bash
TARGET_ARCH=arm64 bash scripts/build-bundle.sh
```

This pulls the `linux/arm64` variant of `timescale/timescaledb:2.25.2-pg17`, `eclipse-mosquitto:2.0.22`, and `nginx:1.28.3-alpine` before `docker save`. The resulting tarball's `VERSION` file records `target_arch: arm64`; `install.sh` on the Pilz sanity-checks this value before `docker load`.

**Do NOT run `TARGET_ARCH=arm64` on an amd64 host for the backend/frontend images** — `docker compose build` produces the host arch regardless of pull platform. Backend and frontend arm64 images should be pulled from GHCR (CI-produced) or built on a native arm64 host (the Pilz itself).

### PG tuning env-var overrides for 8 GB RAM

The compose file's db service uses env-var substitution for Postgres runtime parameters; defaults are bench/dev-safe (small). On the Pilz, uncomment these lines in `/opt/wpt-iot/.env` before starting the stack:

```
PG_SHARED_BUFFERS=2GB
PG_WORK_MEM=16MB
PG_EFFECTIVE_CACHE_SIZE=5GB
PG_MAINTENANCE_WORK_MEM=512MB
PG_SYNCHRONOUS_COMMIT=off
```

Rationale:
- `shared_buffers=2GB` — 25% of 8 GB RAM, within mainstream Postgres guidance. Leaves ~4 GB for the Node backend (~500 MB), Next frontend server (~300 MB), nginx, mosquitto, OS, and working memory.
- `work_mem=16MB` / `effective_cache_size=5GB` — reflect the available RAM headroom on the Pilz.
- `synchronous_commit=off` — eMMC wear mitigation. Up to `~1 s` of committed transactions may be lost if the Pilz loses power before WAL fsync. Acceptable because dense raw telemetry is still a rolling 30-day window; the 2-year history lives in bounded aggregate tiers (`snapshots_1h`, `snapshots_1d`, `energy_1h`, `energy_1d`) rather than in raw packets.

Note: `wal_level` is intentionally NOT overridden. The TimescaleDB default (`replica`) is required for continuous aggregates, which back the v1.1 energy module (`setup_energy_aggregates()`).

If you observe `OOMKilled` / exit 137 on the backend or frontend containers under load, lower `PG_SHARED_BUFFERS` to `1.5GB` and retry. Final numbers will be measured on DEPLOY-F01.

### eMMC 32 GB disk budget (estimated, to be measured on DEPLOY-F01)

| Component                                                  | Estimated size |
|------------------------------------------------------------|----------------|
| RPi OS base                                                | ~4 GB          |
| Docker engine + five images (db, mosquitto, backend, frontend, nginx) | ~4 GB |
| PostgreSQL data (30d raw + 90d 5min + 24mo 1h/1d aggregates + 24mo alarm_events + cycle_records) | ~8 GB target ceiling |
| Logs (json-file rotated, 10 MB × 3 files × ~6 services)    | ~200 MB        |
| System headroom / swap / apt cache                         | ~4 GB          |
| Working headroom (remainder)                               | ~10–12 GB      |

These numbers are estimates derived from current bench measurements; real values will be captured and updated during DEPLOY-F01 on physical Pilz hardware.

### Manifest verification record

The CI-built `wpt-backend` and `wpt-frontend` multi-arch manifests are produced fresh on every master push (see `.github/workflows/docker-build.yml`). The three pinned third-party images and the watchtower candidate were verified 2026-04-15:

| Image                                    | Pinned tag           | linux/arm64 digest (recorded) |
|------------------------------------------|----------------------|-------------------------------|
| `timescale/timescaledb`                  | `2.25.2-pg17`        | `sha256:d57a1cb97e478fd8963d037e5355e933247d423dcf9f2bcdb8d578026c21dcb2` |
| `eclipse-mosquitto`                      | `2.0.22`             | `sha256:092b2db87a7b65b9e8f70652c94267a3fa4f062048368ba3794327a1e5626d02` |
| `nginx`                                  | `1.28.3-alpine`      | (pre-existing pin; arm64 manifest confirmed) |
| `containrrr/watchtower` (verify-only)    | `1.7.1`              | `sha256:f14f090fcc8235449da45ccbb1aea3b424ed3b101bcbd3de56526909397c2369` |

Watchtower is NOT part of the current compose stack (the ship path is bundle deploy + future Mender). The manifest verification above is recorded so a later adoption phase can move fast.

Verification command for future updates:

```bash
docker buildx imagetools inspect <image>:<tag> --format '{{range .Manifest.Manifests}}{{.Platform.OS}}/{{.Platform.Architecture}} {{.Digest}}{{"\n"}}{{end}}'
```

### Known-issue notes

- Free `ubuntu-24.04-arm` GitHub Actions runners are public-repos-only (since 2025-01). If the repository is ever made private, CI multi-arch builds require a paid runner label or a QEMU fallback (which re-introduces the Next.js/SWC hang — avoid).
- `network_mode: host` works identically on `linux/arm64` and `linux/amd64` Docker engines — no arch-specific code paths in the backend UDP listeners.

## GHCR Authentication

If the GHCR images are public, skip this section.

If they are private:

```bash
echo <PAT> | sudo docker login ghcr.io -u <github-username> --password-stdin
sudo mkdir -p /etc/watchtower/config
sudo cp ~/.docker/config.json /etc/watchtower/config/
```

Use a token with `read:packages`.

## Push a Release

Push to `master`:

```bash
git add ...
git commit -m "feat: ..."
git push origin master
```

The shipping path is a full bundle rebuild on the golden-master host
(`scripts/auto-deploy.sh` or `scripts/build-bundle.sh` + `scp` + remote
`sudo bash install.sh`). The frontend image is **same-origin** — no
`NEXT_PUBLIC_API_URL` bake — so a single image works on any customer
LAN regardless of hostname or IP. OTA automation (Mender) is the
planned path forward; watchtower is no longer part of the stack.

### Publish `create-wpt-iot`

Do not publish the installer until the supported-device acceptance checklist in `docs/deployment/create-wpt-iot-acceptance.md` is complete and committed.

The npm registry requires a package to exist before a trusted publisher can be attached to it. Therefore the one-time bootstrap for this currently unclaimed package name is:

1. From the accepted, clean commit, run all installer checks and install npm 11.15 or newer.
2. Publish the first version manually from a 2FA-authenticated maintainer session.
3. Immediately configure the GitHub Actions trusted publisher and verify it.
4. Restrict package publishing access to require 2FA and disallow traditional tokens.

```bash
npm install --global "npm@^11.15.0"
npm login
npm publish ./packages/create-wpt-iot --access public --provenance=false
npm trust github create-wpt-iot --file create-wpt-iot.yml --repo chetto1983/wpt-iot --allow-publish
npm trust list create-wpt-iot
```

The bootstrap commands require an interactive 2FA challenge and must never be placed in CI. They do not require or create a repository secret. After bootstrap, bump the package version and publish only by pushing a matching tag:

```bash
git tag installer-v<package-version>
git push origin installer-v<package-version>
```

`.github/workflows/create-wpt-iot.yml` verifies Windows and Ubuntu first, checks that the tag exactly matches `package.json`, and publishes from a GitHub-hosted runner using OIDC with provenance. The trusted-publisher workflow filename must be exactly `create-wpt-iot.yml`.

The installer manifest is not maintained by hand. Every package `build` and `prepack` stamps the current immutable Git commit and the SHA-256 of `scripts/install-enduser.sh`, then verifies both values. Before a tagged publish, CI also downloads that exact raw GitHub artifact and rejects the release if its bytes do not match the stamped hash.

## Automatic Database Bootstrap

There is no manual post-deploy energy step. Before opening its HTTP port, every
backend image runs the complete repository migration chain:

1. all tracked Drizzle migrations;
2. all idempotent runtime schemas (MQTT, energy, baselines, anomaly, PLC,
   application settings, and the V03 machine schema);
3. the bundled TimescaleDB setup SQL;
4. all seven `snapshots_*` and `energy_*` continuous aggregates;
5. a one-time bounded backfill when any aggregate is empty;
6. a final aggregate-count verification.

The backend does not become healthy if any step fails. Consequently,
`wpt-image-update.service` fails and its timer retries without deleting the
PostgreSQL volume. PostgreSQL stays configured with `timezone=UTC`.

For diagnostics, the setup functions can still be retried manually:

```bash
docker compose exec db psql -U wpt -d wpt -c "SELECT setup_energy_aggregates();"
```

The updater also verifies that all seven aggregates exist and synchronizes the
SQL asset embedded in the backend image back to
`/opt/wpt-iot/docker/init-timescaledb.sql` for future fresh volumes.

## Retention Verification

After a deploy, DB restore, or retention-policy change, verify both the Timescale jobs and the plain-table alarm cleanup horizon:

```bash
docker compose exec db psql -U wpt -d wpt -c "
WITH jobs AS (
  SELECT
    j.proc_name,
    j.schedule_interval,
    j.config,
    COALESCE((j.config->>'mat_hypertable_id')::int, (j.config->>'hypertable_id')::int) AS target_id
  FROM timescaledb_information.jobs j
  WHERE j.proc_name IN ('policy_retention','policy_refresh_continuous_aggregate','policy_compression')
)
SELECT
  jobs.proc_name,
  COALESCE(c.view_name, h.table_name) AS target,
  jobs.schedule_interval,
  jobs.config
FROM jobs
LEFT JOIN _timescaledb_catalog.hypertable ht
  ON ht.id = jobs.target_id
LEFT JOIN timescaledb_information.continuous_aggregates c
  ON c.materialization_hypertable_schema = ht.schema_name
 AND c.materialization_hypertable_name = ht.table_name
LEFT JOIN information_schema.tables h
  ON h.table_schema = ht.schema_name
 AND h.table_name = ht.table_name
ORDER BY jobs.proc_name, target;
"
```

Expected targets:
- `machine_snapshots`: retention `30 days`, compression `2 days`
- `snapshots_5min`, `energy_5min`: retention `90 days`
- `snapshots_1h`, `snapshots_1d`, `energy_1h`, `energy_1d`, `energy_1mo`: retention `2 years`
- `machine_anomaly_events_shadow`: retention `30 days`, compression `2 days`

`alarm_events` is not a Timescale hypertable. It is trimmed by the backend once at startup and then every 24 hours, deleting rows with `activated_at < now() - interval '24 months'`.

## Storage Measurement

Capture actual PostgreSQL footprint after 24-48h of realistic ingest on the Pilz:

```bash
docker compose exec db psql -U wpt -d wpt -c "
SELECT
  relname AS relation,
  pg_size_pretty(pg_total_relation_size(oid)) AS total_size
FROM pg_class
WHERE relname IN (
  'machine_snapshots',
  'snapshots_5min',
  'snapshots_1h',
  'snapshots_1d',
  'energy_5min',
  'energy_1h',
  'energy_1d',
  'energy_1mo',
  'alarm_events',
  'cycle_records'
)
ORDER BY pg_total_relation_size(oid) DESC;
"
```

Also record WAL pressure:

```bash
docker compose exec db psql -U wpt -d wpt -c "
SELECT
  pg_size_pretty(sum(size)) AS total_wal
FROM pg_ls_waldir();
"
```

## Roll Back a Machine

Roll back by re-shipping the last known-good bundle (keeps the shipping
pipeline linear — no divergent per-machine image tags):

```bash
# On the golden-master host
ls -la /var/lib/wpt-deploy/bundles/
# pick the previous bundle, e.g. wpt-iot-bundle-<older-sha>-<ts>.tar.gz

scp /var/lib/wpt-deploy/bundles/<older>.tar.gz sacchi@<edge>:/tmp/
ssh sacchi@<edge> "cd /tmp && tar xzf <older>.tar.gz && cd <older> && sudo bash install.sh"
```

Watchtower has been removed from the stack — there are no automatic
pulls to stop during investigation.

## Set the Customer PLC IP

Preferred path:
1. Open `https://wpt.local`
2. Log in as admin
3. Go to `/plc`
4. Enter the ABB AC500 IP and save

The PLC target lives in the database, not in `.env`.

## Debugging

Basic health:

```bash
ssh <machine>
curl -s http://127.0.0.1:3000/health | jq
curl -s http://127.0.0.1/nginx-health
curl --cacert /opt/wpt-iot/certs/wpt-local-ca.crt --resolve wpt.local:443:127.0.0.1 https://wpt.local/
```

Logs:

```bash
docker ps -a
docker logs wpt-iot-backend-1 --tail 100
docker logs wpt-iot-frontend-1 --tail 100
docker logs wpt-iot-nginx-1 --tail 100
docker logs watchtower --tail 100
```

MQTT log after auth:

```bash
COOKIE=/tmp/c
curl -s -c $COOKIE -X POST http://127.0.0.1:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<pwd>"}'
curl -s -b $COOKIE http://127.0.0.1:3000/api/mqtt/log | jq
```

PLC traffic:

```bash
sudo tcpdump -i <iface> -n 'udp and port 9090 or port 9091' -c 5
```

## Common Gotchas

1. Trust the local CA on client devices. Without that, HTTPS exists but the browser will not treat the origin as trustworthy enough for service workers and PWA installability.
2. `network_mode: host` on the backend is mandatory. Do not move the backend back to bridge networking if the machine talks to a real PLC.
3. Access the app through nginx (`https://wpt.local` or `https://<LAN_IP>`), not the raw frontend container port. The frontend image is **IP/host-agnostic** (same-origin via nginx) so it works for any hostname the customer routes to it, but only through the TLS terminator.
4. Use `npx create-wpt-iot` for guided online installs. `scripts/install.sh` is the direct Linux fallback; `install-offline.sh` is used only inside an air-gapped bundle. `install-prod.sh` remains an internal helper.
5. `wpt.local` depends on mDNS. If the client is on another VLAN or routed network, either fix name resolution or deploy real DNS with matching certificates.
