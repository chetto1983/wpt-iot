# `create-wpt-iot` Implementation Progress

Last updated: 2026-08-31

Branch: `master` (explicitly requested by the user)

Plan: `2026-08-28-create-wpt-iot-installer.md`

## Current status

| Task | Status | Evidence |
|---|---|---|
| 1. Package foundation and typed i18n | Complete | Commit `9f002c9`; 7 i18n tests pass; package lint passes |
| 2. Domain types and validation | Complete | RED observed for missing module; 21 package tests pass; package lint passes |
| 3. Secure config and redacted process runner | Pending | — |
| 4. Interactive wizard branching | Pending | — |
| 5. Immutable installer artifact | Pending | — |
| 6. Bash config contract and update toggle | Pending | — |
| 7. Local Linux flow | Pending | — |
| 8. Remote OpenSSH/SCP flow | Pending | — |
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
