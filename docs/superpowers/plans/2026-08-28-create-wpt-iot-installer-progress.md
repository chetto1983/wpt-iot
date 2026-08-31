# `create-wpt-iot` Implementation Progress

Last updated: 2026-08-31

Branch: `master` (explicitly requested by the user)

Plan: `2026-08-28-create-wpt-iot-installer.md`

## Current status

| Task | Status | Evidence |
|---|---|---|
| 1. Package foundation and typed i18n | Complete | Commit `9f002c9`; 7 i18n tests pass; package lint passes |
| 2. Domain types and validation | Complete | RED observed for missing module; 21 package tests pass; package lint passes |
| 3. Secure config and redacted process runner | Complete | RED observed for missing modules; 28 package tests, lint, and typecheck pass |
| 4. Interactive wizard branching | Complete | RED observed for missing module; 33 package tests, lint, and typecheck pass |
| 5. Immutable installer artifact | Complete | RED observed for missing module; 36 package tests, lint, typecheck, build, ref/hash stamp pass |
| 6. Bash config contract and update toggle | Complete | RED observed from root checks on source; Git Bash and Ubuntu 24.04 parser/syntax tests pass; 36 package tests and lint pass |
| 7. Local Linux flow | Complete | RED observed for missing modules; 44 package tests, lint, and typecheck pass |
| 8. Remote OpenSSH/SCP flow | Complete | Native-terminal regression fixed after live Windows/RPi test; 61 package tests, lint, typecheck, and build pass |
| 9. CLI, README and tarball | Complete | RED observed for missing CLI; 60 package tests, lint, typecheck, build, packed help/version smoke pass |
| 10. CI, publication and deployment docs | Complete | Commit `2031ac5`; Windows/Ubuntu jobs pass; manifest local/remote gate, tarball smoke, actionlint and OIDC trusted publishing pass |
| 11. Disposable target acceptance | Complete | Ubuntu 26.04 amd64 fresh install, reinstall/persistence and manual auto-update pass; sanitized evidence recorded in `docs/deployment/create-wpt-iot-acceptance.md` |

## Locked decisions

- Public package and executable: `create-wpt-iot` / `npx create-wpt-iot`.
- Interactive wizard by default; one target per execution.
- Local Linux and remote Windows/Linux modes.
- Linux target requires `apt`, `systemd`, `sudo`, and Internet access.
- Native OpenSSH/SCP owns SSH and sudo password prompts.
- New admin password is hidden, confirmed, and never passed in argv.
- `scripts/install-enduser.sh` remains the canonical installation engine.
- Existing `.env`, secrets, credentials, volumes, database, and uploads are preserved.
- Automatic backend/frontend updates are enabled by default.
- PLC, MQTT, timezone, energy, and users remain configured in the frontend.
- All wizard-owned messages are available in Italian and English.

## Verification log

- 2026-08-31 — npm registry checked: `@inquirer/prompts@8.7.0` and `execa@10.0.1` match the plan; `create-wpt-iot` currently returns npm 404 (name unclaimed/unpublished).
- 2026-08-31 — Task 1 RED: missing i18n modules.
- 2026-08-31 — Task 1 GREEN: 7 tests, lint clean.
- 2026-08-31 — Task 2 RED: missing validation module.
- 2026-08-31 — Task 2 GREEN: 21 tests and package lint pass; the initial `no-control-regex` lint finding was refactored without changing behavior.
- 2026-08-31 — Task 3 RED: missing secure config and process modules.
- 2026-08-31 — Task 3 GREEN: 28 tests, lint, and typecheck pass; temporary config is private and removable, streamed/captured process output is redacted.
- 2026-08-31 — Task 4 RED: missing prompt adapter and wizard branching module.
- 2026-08-31 — Task 4 GREEN: 33 tests, lint, and typecheck pass; new installs confirm a hidden password, reinstalls never request it, final cancellation is non-mutating.
- 2026-08-31 — Task 5 RED: missing artifact download and verification module.
- 2026-08-31 — Task 5 GREEN: 36 tests, lint, typecheck, and build pass; compiled manifest ref and SHA-256 match git HEAD and the local canonical installer, with no placeholder tokens remaining.
- 2026-08-31 — Task 6 RED: sourcing the canonical installer executed its root check and `load_install_config` was absent.
- 2026-08-31 — Task 6 GREEN: Bash syntax and config-contract tests pass in Git Bash and Ubuntu 24.04; a Linux-only Base64 padding bug was caught and fixed; 36 package tests and lint remain green.
- 2026-08-31 — Task 7 RED: missing local preflight and orchestration modules.
- 2026-08-31 — Task 7 GREEN: 44 tests, lint, and typecheck pass; local mode gates Linux, validates required capabilities/architecture/network, and keeps the admin password out of sudo argv.
- 2026-08-31 — Task 8 decision: user confirmed native OpenSSH/SCP; Windows `scp.exe` is resolved with `where.exe` because OpenSSH SCP does not support `-V`.
- 2026-08-31 — Task 8 RED: missing remote module and dedicated subprocess stdin API.
- 2026-08-31 — Task 8 GREEN: 52 tests, lint, typecheck, and build pass; one SCP transfer uses UUID names, SSH uses a constant stdin script, both modes enforce 12 GiB free, and cleanup preserves the primary error.
- 2026-08-31 — Task 9 RED: missing CLI orchestration module.
- 2026-08-31 — Task 9 GREEN: 60 tests, lint, typecheck, and build pass; packed tarball excludes tests and executes localized help plus version through its published binary.
- 2026-08-31 — Native SSH regression RED: the live Windows wizard reached remote preflight but OpenSSH could not display/read its password while subprocess `stdin` and `stderr` were both piped.
- 2026-08-31 — Native SSH regression GREEN: remote scripts no longer consume the authentication channel; SSH/SCP and remote sudo keep terminal input, application output remains captured, and 61 package tests plus lint/typecheck/build pass.
- 2026-08-31 — Live target check: `192.168.1.31` is a Raspberry Pi 2 Model B Rev 1.1 running 32-bit Raspbian 10 (`armv7l`). The real wizard accepted the native SSH password, rejected the unsupported architecture before download/transfer/install, and left `/opt/wpt-iot` absent with zero installer temp files.
- 2026-08-31 — Task 10 RED/GREEN: a stale-manifest test failed before the verifier existed; all 64 package tests now pass. Every build/prepack stamps and verifies Git HEAD plus installer SHA-256, and the release job also verifies the raw GitHub artifact before publishing.
- 2026-08-31 — Task 10 CI/release: `actionlint` passes; GitHub Windows and Ubuntu verification jobs are green; `create-wpt-iot@0.1.0` is public and executes from the npm registry; the npm trusted publisher is bound to `chetto1983/wpt-iot/.github/workflows/create-wpt-iot.yml` with publish permission.
- 2026-08-31 — Disposable target reset: 16 containers, 22 volumes, all images/cache and prior WPT state were removed from the authorized Ubuntu miniPC, reclaiming approximately 27.2 GB. The removal is not recoverable.
- 2026-08-31 — Live install RED: Ubuntu `needrestart` restarted systemd-networkd during apt prerequisites on a host also managed by NetworkManager, withdrawing the Ethernet address. Journal evidence identified the exact restart.
- 2026-08-31 — Live install GREEN: commit `b58bb4a` prevents network/SSH service recycling during remote apt work and normalizes an optional `wpt-` serial prefix. Bash syntax/config tests and all 64 package tests pass.
- 2026-08-31 — Task 11 GREEN: the exact `0.1.0` tarball stamped at `b58bb4a` completed a remote reinstall on Ubuntu 26.04 amd64. Five services are healthy, HTTPS returns 200, admin login succeeds, PostgreSQL is UTC, pgdata and `.env` fingerprints are unchanged, and no installer temp file remains.
- 2026-08-31 — Automatic update GREEN: the timer is enabled/active; a manual service cycle exited `0/SUCCESS`, verified all migrations and 7 continuous aggregates, synchronized runtime SQL, and left backend/frontend healthy.
- 2026-08-31 — Full repository test note: frontend (90), shared types (48), and installer (64) pass. Five pre-existing backend integration failures were observed against the shared Windows development database (four duplicate energy-cycle fixture keys and one alarm-route 403/422 expectation); they are outside the installer package and did not reproduce on the freshly provisioned target database.
