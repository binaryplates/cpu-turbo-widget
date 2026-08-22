import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { CpuTurboIndicator } from './lib/panelButton.js';
import { ensureSystemHelper } from './lib/setup.js';

export default class CpuTurboExtension extends Extension {
    enable() {
        this._indicator = new CpuTurboIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        ensureSystemHelper(this.path).then(result => {
            if (!result.ok) {
                Main.notify(
                    'CPU Turbo',
                    result.error || 'One-time system authorization is required for turbo and GPU switching.',
                );
            }
        });
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
