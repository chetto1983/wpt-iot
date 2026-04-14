# WPT IoT — Auto Deploy Setup

This is the **golden master → all customers** auto-update pipeline. After every
push to `chetto1983/wpt-iot` master, the golden master polls GitHub, rebuilds
a fresh offline bundle, and ships it to every customer edge PC listed in
`/etc/wpt-auto-deploy/customers.conf` — fully unattended, no human in the loop.

## Architecture

```text
                    push to master
   developer ──────────────────────► github.com/chetto1983/wpt-iot
                                              │
                                              │ git fetch (every 5 min)
                                              ▼
                                  ┌────────────────────────┐
                                  │  GOLDEN MASTER         │
                                  │  (Linux + internet)    │
                                  │                        │
                                  │  /opt/wpt-deploy/      │
                                  │    wpt-iot/  (clone)   │
                                  │                        │
                                  │  systemd timer:        │
                                  │    every 5 minutes     │
                                  │    runs auto-deploy.sh │
                                  └────────────┬───────────┘
                                               │
                              build bundle if  │
                              new commits      ▼
                                  ┌────────────────────────┐
                                  │ wpt-iot-bundle-        │
                                  │   <sha>-<ts>.tar.gz    │
                                  │ (~500 MB)              │
                                  └────────────┬───────────┘
                                               │
                              scp + ssh        │
                              to each customer ▼
              ┌─────────────────┬──────────────┬─────────────────┐
              ▼                 ▼              ▼                 ▼
        wpt-rome-001      wpt-milan-002   wpt-test-vm     ...50 more...
        (air-gapped)      (air-gapped)    (lab)           (air-gapped)
```

The customer edge PCs only need:
- Outbound SSH (port 22) reachable from the golden master
- `sudo` for the deploy user (NOPASSWD or sudoers entry for `install.sh`)
- Docker Engine + Compose v2 already installed (one-time prereq)

They do NOT need GitHub access, npm registry access, Docker Hub access, or
GHCR access. The bundle ships everything they need.

## One-time golden master setup

**Prerequisites on the golden master:**
- Linux (Ubuntu 22.04 / 24.04 tested)
- Docker Engine 24+ + Compose v2
- `git`, `ssh`, `scp`, `tar`, `gzip`, standard coreutils
- Outbound HTTPS to `github.com` and `registry-1.docker.io`
- Enough disk for bundles (~500 MB each, KEEP_BUNDLES=5 by default → ~2.5 GB)

### Step 1 — Clone the repo to the golden master

```bash
sudo mkdir -p /opt/wpt-deploy
sudo chown $USER /opt/wpt-deploy
git clone https://github.com/chetto1983/wpt-iot.git /opt/wpt-deploy/wpt-iot
```

### Step 2 — Install the systemd unit + timer

```bash
sudo cp /opt/wpt-deploy/wpt-iot/scripts/wpt-auto-deploy.service /etc/systemd/system/
sudo cp /opt/wpt-deploy/wpt-iot/scripts/wpt-auto-deploy.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

### Step 3 — Customer registry

```bash
sudo mkdir -p /etc/wpt-auto-deploy
sudo cp /opt/wpt-deploy/wpt-iot/scripts/customers.conf.example /etc/wpt-auto-deploy/customers.conf
sudo chmod 600 /etc/wpt-auto-deploy/customers.conf
sudo $EDITOR /etc/wpt-auto-deploy/customers.conf
```

Add one line per customer:

```
wpt-rome-001    sacchi@192.168.10.50         /home/sacchi/wpt-deploy
wpt-milan-002   sacchi@10.0.5.20:2222        /home/sacchi/wpt-deploy
```

### Step 4 — Passwordless SSH to every customer

```bash
sudo ssh-keygen -t ed25519 -N '' -f /root/.ssh/wpt-deploy
# For EACH customer:
sudo ssh-copy-id -i /root/.ssh/wpt-deploy.pub sacchi@<customer-ip>
```

Then add to `/root/.ssh/config`:

```
Host wpt-*
  IdentityFile /root/.ssh/wpt-deploy
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
```

### Step 5 — Customer-side `sudo` policy

On EACH customer edge PC:

```bash
echo 'sacchi ALL=(ALL) NOPASSWD: /usr/bin/bash /home/sacchi/wpt-deploy/wpt-iot-bundle-*/install.sh' \
  | sudo tee /etc/sudoers.d/wpt-auto-deploy
sudo chmod 440 /etc/sudoers.d/wpt-auto-deploy
```

This lets the auto-deploy ssh session run `sudo bash install.sh`
without a password prompt, but DOESN'T grant the deploy user blanket sudo.

### Step 6 — Optional config overrides

`/etc/default/wpt-auto-deploy` (sourced by the systemd unit):

```bash
# Override any of the auto-deploy.sh defaults here. Examples:
# REPO_DIR=/opt/wpt-deploy/wpt-iot
# BUNDLE_DIR=/var/lib/wpt-deploy/bundles
# LOG_FILE=/var/log/wpt-auto-deploy.log
# CUSTOMERS_CONF=/etc/wpt-auto-deploy/customers.conf
# KEEP_BUNDLES=10
# SKIP_SHIP=1   # build only, do not ship to customers (useful for staging)
```

### Step 7 — Enable + start the timer

```bash
sudo systemctl enable --now wpt-auto-deploy.timer
sudo systemctl status wpt-auto-deploy.timer
```

The first run fires 2 minutes after boot, then every 5 minutes. To trigger an
immediate run for testing:

```bash
sudo systemctl start wpt-auto-deploy.service
journalctl -u wpt-auto-deploy.service -f
```

## Verification

```bash
# Did the timer fire recently?
systemctl list-timers wpt-auto-deploy.timer

# What did it do last time?
journalctl -u wpt-auto-deploy.service -n 100

# Is there a fresh bundle?
ls -lh /var/lib/wpt-deploy/bundles/

# What's the latest bundle's git sha?
tar xzOf /var/lib/wpt-deploy/bundles/latest.tar.gz \
    "$(basename $(readlink -f /var/lib/wpt-deploy/bundles/latest.tar.gz) .tar.gz)/VERSION" \
    | grep git_sha
```

## Manual one-shot

You can run the script directly any time:

```bash
sudo /opt/wpt-deploy/wpt-iot/scripts/auto-deploy.sh
```

Or build a bundle WITHOUT shipping to customers (for staging / testing):

```bash
sudo SKIP_SHIP=1 /opt/wpt-deploy/wpt-iot/scripts/auto-deploy.sh
```

## Rollback

The golden master keeps the last `KEEP_BUNDLES` bundles in
`/var/lib/wpt-deploy/bundles/` (default 5). To roll a customer back to a
specific older bundle:

```bash
# On the golden master:
ls /var/lib/wpt-deploy/bundles/
# Pick the bundle you want, e.g.:
OLD=/var/lib/wpt-deploy/bundles/wpt-iot-bundle-abcd123-20260408-153000.tar.gz
scp -i /root/.ssh/wpt-deploy "${OLD}" sacchi@<customer>:/home/sacchi/wpt-deploy/
ssh -i /root/.ssh/wpt-deploy sacchi@<customer> "
  cd /home/sacchi/wpt-deploy
  tar xzf $(basename ${OLD})
  sudo bash $(basename ${OLD} .tar.gz)/install.sh
"
```

The customer's `.env` and `pgdata` volume are preserved across re-installs, so
rolling back to an older code version does NOT lose machine history or admin
credentials. Database schema migrations run idempotently at backend boot
(`MachineSchemaMigrationService.ensureV03Columns`,
`EnergyConfigService.ensureTable`).

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `git fetch failed` in log | Golden master lost internet | Check `curl https://github.com` works as the deploy user |
| `build-bundle.sh failed` | Docker Hub unreachable / disk full | Check `docker pull hello-world` works; check `df -h /var/lib/wpt-deploy` |
| `ship: <customer> unreachable via ssh` | Customer offline / network changed | Ping the customer; if back, the next 5-min tick reships automatically |
| `ship: <customer> remote install.sh failed` | sudoers rule missing or Docker not running on customer | Re-do Step 5 on that customer; check `systemctl status docker` on the customer |
| Customer applies bundle but data is gone | Likely the customer's `pgdata` volume was wiped — `install.sh` does NOT touch volumes, so check the customer manually | Restore from backup |

## What this does NOT cover

- **Phase 19 / TimescaleDB hypertable migration** on a fresh customer machine.
  The `/docker/init-timescaledb.sql` script in the bundle DOES install the full
  hypertable + CAGG chain, but only on a fresh `pgdata` volume (Docker init
  convention). For a customer that already has a v1.0 plain-table `pgdata`,
  apply `.planning/debug/artifacts/e2e-phase19-migration.sql` once via
  `docker compose exec db psql` — this is a one-time live-data migration and
  is NOT idempotent enough to ship in the bundle.

- **PLC IP configuration**. After install, the customer needs to log in to
  `/plc` and set their ABB AC500 IP. This is per-customer state and lives in
  the `plc_config` DB table, not in the bundle.

- **Bundle authenticity**. The bundle has SHA256SUMS for tamper detection,
  but no GPG signing. If you need cryptographic provenance, sign the
  `latest.tar.gz` symlink with your GPG key after each `auto-deploy.sh` run.
