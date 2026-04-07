# WPT IoT Production Runbook

How to install, update, debug, and roll back wpt-iot on customer machines.
The model is: **CI builds and pushes images to GHCR; each customer machine
runs `watchtower` and pulls updates automatically every 5 minutes**.

## Architecture

```
[ master push ] → [ GitHub Actions ] → [ ghcr.io/<owner>/wpt-{backend,frontend}:latest ]
                                                          │
                                            ┌─────────────┼─────────────┐
                                            ▼             ▼             ▼
                                       [ machine 1 ] [ machine 2 ] ... [ machine N ]
                                       watchtower polls every 300s,
                                       pulls new images, recreates
                                       only labelled containers.
```

Two scripts, two purposes:

| Script | Purpose | Builds locally? | Needs git clone? |
|---|---|---|---|
| `scripts/install-linux.sh` | Dev / staging VM | YES (`docker build`) | YES (whole repo) |
| `scripts/install-prod.sh` | Customer machine | NO (pulls from GHCR) | NO (just three compose files via curl) |

---

## 1. Provision a new customer machine

Fresh Ubuntu 22.04 / 24.04 install with:
- Docker NOT yet installed (we'll install it)
- Network access to GitHub + ghcr.io
- A LAN IP that other devices can reach (the customer's local network)

Run **as root** from the new machine:

```bash
curl -fsSL https://raw.githubusercontent.com/chetto1983/wpt-iot/master/scripts/install-prod.sh | sudo bash
```

What it does, in order:
1. Installs Docker Engine + Compose v2 (via `get.docker.com` if missing).
2. Stops conflicting host services (snap mosquitto, grafana on :3000).
3. Installs `avahi-daemon` and publishes `wpt.local` as an alias of the host.
4. Creates `/opt/wpt-iot` and curls down `docker-compose.yml`,
   `docker-compose.prod.yml`. Generates `docker-compose.host.yml` locally
   (LAN IP varies per machine).
5. Generates `.env` with random `SESSION_SECRET`, `PG_PASSWORD`, and
   `ADMIN_PASSWORD` (or uses `ADMIN_PASSWORD=...` if set in env).
6. `docker compose pull` from GHCR, then `up -d`.
7. Health-checks backend `/health` and frontend `/`.
8. Prints the admin password and the LAN URLs.

After this, the machine is reachable at:
- `http://wpt.local:3001` from any LAN client with mDNS support
  (Bonjour on Windows / iOS, `avahi-resolve` on Linux)
- `http://<LAN_IP>:3001` for clients without mDNS

The `ADMIN_PASSWORD` is **only stored in `/opt/wpt-iot/.env`** — back it up
to your password manager during the install.

### One-time GHCR auth (only if images are private)

If `ghcr.io/<owner>/wpt-backend:latest` is **public**, skip this step. If it's
private, every machine needs to authenticate before `docker compose pull`
will succeed:

```bash
# Generate a Personal Access Token at https://github.com/settings/tokens
# with `read:packages` scope only. Then on the customer machine:
echo <PAT> | sudo docker login ghcr.io -u <github-username> --password-stdin
```

After login, `docker login` writes credentials to `~/.docker/config.json`.
The watchtower service in `docker-compose.prod.yml` mounts
`/etc/watchtower/config/` as `DOCKER_CONFIG=/config`, so put a copy of the
config there:

```bash
sudo mkdir -p /etc/watchtower/config
sudo cp ~/.docker/config.json /etc/watchtower/config/
```

**Recommendation: make the GHCR images public** to skip this entire dance.
Code stays private, only the built artifacts are public.

---

## 2. Push a new release

You don't push images directly — the CI does it. Just:

```bash
# Local dev machine
git add ...
git commit -m "feat: ..."
git push origin master
```

GitHub Actions (`.github/workflows/build-and-publish.yml`) triggers on
every push to `master` that touches `apps/backend/`, `apps/frontend/`,
`packages/types/`, or the workflow file itself. It builds both images
multi-arch-ready (amd64) and pushes:

- `ghcr.io/<owner>/wpt-backend:latest`
- `ghcr.io/<owner>/wpt-backend:master-<short-sha>`
- `ghcr.io/<owner>/wpt-backend:master-<YYYYMMDD-HHMMSS>`
- `ghcr.io/<owner>/wpt-frontend:latest`
- `ghcr.io/<owner>/wpt-frontend:master-<short-sha>`
- `ghcr.io/<owner>/wpt-frontend:master-<YYYYMMDD-HHMMSS>`

Within 5 minutes (the `WATCHTOWER_POLL_INTERVAL` setting), every customer
machine running watchtower pulls the new `:latest` tag and recreates the
labelled containers (`com.centurylinklabs.watchtower.enable=true`).

**Watch the rollout from a single customer machine:**

```bash
ssh <machine>
docker logs -f watchtower
```

You'll see lines like:

```
Found new ghcr.io/.../wpt-backend:latest image (sha256:...)
Stopping /wpt-iot-backend-1 (...)
Removing /wpt-iot-backend-1
Creating /wpt-iot-backend-1
```

---

## 3. Roll back to a specific version

Each build also gets pinned tags (`master-<sha>` and `master-<timestamp>`).
If `latest` is broken on a machine and you need to revert:

```bash
ssh <machine>
cd /opt/wpt-iot

# Pin to a known-good build
docker compose -f docker-compose.yml -f docker-compose.host.yml -f docker-compose.prod.yml \
  pull ghcr.io/<owner>/wpt-backend:master-abc1234

# Edit docker-compose.prod.yml and replace `:latest` with `:master-abc1234`
sudo sed -i 's|wpt-backend:latest|wpt-backend:master-abc1234|' docker-compose.prod.yml

# Recreate the container
docker compose -f docker-compose.yml -f docker-compose.host.yml -f docker-compose.prod.yml up -d backend
```

Don't forget to **disable watchtower** on this machine until you've fixed
the issue, otherwise it will pull `:latest` again on the next poll:

```bash
sudo sed -i 's|wpt-backend:latest|wpt-backend:master-abc1234|' docker-compose.prod.yml
docker compose ... up -d
docker stop watchtower
```

When you're ready to re-enable auto-updates, restore `:latest`:

```bash
sudo sed -i 's|wpt-backend:master-abc1234|wpt-backend:latest|' docker-compose.prod.yml
docker compose ... up -d backend watchtower
```

---

## 4. Per-customer ABB AC500 PLC IP

Every customer site has a different ABB AC500 IP on its LAN. The PLC target
host lives in the `plc_config` table in the database, NOT in `.env` or any
compose file. There are two ways to set it:

**Option A — from the frontend** (intended):
1. Open `http://wpt.local:3001` from any LAN client
2. Login as admin
3. Sidebar → **PLC Settings**
4. Enter the ABB AC500 IP → Save
5. The handshake FSM picks it up via the 30-second cache; no restart needed.

**Option B — directly via API** (for headless / scripted provisioning):

```bash
ssh <machine>
COOKIE=/tmp/wpt.cookie
curl -s -c $COOKIE -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<the-password>"}'

curl -s -b $COOKIE -X PUT http://localhost:3000/api/plc/config \
  -H "Content-Type: application/json" \
  -d '{"targetHost":"192.168.1.50"}'   # ← the customer's PLC IP
```

The same pattern works for the MQTT broker config (`/api/mqtt/config`).

Don't forget to also configure the PLC side: in CODESYS, set
`GVL_WPT.sTargetIp := '<this-machine-LAN-IP>'` so the PLC streams cyclic
data to the wpt-iot backend.

---

## 5. Debugging a stuck machine

```bash
ssh <machine>

# Are containers running?
docker ps -a

# Backend logs (last 100 lines)
docker logs wpt-iot-backend-1 --tail 100

# Frontend logs
docker logs wpt-iot-frontend-1 --tail 100

# Watchtower logs (image pull history)
docker logs watchtower --tail 100

# Health
curl -s http://localhost:3000/health | jq

# MQTT activity log (after auth)
COOKIE=/tmp/c
curl -s -c $COOKIE -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<pwd>"}'
curl -s -b $COOKIE http://localhost:3000/api/mqtt/log | jq

# Is the PLC actually sending data?
sudo tcpdump -i <iface> -n 'udp and port 9090 or port 9091' -c 5
```

### Watchtower not pulling updates

1. **Check it's running**: `docker ps | grep watchtower`
2. **Check labels are set on backend/frontend**:
   `docker inspect wpt-iot-backend-1 | grep watchtower.enable`
   Should show `true`.
3. **Check WATCHTOWER_LABEL_ENABLE=true** in the environment.
4. **GHCR auth**: `cat /etc/watchtower/config/config.json` should have an
   `auths` entry for `ghcr.io`. If missing, watchtower silently skips
   private images.
5. **Trigger an immediate poll**: `docker exec watchtower /watchtower --run-once`

### Backend container restart loop

Usually a database connection problem. Check:

```bash
docker logs wpt-iot-db-1 --tail 50
docker exec wpt-iot-db-1 psql -U wpt -d wpt -c '\dt'
```

If the DB is healthy but the backend can't connect, check `.env` —
`PG_PASSWORD` must match what the DB volume was initialized with. If they
diverged (someone regenerated `.env` after the first install), you have to
either reset the DB volume (`docker volume rm wpt-iot_pgdata` — **destroys
data**) or `ALTER USER wpt PASSWORD '...'` to match the new `.env`.

---

## 6. Common gotchas

1. **`SameSite=Lax` and the baked frontend URL**. The frontend bundle has
   `NEXT_PUBLIC_API_URL` baked in at build time. If clients access the
   frontend at `http://192.168.1.50:3001` while the bundle calls
   `http://wpt.local:3000`, that's cross-site → cookie dropped → 401 on
   every authenticated XHR. Always access the frontend via the **same
   hostname** that's in `NEXT_PUBLIC_API_URL`. For the production install,
   that's always `wpt.local`.

2. **mDNS doesn't work over routed networks**. `wpt.local` only works on
   the same broadcast domain as the machine. If the customer has VLANs
   that segment the IT and OT networks, the customer's PCs need to be
   on the same VLAN as the wpt-iot machine, OR use the LAN IP directly
   AND make sure to also rebuild the frontend with that IP as
   `NEXT_PUBLIC_API_URL` (or use a reverse proxy).

3. **`network_mode: host` for the backend is mandatory**. The ABB AC500
   sends UDP from a fixed source IP to the backend's port 9090. Docker
   bridge networking with port mapping silently drops UDP on multi-NIC
   hosts. Don't try to "clean it up" by making the backend bridge-mode.

4. **The PostgreSQL volume `wpt-iot_pgdata` is the only stateful thing**.
   Back it up regularly:
   ```bash
   docker run --rm -v wpt-iot_pgdata:/data -v /backup:/backup alpine \
     tar czf /backup/pgdata-$(date +%F).tar.gz -C /data .
   ```
