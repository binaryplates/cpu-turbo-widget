import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { CpuTurboIndicator } from './lib/panelButton.js';
import { ensureSystemHelper } from './lib/setup.js';
import { DEPENDENCY_NOTIFY_BODY } from './lib/messages.js';

export default class CpuTurboExtension extends Extension {
    enable() {
        this._indicator = new CpuTurboIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        ensureSystemHelper().then(result => {
            if (!result.ok) {
                Main.notify(
                    'CPU Turbo — setup required',
                    result.error || DEPENDENCY_NOTIFY_BODY,
                );
            }
        });
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
