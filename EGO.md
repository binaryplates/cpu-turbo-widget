# extensions.gnome.org submission

Build zip: `./scripts/ego-pack.sh` → `dist/ego/<uuid>-v<version>.zip`

Upload at https://extensions.gnome.org/upload

## End-user install docs

Point users to **[INSTALL.md](INSTALL.md)** in the repo (linked from EGO via metadata `url`).

EGO description should mention: extension first, then `scripts/install-helper.sh` from GitHub.

## Review reply (74276)

Removed `backend/` from the extension zip. The helper is installed separately via `scripts/install-helper.sh` in the GitHub repo linked from metadata `url`. The extension only checks for `/usr/local/libexec/cpu-turbo-helper` and shows a notification if it is missing.
