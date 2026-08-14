import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { runPrivileged } from './privileged.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

const POWER_PROFILES_BUS_NAME = 'org.freedesktop.UPower.PowerProfiles';
const POWER_PROFILES_PATH = '/org/freedesktop/UPower/PowerProfiles';
const POWER_PROFILES_IFACE = 'org.freedesktop.UPower.PowerProfiles';
const PRIME_MODES = ['nvidia', 'on-demand', 'intel'];

function sleep(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

export class PerfActions {
    constructor() {
        this._profileProxy = null;
    }

    _getProfileProxy() {
        if (!this._profileProxy) {
            this._profileProxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
                POWER_PROFILES_BUS_NAME, POWER_PROFILES_PATH, POWER_PROFILES_IFACE, null);
        }
        return this._profileProxy;
    }

    getPowerProfile() {
        try {
            const value = this._getProfileProxy().get_cached_property('ActiveProfile');
            return value ? value.unpack() : 'unknown';
        } catch (e) {
            return 'unknown';
        }
    }

    setPowerProfile(name) {
        try {
            this._getProfileProxy().call_sync(
                'org.freedesktop.DBus.Properties.Set',
                new GLib.Variant('(ssv)', [
                    POWER_PROFILES_IFACE, 'ActiveProfile', new GLib.Variant('s', name),
                ]),
                Gio.DBusCallFlags.NONE, -1, null);
            return null;
        } catch (e) {
            return e.message;
        }
    }

    async _run(argv, timeoutSeconds = 20) {
        try {
            const proc = new Gio.Subprocess({
                argv, flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);
            const cancellable = timeoutSeconds ? Gio.Cancellable.new() : null;
            let timeoutId = 0;
            if (cancellable) {
                timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeoutSeconds, () => {
                    cancellable.cancel();
                    return GLib.SOURCE_REMOVE;
                });
            }
            try {
                const [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
                return { ok: proc.get_successful(), stdout: stdout.trim(), stderr: stderr.trim() };
            } finally {
                if (timeoutId)
                    GLib.source_remove(timeoutId);
            }
        } catch (e) {
            return { ok: false, stdout: '', stderr: e.message };
        }
    }

    async dockerStatus() {
        const r = await this._run(['systemctl', '--user', 'is-active', 'docker-desktop']);
        return { ok: true, value: r.stdout === 'active' };
    }

    async _dockerEngineReady() {
        const r = await this._run(['docker', 'info'], 8);
        return r.ok;
    }

    async dockerStart() {
        await this._run(['systemctl', '--user', 'start', 'docker-desktop'], 90);
        const deadline = GLib.get_monotonic_time() + 120 * 1000000;
        while (GLib.get_monotonic_time() < deadline) {
            if (await this._dockerEngineReady())
                return { ok: true, error: null };
            await sleep(1500);
        }
        return { ok: false, error: 'Docker Desktop started, but the engine is not ready yet.' };
    }

    async dockerStop() {
        await this._run(['systemctl', '--user', 'stop', 'docker-desktop'], 90);
        const deadline = GLib.get_monotonic_time() + 120 * 1000000;
        while (GLib.get_monotonic_time() < deadline) {
            const status = await this.dockerStatus();
            const ready = await this._dockerEngineReady();
            if (!status.value && !ready)
                return { ok: true, error: null };
            await sleep(1500);
        }
        return { ok: true, error: null };
    }

    async primeStatus() {
        const r = await this._run(['prime-select', 'query'], 5);
        return { ok: true, value: r.stdout || 'unknown' };
    }

    async primeSelect(mode) {
        if (!PRIME_MODES.includes(mode))
            return { ok: false, error: `unknown GPU mode: ${mode}` };
        return runPrivileged(['prime', mode]);
    }
}
