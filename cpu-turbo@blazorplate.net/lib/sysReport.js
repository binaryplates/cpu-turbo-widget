import GLib from 'gi://GLib';

// Native GJS port of backend/cpu-turbo.sh's collect_snapshot()/headroom_note(),
// producing only the fields lib/reportRows.js and lib/format.js actually
// consume. Reads /sys and /proc directly instead of shelling out.

const NO_TURBO_PATH = '/sys/devices/system/cpu/intel_pstate/no_turbo';
const DEFAULT_TJMAX = 100;

function readTrim(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return null;
        return new TextDecoder().decode(bytes).trim();
    } catch (e) {
        return null;
    }
}

function readNum(path) {
    const raw = readTrim(path);
    if (raw === null || raw === '')
        return null;
    const n = parseFloat(raw);
    return Number.isNaN(n) ? null : n;
}

function celsiusFromMilli(path) {
    const raw = readNum(path);
    return raw === null ? null : parseFloat((raw / 1000).toFixed(1));
}

function listDir(path) {
    const names = [];
    let dir;
    try {
        dir = GLib.Dir.open(path, 0);
    } catch (e) {
        return names;
    }
    let name;
    while ((name = dir.read_name()) !== null)
        names.push(name);
    return names;
}

function findHwmon(want) {
    for (const name of listDir('/sys/class/hwmon')) {
        if (!name.startsWith('hwmon'))
            continue;
        const dir = `/sys/class/hwmon/${name}`;
        if (readTrim(`${dir}/name`) === want)
            return dir;
    }
    return null;
}

function findThermalZone(want) {
    for (const name of listDir('/sys/class/thermal')) {
        if (!name.startsWith('thermal_zone'))
            continue;
        const dir = `/sys/class/thermal/${name}`;
        if (readTrim(`${dir}/type`) === want)
            return dir;
    }
    return null;
}

function mhzFromKhz(khz) {
    return khz === null ? null : Math.round(khz / 1000);
}

function turboWord(noTurbo) {
    if (noTurbo === 0)
        return 'ON';
    if (noTurbo === 1)
        return 'OFF';
    return 'unknown';
}

export function readNoTurbo() {
    const raw = readTrim(NO_TURBO_PATH);
    return raw === null ? null : parseInt(raw, 10);
}

export function collectSnapshot() {
    const noTurbo = readNoTurbo();

    let pkg = null, tjmax = DEFAULT_TJMAX;
    const coretemp = findHwmon('coretemp');
    if (coretemp) {
        pkg = celsiusFromMilli(`${coretemp}/temp1_input`);
        const t = celsiusFromMilli(`${coretemp}/temp1_crit`);
        if (t !== null)
            tjmax = t;
    }

    let gpu = null, fan = null, fanMax = null;
    const dell = findHwmon('dell_smm');
    if (dell) {
        for (let i = 1; i <= 6; i++) {
            const label = readTrim(`${dell}/temp${i}_label`);
            if (label === 'GPU')
                gpu = celsiusFromMilli(`${dell}/temp${i}_input`);
        }
        fan = readNum(`${dell}/fan1_input`);
        fanMax = readNum(`${dell}/fan1_max`);
    }

    let skin = null;
    const tskn = findThermalZone('TSKN');
    if (tskn)
        skin = celsiusFromMilli(`${tskn}/temp`);

    let sum = 0, count = 0, max = 0;
    for (const name of listDir('/sys/devices/system/cpu')) {
        if (!/^cpu\d+$/.test(name))
            continue;
        const cur = readNum(`/sys/devices/system/cpu/${name}/cpufreq/scaling_cur_freq`);
        if (cur === null)
            continue;
        sum += cur;
        count += 1;
        if (cur > max)
            max = cur;
    }
    const freqAvg = count > 0 ? mhzFromKhz(sum / count) : null;
    const freqMax = count > 0 ? mhzFromKhz(max) : null;
    const freqBase = mhzFromKhz(readNum('/sys/devices/system/cpu/cpu0/cpufreq/base_frequency'));

    const loadavg = readTrim('/proc/loadavg');
    const load1 = loadavg ? parseFloat(loadavg.split(' ')[0]) : null;

    const headroom = pkg === null ? '' : `${Math.round(tjmax - pkg)}° below limit`;

    const now = GLib.DateTime.new_now_local();
    const timestamp = now.format('%Y-%m-%d %H:%M:%S');

    return {
        timestamp, no_turbo: noTurbo, turbo: turboWord(noTurbo),
        package: pkg, skin, gpu,
        freq_avg: freqAvg, freq_max: freqMax, freq_base: freqBase,
        fan, fan_max: fanMax, load1, headroom,
    };
}
