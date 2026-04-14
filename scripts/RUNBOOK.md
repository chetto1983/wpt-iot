# WPT IoT Production Runbook

How to install, update, debug, and roll back `wpt-iot` on customer machines.
The production layout is:
- `https://wpt.local` for the frontend
- `https://wpt.local/api` for the API and websocket
- nginx terminates TLS on the edge machine
- the backend still runs with `network_mode: host` so PLC UDP reaches it

## Provision a New Customer Machine

Fresh Ubuntu 22.04 / 24.04 install with:
- network access to GitHub + `ghcr.io`
- a LAN IP reachable by the operator devices
- Docker not yet installed is fine

Run as root:

```bash
curl -fsSL https://raw.githubusercontent.com/chetto1983/wpt-iot/master/scripts/install.sh | sudo bash
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

## Post-Deploy Energy Step

Run this once after a deploy or database restore before declaring the v1.1 energy module live on a machine:

```bash
docker compose exec db psql -U wpt -d wpt -c "SELECT setup_energy_aggregates();"
```

This installs the TimescaleDB continuous aggregates and helper objects that back `/energy`, `/settings/energy`, reconciliation, and the ISO 50001 PDF route.

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
4. The only operator-facing installer is `scripts/install.sh`. `install-prod.sh` and `install-offline.sh` are internal entrypoints behind it.
5. `wpt.local` depends on mDNS. If the client is on another VLAN or routed network, either fix name resolution or deploy real DNS with matching certificates.
