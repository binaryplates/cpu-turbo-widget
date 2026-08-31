// Formatting/threshold helpers ported 1:1 from cpu_turbo_widget.py.

export function displayedTemp(value) {
    if (value === null || value === undefined)
        return null;
    return Math.round(parseFloat(value));
}

export function friendlyHeadroom(text) {
    const raw = (text || '').trim();
    if (raw.includes('below crit'))
        return raw.replace('below crit', 'below limit').replace('°C below', '° below');
    return raw;
}

export function skinFeel(temp) {
    const t = displayedTemp(temp);
    if (t === null)
        return null;
    if (t >= 70)
        return ['very hot', 'Feels very hot', 'temp-crit'];
    if (t >= 60)
        return ['hot', 'Feels hot', 'temp-hot'];
    if (t >= 55)
        return ['warm', 'Warm', 'temp-warm'];
    if (t >= 48)
        return ['comfortable', 'Comfortable', 'temp-ok'];
    return ['comfortable', 'Comfortable', 'temp-cool'];
}

export function fmtTemp(value) {
    if (value === null || value === undefined)
        return 'n/a';
    return `${parseFloat(value).toFixed(0)}°`;
}

export function tempClass(value, kind = 'cpu') {
    if (value === null || value === undefined)
        return null;
    if (kind === 'skin') {
        const band = skinFeel(value);
        return band ? band[2] : null;
    }
    const t = displayedTemp(value);
    if (t === null)
        return null;
    if (t < 50)
        return 'temp-cool';
    if (t < 70)
        return 'temp-ok';
    if (t < 80)
        return 'temp-warm';
    if (t < 90)
        return 'temp-hot';
    return 'temp-crit';
}

export function fmtFreq(mhz) {
    if (mhz === null || mhz === undefined)
        return 'n/a';
    const v = parseFloat(mhz);
    if (v >= 1000)
        return `${(v / 1000).toFixed(1)}G`;
    return `${v.toFixed(0)}M`;
}

const BOOST_ABOVE_BASE_MHZ = 700;

export function clockStatusLine(snap) {
    const clock = fmtFreq(snap.freq_avg);
    const turbo = snap.turbo;
    if (turbo === 'OFF')
        return `${clock} · no boost`;
    if (turbo !== 'ON')
        return clock;
    const peak = snap.freq_max ?? snap.freq_avg;
    const base = snap.freq_base;
    if (peak !== null && peak !== undefined && base !== null && base !== undefined) {
        if (parseFloat(peak) > parseFloat(base) + BOOST_ABOVE_BASE_MHZ)
            return `${clock} · boosting`;
        return `${clock} · boost allowed`;
    }
    return `${clock} · boost allowed`;
}

export function fmtFan(rpm) {
    if (rpm === null || rpm === undefined)
        return 'n/a';
    return `${parseFloat(rpm).toFixed(0)}`;
}

export function fmtLoad(val) {
    if (val === null || val === undefined)
        return 'n/a';
    return parseFloat(val).toFixed(2);
}

export function fmtDelta(before, now, kind) {
    if (before === null || before === undefined || now === null || now === undefined)
        return 'n/a';
    if (kind === 'temp') {
        const d = displayedTemp(now) - displayedTemp(before);
        return d >= 0 ? `+${d}°` : `${d}°`;
    }
    if (kind === 'freq') {
        const b = parseFloat(before), n = parseFloat(now);
        if (b >= 1000 || n >= 1000) {
            const db = parseFloat((b / 1000).toFixed(1));
            const dn = parseFloat((n / 1000).toFixed(1));
            const d = dn - db;
            return `${d >= 0 ? '+' : ''}${d.toFixed(1)}G`;
        }
        const d = Math.round(n) - Math.round(b);
        return d >= 0 ? `+${d}` : `${d}`;
    }
    if (kind === 'fan') {
        const d = Math.round(parseFloat(now)) - Math.round(parseFloat(before));
        return d >= 0 ? `+${d}` : `${d}`;
    }
    const db = parseFloat(parseFloat(before).toFixed(2));
    const dn = parseFloat(parseFloat(now).toFixed(2));
    const d = dn - db;
    return `${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
}

export function cpuTrendNote(turbo, dpkg) {
    if (turbo === 'OFF' && dpkg <= -3)
        return 'Cooling as expected';
    if (turbo === 'OFF' && dpkg >= 3)
        return 'Still heating';
    if (turbo === 'ON' && dpkg >= 3)
        return 'Boost adding heat';
    if (turbo === 'ON' && dpkg <= -3)
        return 'Cooling anyway';
    if (Math.abs(dpkg) < 1)
        return 'Stable';
    return 'Roughly stable';
}

export function palmFeelNote(temp, prev, dpkg) {
    if (temp === null || temp === undefined)
        return '—';
    if (prev !== null && prev !== undefined && dpkg !== null && dpkg !== undefined) {
        const dskin = displayedTemp(temp) - displayedTemp(prev);
        if (dskin > -1 && dpkg <= -3)
            return 'Not caught up yet';
    }
    const band = skinFeel(temp);
    return band ? band[1] : '—';
}

export function buildSummary(prev, now) {
    const turbo = now.turbo ?? '?';
    const rows = [
        ['Turbo', turbo === 'ON' ? 'On' : turbo === 'OFF' ? 'Off' : String(turbo)],
    ];
    const bpkg = prev ? prev.package : null;
    const npkg = now.package;
    let dpkg = null;
    if (npkg !== null && npkg !== undefined && bpkg !== null && bpkg !== undefined) {
        dpkg = displayedTemp(npkg) - displayedTemp(bpkg);
        const note = cpuTrendNote(String(turbo), dpkg);
        if (Math.abs(dpkg) < 1)
            rows.push(['CPU package', `${note} · ${fmtTemp(npkg)}`]);
        else
            rows.push(['CPU package', `${note} · ${fmtTemp(bpkg)} → ${fmtTemp(npkg)}`]);
    } else if (npkg !== null && npkg !== undefined) {
        rows.push(['CPU package', fmtTemp(npkg)]);
    }

    const nskin = now.skin;
    const bskin = prev ? prev.skin : null;
    if (nskin !== null && nskin !== undefined)
        rows.push(['Chassis sensor', palmFeelNote(nskin, bskin, dpkg)]);

    const bfreq = prev ? prev.freq_avg : null;
    const nfreq = now.freq_avg;
    if (nfreq !== null && nfreq !== undefined && bfreq !== null && bfreq !== undefined) {
        const bShow = fmtFreq(bfreq), nShow = fmtFreq(nfreq);
        rows.push(['Clock request', bShow !== nShow ? `${bShow} → ${nShow}` : nShow]);
    } else if (nfreq !== null && nfreq !== undefined) {
        rows.push(['Clock request', fmtFreq(nfreq)]);
    }

    const fan = now.fan || 0;
    const fmax = now.fan_max;
    if (fan && fmax && parseFloat(fan) >= 0.9 * parseFloat(fmax))
        rows.push(['Fan', 'Near max']);

    // Battery charging info
    const battCap = now.batt_capacity;
    const battStatus = now.batt_status;
    const battCurrent = now.batt_current;
    const battPower = now.batt_power;
    const battStart = now.batt_start_thresh;
    const battEnd = now.batt_end_thresh;
    const battChargeMode = now.batt_charge_mode;

    if (battCap !== null && battCap !== undefined) {
        let battLine = `${battCap}%`;
        if (battStatus)
            battLine += ` · ${battStatus}`;
        if (battCurrent !== null && battCurrent !== undefined && battStatus === 'Charging')
            battLine += ` · ${battCurrent.toFixed(2)}A`;
        if (battPower !== null && battPower !== undefined && battStatus === 'Charging')
            battLine += ` (${battPower.toFixed(1)}W)`;
        rows.push(['Battery', battLine]);
    }
    
    if (battChargeMode)
        rows.push(['Charge mode', battChargeMode]);

    if (battChargeMode === 'Custom'
        && battStart !== null && battStart !== undefined
        && battEnd !== null && battEnd !== undefined) {
        rows.push(['Charge profile', `${battStart}-${battEnd}% (Custom)`]);
    } else if (battStart !== null && battStart !== undefined
        && battEnd !== null && battEnd !== undefined) {
        rows.push(['Charge thresholds', `${battStart}-${battEnd}% (inactive)`]);
    }

    return rows;
}
