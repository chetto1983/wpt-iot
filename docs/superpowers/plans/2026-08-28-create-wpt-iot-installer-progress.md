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
| 8. Remote OpenSSH/SCP flow | Complete | RED observed for missing module/stdin API; 52 package tests, lint, typecheck, and build pass |
| 9. CLI, README and tarball | Pending | — |
| 10. CI, publication and deployment docs | Pending | — |
| 11. Disposable Raspberry acceptance | Pending | Requires a disposable target and credentials |

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
