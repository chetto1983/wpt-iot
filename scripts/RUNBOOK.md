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
3. Downloads `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.https.yml`, the nginx template, and the TLS helper into `/opt/wpt-iot`.
4. Publishes `wpt.local` over mDNS with Avahi.
5. Generates `.env` with random secrets if needed.
6. Generates a local CA plus the server cert for `wpt.local`.
7. Pulls the GHCR images and starts the stack.
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

GitHub Actions builds and publishes:
- `ghcr.io/<owner>/wpt-backend:latest`
- `ghcr.io/<owner>/wpt-frontend:latest`

The workflow now bakes `NEXT_PUBLIC_API_URL=https://wpt.local/api` into the published frontend image so every customer machine can use the same frontend artifact.

Watchtower updates the labelled backend/frontend containers automatically.

## Roll Back a Machine

Pin the backend or frontend image to a known-good tag:

```bash
cd /opt/wpt-iot
sudo sed -i 's|wpt-backend:latest|wpt-backend:master-abc1234|' docker-compose.prod.yml
docker compose -f docker-compose.yml -f docker-compose.host.yml -f docker-compose.https.yml -f docker-compose.prod.yml up -d backend
```

If you need to stop automatic pulls during investigation:

```bash
docker stop watchtower
```

Restore `:latest` when ready.

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
3. Access the app at `https://wpt.local`, not `http://<LAN_IP>:3001`. The published frontend image is baked for `https://wpt.local/api`.
4. The only operator-facing installer is `scripts/install.sh`. `install-prod.sh` and `install-offline.sh` are internal entrypoints behind it.
5. `wpt.local` depends on mDNS. If the client is on another VLAN or routed network, either fix name resolution or deploy real DNS with matching certificates.
