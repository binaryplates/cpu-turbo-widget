import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { CpuTurboIndicator } from './lib/panelButton.js';

export default class CpuTurboExtension extends Extension {
    enable() {
        this._indicator = new CpuTurboIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
