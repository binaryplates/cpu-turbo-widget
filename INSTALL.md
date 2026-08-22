# Install CPU Turbo

CPU Turbo is **two parts**:

1. **Extension** — panel icon and menu (from Extension Manager or extensions.gnome.org)
2. **Helper** — small system component for turbo and GPU switching (from GitHub, one time)

Install both. The extension alone is not enough.

## Step 1 — Extension (one click)

- Open **Extension Manager**, search for **CPU Turbo**, install and enable  
  **or**
- Install from [extensions.gnome.org](https://extensions.gnome.org)

On Wayland, you may need to log out and back in once before the panel icon appears.

## Step 2 — Helper (one time, terminal)

Open a terminal and run:

```bash
git clone https://github.com/binaryplates/cpu-turbo-widget.git
cd cpu-turbo-widget
./scripts/install-helper.sh
```

You will be asked for your password once (sudo) to install the helper and polkit policy.

## All-in-one from GitHub (developers)

If you already use git, this installs the helper **and** the extension:

```bash
git clone https://github.com/binaryplates/cpu-turbo-widget.git
cd cpu-turbo-widget
./scripts/install.sh
```

## Check it works

1. Click the CPU Turbo icon in the top panel.
2. Try toggling turbo — you should get a normal polkit prompt (not silent sudo).
3. If turbo does not change, run Step 2 again.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No panel icon after install | Log out/in, then enable the extension in Extension Manager |
| “Install cpu-turbo-helper first” notification | Run Step 2 |
| Toggle does nothing | Run `./scripts/install-helper.sh` again |

Repository: https://github.com/binaryplates/cpu-turbo-widget
