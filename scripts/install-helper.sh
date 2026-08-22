#!/usr/bin/env bash
# Install the CPU Turbo privileged helper and polkit policy (EGO dependency).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND="$REPO_ROOT/backend"
POLICY_SRC="$REPO_ROOT/cpu-turbo@blazorplate.net/polkit/net.blazorplate.cputurbo.policy"
HELPER_DEST="/usr/local/libexec/cpu-turbo-helper"
POLICY_DEST="/usr/share/polkit-1/actions/net.blazorplate.cputurbo.policy"

if [[ $EUID -eq 0 ]]; then
  echo "Run as your normal user; sudo is used only to install system files." >&2
  exit 1
fi

sudo install -D -o root -g root -m 0755 "$BACKEND/cpu-turbo-helper" "$HELPER_DEST"
sudo install -D -o root -g root -m 0644 "$POLICY_SRC" "$POLICY_DEST"
echo "Installed $HELPER_DEST"
