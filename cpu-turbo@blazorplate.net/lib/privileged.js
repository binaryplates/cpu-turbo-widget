import Gio from 'gi://Gio';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

export const HELPER_PATH = '/usr/local/libexec/cpu-turbo-helper';

// Runs the fixed-argv, root-owned helper via pkexec (see ../polkit/*.policy).
// pkexec shows a normal graphical auth prompt — never a silent sudo.
export async function runPrivileged(args) {
    try {
        const proc = new Gio.Subprocess({
            argv: ['pkexec', HELPER_PATH, ...args],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);
        const [stdout, stderr] = await proc.communicate_utf8_async(null, null);
        if (!proc.get_successful())
            return { ok: false, error: (stderr || stdout || 'privileged action failed').trim() };
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}
