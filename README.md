# CPU Turbo

A native GNOME Shell extension: a panel indicator that toggles Intel CPU
Turbo Boost, switches the system power profile, starts/stops a container
VM, and switches NVIDIA/Intel GPU mode (`prime-select`) — all from one
dropdown, positioned correctly by GNOME Shell itself instead of guessing
where a tray icon is.

## Install

Install from **Extension Manager** or [extensions.gnome.org](https://extensions.gnome.org) and enable the extension.

On first enable, CPU Turbo shows a **one-time authorization prompt** so turbo and GPU switching can work. No GitHub or manual setup required.

Developers can still use `scripts/install.sh` to deploy from a git checkout.

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
lib/            PanelMenu.Button + PopupMenu UI (GJS)
backend/        privileged helper + any scripts still needed for things
                with no GJS equivalent (docker, systemctl, prime-select)
polkit/         polkit action definition for the privileged helper
schemas/        GSettings schema (refresh interval)
scripts/        install.sh
snap/           legacy tray Snap/deb packaging (discontinued; channels closed)
```

## Config

`refresh-seconds` (GSettings, `org.gnome.shell.extensions.cpu-turbo`) —
edit via the extension's Settings… menu row.
