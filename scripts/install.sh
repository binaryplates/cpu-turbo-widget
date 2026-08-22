#!/usr/bin/env bash
# One-command setup: privileged helper (polkit) + install the GNOME Shell
# extension + enable it. Run as your normal user (not root) — it calls sudo
# internally only to install the root-owned helper and polkit policy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
UUID="cpu-turbo@blazorplate.net"
EXT_SRC="$REPO_ROOT/$UUID"
EXT_DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

if [[ $EUID -eq 0 ]]; then
  echo "Run this as your normal user, not root/sudo — it will ask for sudo only to install the privileged helper." >&2
  exit 1
fi

echo "== Step 1/3: installing the privileged helper (turbo toggle + GPU switch) =="
"$SCRIPT_DIR/install-helper.sh"

echo "== Step 2/3: installing extension files =="
rm -rf "$EXT_DEST"
mkdir -p "$(dirname "$EXT_DEST")"
cp -a "$EXT_SRC" "$EXT_DEST"
glib-compile-schemas "$EXT_DEST/schemas"

echo "== Step 3/3: enabling extension =="
if ! gnome-extensions enable "$UUID" 2>/dev/null; then
  echo "Could not enable automatically — log out and back in once, then run:"
  echo "  gnome-extensions enable $UUID"
  exit 0
fi

echo "Done. Click the CPU Turbo icon in your panel."
echo "The first turbo toggle or GPU switch will show a normal authentication prompt (pkexec), not a silent sudo."
