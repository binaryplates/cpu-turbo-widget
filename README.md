# CPU Turbo

A native GNOME Shell extension: a panel indicator that toggles Intel CPU
Turbo Boost, switches the system power profile, starts/stops a container
VM, and switches NVIDIA/Intel GPU mode (`prime-select`) — all from one
dropdown, positioned correctly by GNOME Shell itself instead of guessing
where a tray icon is.

## Install

```bash
scripts/install.sh
```

This installs the extension to
`~/.local/share/gnome-shell/extensions/cpu-turbo@blazorplate.net`, installs
the polkit policy + privileged helper needed for the turbo/GPU-mode writes,
and enables the extension. On Wayland, a brand-new extension needs one
log out/in before GNOME Shell picks it up for the first time.

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
snap/           legacy Snap Store packaging (superseded by this extension,
                kept only because the old Snap Store listing still exists)
```

## Config

`refresh-seconds` (GSettings, `org.gnome.shell.extensions.cpu-turbo`) —
edit via the extension's Settings… menu row.
