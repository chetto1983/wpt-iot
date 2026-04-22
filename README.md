# WPT Sistema IoT

Industrial IoT system for monitoring and controlling WPT waste processing machines (shredders/dryers). Communicates with ABB AC500 PLCs via UDP, stores time-series data in TimescaleDB, and serves a real-time dashboard accessible on the customer's LAN.

## Quick Start

```bash
git clone <repo-url> && cd wpt-iot
chmod +x setup.sh
./setup.sh          # Production
```

The `setup.sh` flow is for local development and lab use. It handles environment generation, container builds, database initialization, and TimescaleDB retention policies.

After local setup:

| Service    | URL                    |
|------------|------------------------|
| Dashboard  | http://localhost:3001   |
| API        | http://localhost:3000   |
| Database   | localhost:5432          |

For Linux installs that use the compose HTTPS overlay, the user-facing URL is:
- `https://wpt.local` for the app shell and API proxy
- API traffic is same-origin under `https://wpt.local/api`
- first access on a new device must trust the generated local CA before PWA installability will work cleanly
- the CA is exposed by nginx at `https://wpt.local/setup/wpt-local-ca.crt` after the operator proceeds past the initial browser warning once

For customer edge installs, use the single installer entrypoint:

```bash
curl -fsSL https://raw.githubusercontent.com/chetto1983/wpt-iot/master/scripts/install.sh | sudo bash
```

Login: `admin` / password in `.env` (`ADMIN_PASSWORD`)

## Architecture

```
ABB AC500 PLC
  |
  |-- UDP 9090 --> Backend: machine data (326-byte logical payload, PLC pads frames to 328)
  |-- UDP 9091 --> Backend: alarm words (80 bytes, every 1s)
  |-- UDP 9092 <-> Backend: RFID users (handshake)
  |-- UDP 9093 <-> Backend: handshake control
  |
  v
Backend (Fastify 5) --> TimescaleDB (PostgreSQL 17)
  |                         |-- machine_snapshots (hypertable)
  |                         |-- snapshots_5min (continuous aggregate)
  |                         |-- snapshots_1h (continuous aggregate)
  |                         |-- snapshots_1d (continuous aggregate)
  |                         |-- alarm_events, rfid_users, jobs
  |
  +--> WebSocket --> Frontend (Next.js 16)
```

## Tech Stack

| Layer     | Technology                              |
|-----------|-----------------------------------------|
| Runtime   | Node.js 22+, pnpm 9+                   |
| Backend   | Fastify 5, Drizzle ORM, Zod, Pino      |
| Frontend  | Next.js 16 (App Router), React 19       |
| Database  | TimescaleDB (PostgreSQL 17)             |
| Types     | Shared Zod schemas + TypeScript 5.8     |
| Container | Docker Compose                          |

## Monorepo Structure

```
wpt-iot/
  apps/
    backend/        # @wpt/backend  -- Fastify API + UDP listeners + WebSocket
    frontend/       # @wpt/frontend -- Next.js dashboard
  packages/
    types/          # @wpt/types -- shared Zod schemas, enums, interfaces
  docker/
    init-timescaledb.sql  -- extension + retention setup function
  docker-compose.yml
  setup.sh          # One-command deploy script
```

## Development

### Prerequisites

- Node.js 22+
- pnpm 9+
- Docker & Docker Compose v2

### Local Development (Windows)

On Windows, Docker host networking doesn't forward UDP. Run backend locally:

```bash
docker compose up -d db                              # Database only
pnpm -r --filter @wpt/backend run db:push            # Push schema
pnpm -r --filter @wpt/types run build                # Build shared types
pnpm -r --filter @wpt/backend run dev                # Start backend
pnpm -r --filter @wpt/frontend run dev               # Start frontend
```

### Full Docker (Linux)

```bash
./setup.sh            # Everything in containers
./setup.sh --rebuild  # Force rebuild images
```

### Commands

```bash
pnpm install       # Install all dependencies
pnpm build         # Build all packages (types first)
pnpm dev           # Dev mode (all packages concurrent)
pnpm lint          # ESLint all packages
pnpm test          # Run tests (workspace-wide)
```

### Per-package

```bash
pnpm -r --filter @wpt/types run build              # Must build first
pnpm -r --filter @wpt/backend run dev               # Fastify on :3000
pnpm -r --filter @wpt/frontend run dev              # Next.js on :3001
```

## Hardware Sizing

Target edge device: **Pilz IndustrialPI 4** — ARM64 quad Cortex-A72 @ 1.5 GHz, 8 GB RAM, 32 GB eMMC. The device runs wpt-iot as its sole workload (no Node-RED, no other services — clean appliance).

Measured baseline on the sacchi dev VM (x86_64, real PLC at 192.168.0.10, nominal load — 10,508 `machine_snapshots`, 3,253 `cycle_records`):

| Container | CPU idle -> peak | RAM          |
|-----------|------------------|--------------|
| backend   | 0.4% -> 4.4%     | 163 MiB      |
| frontend  | 0.0% -> 0.0%     | 101 MiB      |
| db        | 0.4% -> 6.0%     | 97 MiB       |
| nginx     | 0.0% -> 3.6%     | 14 MiB       |
| mosquitto | 0.4% -> 4.6%     | 8 MiB        |
| **Total** | ~15% of 4 cores  | **~383 MiB** |

Storage footprint: Docker images ~8.3 GB resident, `pgdata` volume 77 MB, other volumes <100 KB.

### Pilz IndustrialPI 4 budget

- **RAM** — stack ~400 MiB + PG `shared_buffers=2 GB` ~= 2.5 GB of 8 GB. Comfortable, ~5 GB free for kernel cache and bursts.
- **Disk** — 32 GB - ~3 GB RPi OS Lite - 8 GB images - 1 GB pgdata headroom - 2 GB swap ~= 18 GB free. Tight but workable; builds must stay off-device.
- **CPU** — sustained ~15% on i7-11850H scales to ~60-75% of 4 A72 cores at the same load. Likely fine at steady state; bench Next.js SSR under 2-3 real operator sessions.

### Pre-ship checklist

1. **Cross-build all images for `linux/arm64`** on a dev box — do not build on the eMMC. Ship via `docker save | load` or a private registry. Verify native deps (pg, bcrypt, pdfmake/canvas) compile for ARM64.
2. **Clean appliance mode**: disable or uninstall Node-RED, OpenWebRX, and any pre-installed snaps on the Pilz image.
3. **PG tuning for 8 GB RAM**: `shared_buffers=2GB`, `effective_cache_size=4GB`, `work_mem=16MB`, `maintenance_work_mem=256MB`.
4. **Filesystem**: place `pgdata` and Docker root on the eMMC (not SD). Enable `fstrim.timer`.
5. **Post-deploy**: `docker system prune -a` to drop dangling layers (~1.3 GB recoverable on a typical build host).
6. **GSM uplink**: not built in — provision an external USB modem or PiBridge cellular module. Sparkplug B payload is Protobuf so the bandwidth envelope is small.

## Data Retention

TimescaleDB manages time-series data with automatic downsampling:

| Tier          | Resolution | Retention  | Rows/year |
|---------------|------------|------------|-----------|
| Raw snapshots | 15 seconds | 30 days    | ~172,800/month |
| 5-min average | 5 minutes  | 90 days    | ~105,120 |
| 1-hour average| 1 hour     | 24 months  | ~8,760   |
| 1-day average | 1 day      | 24 months  | ~365     |
| Alarm history | event rows | 24 months  | workload-dependent |

Compression kicks in after 2 days (~90% storage reduction). Policies run automatically via TimescaleDB background jobs.

Machine raw CSV/PDF reports are intentionally limited to the last 30 days. Longer historical trends must read from the bounded aggregate tiers above.
Alarm history CSV/PDF reports are intentionally limited to the last 24 months, and the backend trims `alarm_events` daily to keep the edge box bounded.

To manually trigger retention setup (runs automatically via `setup.sh`):

```bash
docker compose exec db psql -U wpt -d wpt -c "SELECT setup_timescaledb_retention();"
```

To install the v1.1 energy aggregates used by `/energy`, `/settings/energy`, reconciliation, and the ISO 50001 PDF report:

```bash
docker compose exec db psql -U wpt -d wpt -c "SELECT setup_energy_aggregates();"
```

## UDP Protocol

All values are **Big Endian**. The PLC is master.

| Port | Direction  | Payload     | Interval  |
|------|------------|-------------|-----------|
| 9090 | PLC -> IoT | 326-byte logical payload: 72 INT + 2 DINT + 5 STRING[20]=21B + 3-byte pad + 15 REAL + 6 BYTE; the real PLC pads frames to 328 bytes | 5-15s |
| 9091 | PLC -> IoT | 80 bytes: 40 INT16 alarm words (640 alarms) | 1s |
| 9090 | IoT -> PLC | 96 bytes: job packet with 4 STRING[20]=21B fields plus 6 INT | Handshake |
| 9092 | PLC <> IoT | 1104 bytes both directions: 48 names as STRING[20]=21B + 48 group bytes + 48 enabled bytes | Handshake |
| 9093 | PLC <> IoT | 2 bytes: handshake control | On demand |

Handshake FSM: `IDLE(2) -> REQUEST(255/254) -> ACK(100) -> IDLE(2)`

## Environment Variables

Copy `.env.example` to `.env` (done automatically by `setup.sh`):

| Variable          | Default            | Description                    |
|-------------------|--------------------|--------------------------------|
| `PG_PASSWORD`     | `wpt_dev_password` | PostgreSQL password            |
| `ADMIN_PASSWORD`  | `changeme`         | Dashboard admin login          |
| `SESSION_SECRET`  | (generate random)  | Auth session signing key       |
| `CORS_ORIGIN`     | `http://localhost:3001` in dev, `https://wpt.local` on edge | Allowed CORS origins |
| `SESSION_COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `TRUST_PROXY`     | `false` | Set `true` when TLS terminates at nginx |
| `PORT`            | `3000`             | Backend HTTP port              |

## Roles

| Role        | Access                                    |
|-------------|-------------------------------------------|
| SUPER_ADMIN | Full access, user management              |
| WPT         | All machine fields (43), technical signals |
| CLIENT      | Basic machine fields (18), gauges only     |

## License

Proprietary -- WPT s.r.l.
