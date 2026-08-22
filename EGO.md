# extensions.gnome.org submission

Build zip: `./scripts/ego-pack.sh` → `dist/ego/<uuid>-v<version>.zip`

Upload at https://extensions.gnome.org/upload

## Dependency (not in the EGO zip)

The extension package does **not** include `backend/`. Install the privileged helper once from GitHub:

```bash
git clone https://github.com/binaryplates/cpu-turbo-widget.git
cd cpu-turbo-widget
./scripts/install-helper.sh
```

This installs `/usr/local/libexec/cpu-turbo-helper` and the polkit policy. Turbo and GPU switching use `pkexec` against that helper after install.

## Review reply (74276)

Removed `backend/` from the extension zip. The helper is installed separately via `scripts/install-helper.sh` in the GitHub repo linked from metadata `url`. The extension only checks for `/usr/local/libexec/cpu-turbo-helper` and shows a notification if it is missing.
