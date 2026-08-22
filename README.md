# CPU Turbo

A native GNOME Shell extension: a panel indicator that toggles Intel CPU
Turbo Boost, switches the system power profile, starts/stops a container
VM, and switches NVIDIA/Intel GPU mode (`prime-select`) — all from one
dropdown, positioned correctly by GNOME Shell itself instead of guessing
where a tray icon is.

## Install

**Not one click.** You need the extension (EGO / Extension Manager) **and** a one-time helper install from GitHub.

→ **[INSTALL.md](INSTALL.md)** — step-by-step for end users

Quick summary:

1. Install **CPU Turbo** from Extension Manager or [extensions.gnome.org](https://extensions.gnome.org)
2. Run once in a terminal:

```bash
git clone https://github.com/binaryplates/cpu-turbo-widget.git
cd cpu-turbo-widget
./scripts/install-helper.sh
```

Developers: `./scripts/install.sh` installs helper + extension from a git checkout.

On Wayland, a brand-new extension may need one log out/in before the panel icon appears.

## Privilege model

Turbo toggling and GPU mode switching write to files a normal user can't
write to directly. Rather than a sudoers NOPASSWD rule, this uses a polkit
action (`polkit/net.blazorplate.cputurbo.policy`) plus a small, fixed-argv,
root-owned helper (`backend/cpu-turbo-helper`) invoked via `pkexec` — you'll
get a normal graphical authentication prompt the first time, not a silent
sudo.

## Layout

```
cpu-turbo@blazorplate.net/   GNOME Shell extension (GJS)
backend/                     privileged helper (EGO dependency, not in zip)
polkit/                      polkit action definition for the privileged helper
schemas/                     GSettings schema (refresh interval)
scripts/                     install.sh, install-helper.sh, ego-pack.sh
```

## Config

`refresh-seconds` (GSettings, `org.gnome.shell.extensions.cpu-turbo`) —
edit via the extension's Settings… menu row.
