# `create-wpt-iot` Installer Design

Date: 2026-08-28  
Status: Approved in conversation  
Package: `create-wpt-iot` (public npm package)

## Context

WPT IoT already has production installers for online, source-built, and offline deployments. The supported online edge flow is implemented by `scripts/install-enduser.sh`, which installs or verifies Docker, downloads runtime files, generates secrets and TLS assets, pulls multi-architecture images from GHCR, starts the Docker Compose stack, and enables systemd timers.

The current entrypoint is a Bash command. Technicians need a guided command that works directly on a Linux target and remotely from a Windows workstation. The target computers are Raspberry-class Linux devices with `apt`, `systemd`, username/password SSH access, and outbound Internet access to GitHub, GHCR, Docker Hub, and npm.

## Goals

- Publish a public npm package invoked as `npx create-wpt-iot`.
- Make an interactive wizard the default experience.
- Support local installation on an `apt` + `systemd` Linux target.
- Support remote installation of one Linux target per execution from Windows or Linux.
- Reuse `scripts/install-enduser.sh` as the single Linux installation engine.
- Install and configure Docker Compose, runtime files, mDNS, TLS, secrets, containers, health checks, and systemd timers.
- Ask for the initial admin password using hidden input and confirmation.
- Enable automatic backend/frontend image updates every five minutes by default, with an explicit wizard choice to disable them.
- Preserve existing `.env`, encryption keys, credentials, database data, uploads, and Docker volumes on reinstall.
- Provide Italian and English wizard messages.
- Keep secrets out of process arguments, logs, and diagnostic reports.

## Non-goals

- Configuring PLC, MQTT, application timezone, energy settings, or users. These remain in the web frontend.
- Installing more than one device in a single execution.
- Supporting targets without Internet access.
- Supporting Linux distributions without both `apt` and `systemd`.
- Replacing the existing Bash installer with a TypeScript implementation.
- Replacing the existing offline bundle deployment flow.

## Chosen Approach

The npm package is a thin, cross-platform Node.js orchestrator around the existing Linux installer.

This approach keeps Docker, systemd, TLS, GHCR, and health-check logic in one canonical implementation. A complete TypeScript rewrite would duplicate mature shell behavior. A containerized installer cannot safely install Docker or configure host-level systemd, mDNS, and TLS resources.

The package name `create-wpt-iot` was available on npm when checked on 2026-08-28. Availability is not a reservation; ownership must be established during the initial publication.

## User Experience

The public commands are:

```text
npx create-wpt-iot
npx create-wpt-iot --mode local
npx create-wpt-iot --mode remote
npx create-wpt-iot --help
```

The wizard remains interactive even when `--mode` is supplied. The option skips only the mode question.

The default flow asks for:

1. Local or remote mode.
2. Remote target hostname/IP, SSH port, and username when applicable.
3. Installation directory, defaulting to `/opt/wpt-iot`.
4. Device serial/hostname, with a detected value proposed when available.
5. Initial admin password using hidden input and confirmation for a new installation.
6. Automatic image updates, enabled by default.
7. Final confirmation before mutating the target.

The preflight detects an existing installation after the target and installation directory are known. Existing installations preserve the admin credential and do not ask for a misleading replacement password; password rotation remains a frontend operation.

Local mode is valid only on Linux with `apt` and `systemd`. Running local mode on Windows produces a localized explanation and recommends remote mode. Remote targets do not require Node.js or npm.

## Components

### Node package

The new workspace lives at `packages/create-wpt-iot` and is included by the existing `packages/*` workspace pattern.

Its responsibilities are divided into small modules:

- CLI parsing and top-level orchestration.
- Locale detection and message lookup.
- Interactive prompt collection.
- Input validation and normalization.
- Local preflight and command execution.
- Remote OpenSSH/SCP preflight and command execution.
- Temporary configuration creation and guaranteed cleanup.
- Output redaction and phase-oriented error reporting.

The implementation uses TypeScript and dependencies without native addons. `@inquirer/prompts` provides hidden password prompts and `execa` provides consistent subprocess behavior on Windows and Linux.

### Linux installer

`scripts/install-enduser.sh` remains the installation engine. It gains a versioned configuration-file input while preserving its existing environment-variable entrypoints for backward compatibility.

The installer continues to own:

- Docker Engine and Compose installation/verification.
- Host service conflict handling.
- Runtime file download.
- mDNS and device aliases.
- secret generation and `.env` preservation.
- TLS generation and refresh timer.
- GHCR image pull and Docker Compose startup.
- backend, nginx, and HTTPS health checks.
- automatic image-update timer installation.

### Existing image updater

`scripts/wpt-image-update.sh` remains responsible for periodic application updates. It pulls and replaces only backend and frontend, waits for health, and leaves database, Mosquitto, nginx, certificates, uploads, and volumes untouched.

## Local Installation Flow

1. The CLI verifies Node compatibility and detects Linux.
2. It verifies `apt`, `systemd`, `sudo`, architecture, disk space, and required network endpoints.
3. It detects whether the selected installation directory already contains WPT IoT.
4. It collects the remaining wizard values and displays a redacted summary.
5. It writes a random, permission-restricted configuration file in the OS temporary directory.
6. It downloads an immutable, checksum-verified installer revision compatible with the npm package.
7. It invokes the installer through `sudo`, passing only the configuration-file path as an argument.
8. It streams phase output without exposing secrets.
9. It removes the temporary configuration and installer in a `finally` path.
10. It reports the final HTTPS URL, CA location, health state, and next frontend configuration steps.

Local mode requires Node/npm because the entrypoint is `npx`. The existing curl/Bash installer remains the fallback for a target without Node.

## Remote Installation Flow

1. The CLI verifies native `ssh` and `scp` on the technician workstation.
2. Native OpenSSH performs host-key verification through the user's normal `known_hosts` and handles password prompts directly.
3. The CLI connects to the single selected target and verifies Linux, `apt`, `systemd`, `sudo`, architecture, disk, network reachability, and existing installation state.
4. It creates the same versioned configuration in a random local temporary file with restrictive permissions.
5. SCP transfers the file and checksum-verified installer to unpredictable paths in the remote user's temporary area.
6. SSH allocates a terminal and runs the installer through `sudo` using the remote configuration path.
7. The remote installer installs a cleanup trap before parsing configuration.
8. Local and remote temporary files are removed on success, failure, signal, or connection interruption where cleanup remains possible.
9. If the connection is interrupted before cleanup, the next run removes stale installer files matching the tool's controlled prefix before proceeding.

With password authentication, OpenSSH and `sudo` may request the target user's password more than once. The CLI never captures or echoes those credentials.

## Configuration Transport

The transport file is a small versioned key/value format designed for parsing without `eval`. Values that can contain special characters are Base64-encoded by Node and decoded by standard Linux `base64`.

Conceptual fields are:

```text
format=1
admin_password_base64=<redacted>
install_dir_base64=<encoded>
device_serial_base64=<encoded>
enable_auto_update=true
```

The Bash parser:

- accepts only known keys;
- rejects duplicates, malformed Base64, unexpected versions, and missing required values;
- validates the decoded install directory and serial before use;
- never sources the file as shell code;
- does not print decoded secrets.

The file is plaintext at rest for its short lifetime, protected by random naming and restrictive filesystem permissions. SCP encrypts it in transit. The design does not claim cryptographic at-rest encryption on the technician workstation.

## Secret Handling

- A new installation requires an admin password entered twice through a hidden prompt.
- Password policy is validated before any target mutation.
- The password is held in memory only as long as required to produce the temporary configuration.
- Passwords and generated secrets never appear in command arguments, environment dumps, logs, error messages, or summaries.
- Temporary files are created with mode `0600` where supported and removed in `finally`/`trap` cleanup.
- On reinstall, the existing admin password, PostgreSQL password, session secret, and AES encryption key are preserved.
- `SECRETS_ENCRYPTION_KEY` is generated only when missing and is never rotated automatically.

## Preflight and Error Handling

Preflight runs before installation mutations and reports failures by phase. Checks include:

- required local executable availability;
- SSH connectivity and host authenticity in remote mode;
- target operating-system capabilities;
- supported `linux/arm64` or `linux/amd64` architecture;
- sufficient disk space;
- target outbound HTTPS access to GitHub, GHCR, and Docker Hub;
- `sudo` availability;
- existing WPT installation state.

The CLI presents localized summaries and preserves raw subprocess diagnostics when useful. Raw output from existing shell tools may remain in its original language.

Errors include:

- the failed phase;
- a sanitized cause;
- a safe diagnostic command;
- whether rerunning is safe;
- cleanup results.

The Bash installer remains idempotent. Rerunning after a partial download, container failure, or SSH interruption must not delete persistent data or regenerate established encryption keys.

## Automatic Updates

The online installer enables `wpt-image-update.timer` by default. The wizard allows an explicit opt-out per device.

The timer:

- runs at boot and every five minutes according to the existing systemd unit;
- locks to prevent overlapping runs;
- pulls only backend and frontend GHCR images;
- recreates only those services;
- waits until both services report healthy;
- prunes only dangling images after a successful replacement.

Application pushes continue to publish multi-architecture images through the existing GitHub workflow. The target does not require a GHCR token because both image manifests are publicly readable.

## Internationalization

The wizard detects the terminal locale. `it-*` selects Italian; all other locales default to English. A future explicit language option can be added without changing message consumers.

All Node-owned prompts, summaries, phase labels, validation errors, and remediation messages live in typed Italian and English catalogs. Tests fail when either catalog is missing a required key. Identifiers, paths, URLs, and raw external command diagnostics are not translated.

## Testing Strategy

### Unit tests

- prompt branching for local, remote, new, and existing installs;
- IP/hostname, port, path, serial, and password validation;
- locale selection and catalog parity;
- configuration encoding, parsing fixtures, and malformed input rejection;
- output and error redaction;
- command construction without secret-bearing arguments.

### Integration tests

- fake `ssh`, `scp`, and `sudo` executables record sanitized invocations and simulate success/failure;
- temporary local and remote artifact cleanup on every exit path;
- local and remote phase sequencing;
- preservation behavior for an existing installation;
- Bash configuration parser tests against literal fixtures;
- shell syntax validation with `bash -n`;
- package tarball smoke test using `npm pack` followed by `npx <tarball> --help`.

### CI matrix

The package runs lint, TypeScript, tests, and packaging smoke checks on current Ubuntu and Windows runners using supported Node releases. Tests never install Docker or mutate host systemd services.

A manual acceptance check on a disposable Raspberry/Debian target verifies the complete online install, HTTPS health, persisted volumes after reinstall, and a real automatic image update.

## Publication

The npm package includes only compiled `dist`, localized catalogs required at runtime, README, and license metadata. It contains no application source, deployment secrets, credentials, or customer configuration.

A dedicated GitHub Actions workflow publishes with npm provenance and public access from an installer release tag. Trusted publishing or the necessary npm organization authorization must be configured once outside the repository.

Each published package embeds:

- the compatible immutable repository commit/tag;
- the expected installer SHA-256;
- its own semantic version.

The CLI verifies the downloaded installer before execution. Development builds may use an explicitly marked local or branch override, but the published default is immutable.

## Documentation

The package README documents:

- local and remote examples;
- Node, OpenSSH, target Linux, sudo, Internet, and port prerequisites;
- repeated password prompts caused by native SSH/SCP/sudo;
- security and secret handling;
- reinstall behavior;
- automatic update behavior and disable/enable commands;
- frontend steps for PLC, MQTT, timezone, energy, and user configuration;
- npm publication prerequisites for maintainers.

The root README and deployment runbook point to `npx create-wpt-iot` as the guided online installer while retaining Bash and offline bundle alternatives.

## Success Criteria

- A technician can run the wizard locally on supported Linux or remotely from Windows against one Raspberry-class target.
- A new install reaches healthy backend, frontend, nginx, database, and Mosquitto services at `https://wpt.local`.
- The initial admin password is accepted without appearing in argv or logs.
- TLS, mDNS, secret generation, and systemd timers are configured without manual file editing.
- Backend/frontend automatic updates are enabled by default and preserve persistent data.
- Reinstalling preserves `.env`, encryption keys, credentials, database, uploads, and volumes.
- PLC, MQTT, application timezone, energy, and users remain untouched by the installer and configurable in the frontend.
- The package passes Windows and Ubuntu CI, Bash syntax checks, redaction tests, integration tests, and npm tarball smoke tests.

## External Prerequisites and Risks

- Publishing `create-wpt-iot` requires npm ownership/trusted-publishing setup; name availability can change before the first publish.
- Remote password authentication can cause several native password prompts. SSH keys can reduce prompts later without changing the CLI architecture.
- Targets must retain outbound registry access for five-minute automatic updates.
- A bad `latest` application image can pass registry download but fail health checks. The current updater reports the failure and requires operator remediation; automatic rollback is outside this installer scope.
- Existing host services on conflicting ports are handled by the current installer and remain visible in the final confirmation before mutation.
