# extensions.gnome.org submission

Build zip: `./scripts/ego-pack.sh` → `dist/ego/<uuid>-v<version>.zip`

Upload at https://extensions.gnome.org/upload

## One-click install

**Photos Upload** — backend is bundled in the zip; `enable()` installs pip service, D-Bus activation, and systemd user units automatically.

**CPU Turbo** — on first enable (or first turbo/GPU action), the user gets **one polkit/admin prompt** to install the system helper. No separate GitHub step.

## Review notes

See prior EGO.md content for reviewer replies (pkexec helper, rclone, D-Bus service).
