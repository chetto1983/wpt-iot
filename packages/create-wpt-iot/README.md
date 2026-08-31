# create-wpt-iot

Interactive installer for one WPT IoT edge device. It supports a local Linux installation or a remote Linux installation from a Windows/Linux workstation.

## Usage

```console
npx create-wpt-iot
npx create-wpt-iot --mode local
npx create-wpt-iot --mode remote
npx create-wpt-iot --help
```

The wizard is interactive by default and configures one device per run. `--mode` skips only the first local/remote question.

## Requirements

The workstation running `npx` needs Node.js 22.13 or newer and Internet access.

Local mode requires:

- Linux on `arm64` or `amd64`;
- `apt-get`, `systemd`, `sudo`, `curl`, and at least 12 GiB free;
- outbound HTTPS access to Docker, GHCR, and GitHub.

Remote mode supports a Windows or Linux workstation and requires native `ssh` and `scp`. The target must be Linux on `arm64` or `amd64`, have `apt-get`, `systemd`, `sudo`, `curl`, at least 12 GiB free, and outbound Internet access. Node.js is not required on the target.

Local installation from Windows is not supported. Use remote mode to install a Raspberry/IndustrialPI from Windows.

## Password prompts

For a new installation, the wizard asks for an initial WPT administrator password twice using hidden input. It must contain at least 12 Unicode characters.

SSH, SCP, and remote `sudo` use their native terminal prompts. With username/password SSH authentication, the target password may be requested more than once. The CLI never captures, stores, or passes the SSH password in command arguments.

On the first connection, verify the SSH host fingerprint before accepting it. OpenSSH then records it in the normal `known_hosts` file.

## Security and reinstall behavior

- The immutable installer script is downloaded from the package-pinned Git commit and verified with SHA-256.
- The administrator password is transported only in a randomly named temporary config file, protected with restrictive permissions where supported.
- Secrets are never placed in subprocess arguments or printed in summaries and logs.
- Local and remote temporary files are removed on success and failure; a later run removes abandoned remote files older than one day.
- Reinstalling preserves `.env`, the administrator credential, PostgreSQL password, session secret, `SECRETS_ENCRYPTION_KEY`, database, uploads, and Docker volumes.
- An existing installation does not ask for a replacement administrator password. Rotate credentials from the frontend.
- PostgreSQL remains in UTC. Application timezone conversion is configured in the frontend.

## Automatic updates

Backend and frontend image updates are enabled by default every five minutes. Database, Mosquitto, nginx, certificates, uploads, and volumes are not replaced by the image updater.

On the target:

```console
sudo systemctl status wpt-image-update.timer
sudo systemctl start wpt-image-update.service
sudo systemctl disable --now wpt-image-update.timer
sudo systemctl enable --now wpt-image-update.timer
```

The wizard can explicitly disable automatic updates during installation.

## After installation

Open `https://wpt.local`, download and trust the generated local CA, and log in as `admin` with the password entered in the wizard.

PLC address/byte order, MQTT/Sparkplug, application timezone, energy settings, and users remain deliberately untouched by the installer and are configured after login in the frontend.

## Maintainers

Publishing uses npm trusted publishing with provenance. Do not publish until the disposable Raspberry acceptance checklist in the repository has passed.
