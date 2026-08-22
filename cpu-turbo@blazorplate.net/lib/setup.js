import GLib from 'gi://GLib';

import { DEPENDENCY_ERROR } from './messages.js';

export const HELPER_DEST = '/usr/local/libexec/cpu-turbo-helper';

export function isSystemHelperInstalled() {
    return GLib.file_test(HELPER_DEST, GLib.FileTest.IS_EXECUTABLE);
}

export async function ensureSystemHelper() {
    if (isSystemHelperInstalled())
        return { ok: true };

    return {
        ok: false,
        error: DEPENDENCY_ERROR,
    };
}
