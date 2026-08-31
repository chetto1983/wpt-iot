# `create-wpt-iot` Acceptance

Date: 2026-08-31

Verdict: **PASS** for the supported remote `linux/amd64` path.

## Artifact and target

- CLI: `create-wpt-iot@0.1.0`
- Runtime commit under test: `b58bb4ac23807bb628d82027a5e6f97487329711`
- Manifest gate: compiled ref and local installer SHA-256 matched; the raw GitHub installer at that ref was downloaded and matched the same SHA-256.
- Operator: Windows with native OpenSSH 9.5 and native `scp`.
- Disposable target: Ubuntu 26.04 LTS, `x86_64`, apt/systemd, `/opt/wpt-iot`.
- Before the fresh run, all pre-existing containers, images, build cache, Docker volumes, and WPT state were removed from the disposable target. The cleanup removed 16 containers and 22 volumes and reclaimed approximately 27.2 GB. It is not recoverable.

## Fresh install

- The remote wizard accepted native SSH and sudo password prompts and kept the application administrator password masked.
- The first prerequisite install exposed a target-specific conflict between NetworkManager and systemd-networkd: `needrestart` recycled networkd and withdrew the Ethernet address. The target journal identified the exact restart. Commit `b58bb4a` sets `NEEDRESTART_MODE=l`, preventing apt from recycling network/SSH services during a remote install.
- The clean installation completed all seven installer steps and started backend, frontend, PostgreSQL, Mosquitto, and nginx.
- Independent `docker compose ps` output reported all five services `running` and `healthy`.
- HTTPS through the generated CA returned status `200` for `https://wpt.local/` using `--resolve wpt.local:443:127.0.0.1`.
- Admin login succeeded as `SUPER_ADMIN`; the API returned application timezone `Europe/Rome`.
- `/api/health` reported PostgreSQL connected. Overall status was `degraded` only because this disposable target had no PLC and therefore no live machine data.
- PostgreSQL `SHOW timezone` returned `UTC`.
- No `create-wpt-iot-*` temporary file remained on the target. The captured installer and systemd logs contained no application administrator password.
- PLC, MQTT and application settings retained their frontend defaults; no PLC was connected for this acceptance run.

Sanitized service evidence:

```text
mosquitto|running|healthy|eclipse-mosquitto:2.0.22
backend|running|healthy|ghcr.io/chetto1983/wpt-backend:latest
db|running|healthy|timescale/timescaledb:2.26.3-pg17
frontend|running|healthy|ghcr.io/chetto1983/wpt-frontend:latest
nginx|running|healthy|nginx:1.28.3-alpine
HTTPS_STATUS=200
DB_TIMEZONE=UTC
```

## Reinstall and persistence

- The exact packed CLI detected the existing installation and did not request or replace the administrator password.
- The device serial was normalized to `225`, producing `wpt-225.local`; a supplied `wpt-` prefix is now normalized by the wizard to prevent `wpt-wpt-...` hostnames.
- The reinstall preserved the PostgreSQL volume and the complete `.env`, which also proves that `SECRETS_ENCRYPTION_KEY` was not rotated.

```text
PGDATA_NAME=wpt-iot_pgdata
PGDATA_CREATED=2026-08-31T14:24:35Z
PGDATA_MOUNTPOINT=/var/lib/docker/volumes/wpt-iot_pgdata/_data
ENV_SHA256_BEFORE=a0f19d8b63e75396103f09d8be8c86abb736a89d46237c2a0d6c27f8f79cfb3d
ENV_SHA256_AFTER =a0f19d8b63e75396103f09d8be8c86abb736a89d46237c2a0d6c27f8f79cfb3d
```

## Automatic update

- `wpt-image-update.timer` was `enabled` and `active` immediately after installation.
- A manual `systemctl start wpt-image-update.service` exited with `status=0/SUCCESS`.
- The update verified all migrations and `7 continuous aggregates`, synchronized the TimescaleDB runtime SQL, and left backend/frontend healthy.

Image IDs after the update:

```text
backend   sha256:3cfd5d2fdb3e472c28e544c7eea4b8a6028ac1748562f4e2616861110dc9d343
frontend  sha256:d78f56db13fd8884ac85700146f514cd15f0a5cc7f9c39ec97858b14540ea7ce
db        sha256:54b5ad8328e2ec9a576d4ccdbaeeb790c0319fa65e3fccdd5df887ff3bc8de91
mosquitto sha256:212f89e1eaeb2c322d6441b64396e3346026674db8fa9c27beac293405c32b3c
nginx     sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236
```

## Unsupported-target guard

A live Raspberry Pi 2 Model B running 32-bit Raspbian 10 (`armv7l`) was also tested. The wizard accepted native SSH authentication, rejected the unsupported architecture before artifact download/transfer/install, and left `/opt/wpt-iot` absent with no installer temporary files.
