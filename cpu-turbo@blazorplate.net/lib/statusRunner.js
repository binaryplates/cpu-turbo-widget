import GLib from 'gi://GLib';

import { collectSnapshot, readNoTurbo } from './sysReport.js';
import { runPrivileged } from './privileged.js';
import { ensureSystemHelper, isSystemHelperInstalled } from './setup.js';

export class StatusRunner {
    constructor(settings, extensionPath = null) {
        this._settings = settings;
        this._extensionPath = extensionPath;
        this._timeoutId = 0;
    }

    startPolling(onUpdate) {
        this._onUpdate = onUpdate;
        this.refreshNow();
        this._scheduleNext();
    }

    stopPolling() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    _scheduleNext() {
        this.stopPolling();
        const seconds = this._settings.get_int('refresh-seconds') || 5;
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this.refreshNow();
            this._timeoutId = 0;
            this._scheduleNext();
            return GLib.SOURCE_REMOVE;
        });
    }

    async refreshNow() {
        const payload = { ok: true, snapshot: collectSnapshot() };
        this._onUpdate?.(payload);
        return payload;
    }

    async apply(onOff) {
        const target = onOff === 'on' ? 0 : 1;
        const current = readNoTurbo();
        if (current !== target) {
            if (!isSystemHelperInstalled()) {
                const setup = await ensureSystemHelper();
                if (!setup.ok) {
                    return { ok: false, error: setup.error || 'System setup required.' };
                }
            }
            const result = await runPrivileged(['turbo', onOff]);
            if (!result.ok) {
                const payload = { ok: false, error: result.error || 'toggle failed' };
                return payload;
            }
        }
        const payload = { ok: true, snapshot: collectSnapshot() };
        this._onUpdate?.(payload);
        return payload;
    }
}
