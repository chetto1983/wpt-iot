# WPT Sistema IoT

Industrial IoT system for monitoring and controlling WPT waste processing machines (shredders/dryers). Communicates with ABB AC500 PLCs via UDP, stores time-series data in TimescaleDB, and serves a real-time dashboard accessible on the customer's LAN.

## Quick Start

```bash
git clone <repo-url> && cd wpt-iot
chmod +x setup.sh
./setup.sh          # Production
./setup.sh --dev    # + PLC simulator
```

The `setup.sh` flow is for local development and lab use. It handles environment generation, container builds, database initialization, and TimescaleDB retention policies.

After local setup:

| Service    | URL                    |
|------------|------------------------|
| Dashboard  | http://localhost:3001   |
| API        | http://localhost:3000   |
| Simulator  | http://localhost:3002   |
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
ABB AC500 PLC (or simulator)
  |
  |-- UDP 9090 --> Backend: machine data (286 bytes, every 15s)
  |-- UDP 9091 --> Backend: alarm words (80 bytes, every 1s)
  |-- UDP 9092 <-> Backend: RFID users (handshake)
  |-- UDP 9093 <-> Backend: handshake control
  |
  v
Backend (Fastify 5) --> TimescaleDB (PostgreSQL 17)
  |                         |-- machine_snapshots (hypertable)
  |                         |-- snapshots_5min (continuous aggregate)
  |                         |-- snapshots_1h (continuous aggregate)
  |                         |-- alarm_events, rfid_users, jobs
  |
  +--> WebSocket --> Frontend (Next.js 15)
```

## Tech Stack

| Layer     | Technology                              |
|-----------|-----------------------------------------|
| Runtime   | Node.js 22+, pnpm 9+                   |
| Backend   | Fastify 5, Drizzle ORM, Zod, Pino      |
| Frontend  | Next.js 15 (App Router), React 19       |
| Database  | TimescaleDB (PostgreSQL 17)             |
| Simulator | Fastify 5, dgram UDP, Vitest            |
| Types     | Shared Zod schemas + TypeScript 5.8     |
| Container | Docker Compose                          |

## Monorepo Structure

```
wpt-iot/
  apps/
    backend/        # @wpt/backend  -- Fastify API + UDP listeners + WebSocket
    frontend/       # @wpt/frontend -- Next.js dashboard
    simulator/      # @wpt/simulator -- PLC emulator (dev-only)
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

On Windows, Docker host networking doesn't forward UDP. Run backend and simulator locally:

```bash
docker compose up -d db                              # Database only
pnpm -r --filter @wpt/backend run db:push            # Push schema
pnpm -r --filter @wpt/types run build                # Build shared types
pnpm -r --filter @wpt/simulator run dev              # Start simulator
pnpm -r --filter @wpt/backend run dev                # Start backend
pnpm -r --filter @wpt/frontend run dev               # Start frontend
```

### Full Docker (Linux)

```bash
./setup.sh --dev            # Everything in containers
./setup.sh --dev --rebuild  # Force rebuild images
```

### Commands

```bash
pnpm install       # Install all dependencies
pnpm build         # Build all packages (types first)
pnpm dev           # Dev mode (all packages concurrent)
pnpm lint          # ESLint all packages
pnpm test          # Run tests (simulator)
```

### Per-package

```bash
pnpm -r --filter @wpt/types run build              # Must build first
pnpm -r --filter @wpt/backend run dev               # Fastify on :3000
pnpm -r --filter @wpt/frontend run dev              # Next.js on :3001
pnpm -r --filter @wpt/simulator run dev             # Simulator on :3002
pnpm -r --filter @wpt/simulator run test            # Vitest
```

## Data Retention

TimescaleDB manages time-series data with automatic downsampling:

| Tier          | Resolution | Retention  | Rows/year |
|---------------|------------|------------|-----------|
| Raw snapshots | 15 seconds | 30 days    | ~172,800/month |
| 5-min average | 5 minutes  | indefinite | ~105,120 |
| 1-hour average| 1 hour     | indefinite | ~8,760   |

Compression kicks in after 2 days (~90% storage reduction). Policies run automatically via TimescaleDB background jobs.

To manually trigger retention setup (runs automatically via `setup.sh`):

```bash
docker compose exec db psql -U wpt -d wpt -c "SELECT setup_timescaledb_retention();"
```

## UDP Protocol

All values are **Big Endian**. The PLC is master.

| Port | Direction  | Payload     | Interval  |
|------|------------|-------------|-----------|
| 9090 | PLC -> IoT | 286 bytes: 72 INT + 2 DINT + 5 STRING[20] + 7 REAL + 6 BYTE | 15s |
| 9091 | PLC -> IoT | 80 bytes: 40 INT16 alarm words (640 alarms) | 1s |
| 9092 | PLC <> IoT | 1056 bytes: 48 RFID users | Handshake |
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
