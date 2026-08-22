import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'wait_async', 'wait_finish');

export const HELPER_DEST = '/usr/local/libexec/cpu-turbo-helper';

export function isSystemHelperInstalled() {
    return GLib.file_test(HELPER_DEST, GLib.FileTest.IS_EXECUTABLE);
}

export async function ensureSystemHelper(extensionPath) {
    if (isSystemHelperInstalled())
        return { ok: true };

    const installer = GLib.build_filenamev([extensionPath, 'backend', 'install-system-helper']);
    if (!GLib.file_test(installer, GLib.FileTest.IS_EXECUTABLE))
        return { ok: false, error: 'Setup helper missing from extension files.' };

    try {
        const proc = Gio.Subprocess.new(
            ['pkexec', installer, extensionPath],
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE,
        );
        await proc.wait_async(null);
        if (!proc.get_successful()) {
            const [, stderr] = proc.communicate_utf8(null, null);
            const msg = (stderr || '').trim();
            if (msg.includes('dismissed') || msg.includes('Not authorized'))
                return { ok: false, error: 'System setup cancelled. Turbo and GPU switching need a one-time authorization.' };
            return { ok: false, error: msg || 'System setup failed.' };
        }
        if (!isSystemHelperInstalled())
            return { ok: false, error: 'Setup finished but helper is still missing.' };
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}
