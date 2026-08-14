import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {
    fmtTemp, tempClass, fmtFreq, fmtFan, fmtLoad, fmtDelta,
    friendlyHeadroom, skinFeel, buildSummary, clockStatusLine,
} from './format.js';

const TEMP_CLASSES = ['cpu-turbo-temp-cool', 'cpu-turbo-temp-ok', 'cpu-turbo-temp-warm', 'cpu-turbo-temp-hot', 'cpu-turbo-temp-crit'];

function applyTempClass(label, value, kind = 'cpu') {
    for (const cls of TEMP_CLASSES)
        label.remove_style_class_name(cls);
    const cls = tempClass(value, kind);
    if (cls)
        label.add_style_class_name(`cpu-turbo-${cls}`);
}

const GRID_ROWS = [
    ['package', 'CPU package', 'temp', 'cpu'],
    ['skin', 'Chassis sensor', 'temp', 'skin'],
    ['gpu', 'GPU', 'temp', 'gpu'],
    ['freq_avg', 'Clock request', 'freq', null],
    ['fan', 'Fan', 'fan', null],
    ['load1', 'Load', 'load', null],
];

function fmtByKind(kind, value) {
    if (kind === 'temp')
        return fmtTemp(value);
    if (kind === 'freq')
        return fmtFreq(value);
    if (kind === 'fan')
        return fmtFan(value);
    return fmtLoad(value);
}

export class ReportRows {
    constructor() {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'cpu-turbo-report-rows' });
        this._buildHero();
        this._buildGrid();
        this._buildSummary();
    }

    _buildHero() {
        const hero = new St.BoxLayout({
            style_class: 'cpu-turbo-hero-row',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._dieValue = new St.Label({
            style_class: 'cpu-turbo-hero-value', text: '—',
            x_expand: true, x_align: Clutter.ActorAlign.CENTER,
        });
        this._dieCaption = new St.Label({
            style_class: 'cpu-turbo-hero-caption', text: 'CPU package',
            x_expand: true, x_align: Clutter.ActorAlign.CENTER,
        });
        const dieCol = new St.BoxLayout({ vertical: true });
        dieCol.add_child(this._dieValue);
        dieCol.add_child(this._dieCaption);

        this._skinValue = new St.Label({
            style_class: 'cpu-turbo-hero-value', text: '—',
            x_expand: true, x_align: Clutter.ActorAlign.CENTER,
        });
        this._skinCaption = new St.Label({
            style_class: 'cpu-turbo-hero-caption', text: 'Chassis sensor',
            x_expand: true, x_align: Clutter.ActorAlign.CENTER,
        });
        const skinCol = new St.BoxLayout({ vertical: true });
        skinCol.add_child(this._skinValue);
        skinCol.add_child(this._skinCaption);

        hero.add_child(dieCol);
        hero.add_child(skinCol);
        this.actor.add_child(hero);
    }

    _buildGrid() {
        const section = new St.Label({ style_class: 'cpu-turbo-section-head', text: 'REPORT' });
        this.actor.add_child(section);
        this._reportMeta = new St.Label({ style_class: 'cpu-turbo-report-meta', text: '' });
        this.actor.add_child(this._reportMeta);

        const layout = new Clutter.GridLayout({ column_spacing: 14, row_spacing: 4 });
        const grid = new St.Widget({ layout_manager: layout, style_class: 'cpu-turbo-grid', x_expand: true });
        this._gridRow(layout, 0, ['Metric', 'Prev', 'Now', 'Δ'], true);
        this._rowLabels = {};
        GRID_ROWS.forEach(([key, label], i) => {
            this._rowLabels[key] = this._gridRow(layout, i + 1, [label, 'n/a', 'n/a', 'n/a'], false);
        });
        this.actor.add_child(grid);
    }

    _gridRow(layout, rowIndex, cells, isHeader) {
        const labels = cells.map((text, col) => {
            const label = new St.Label({
                text: String(text),
                style_class: isHeader ? 'cpu-turbo-grid-head' : 'cpu-turbo-grid-row',
                x_align: col === 0 ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            layout.attach(label, col, rowIndex, 1, 1);
            return label;
        });
        return labels;
    }

    _buildSummary() {
        const section = new St.Label({ style_class: 'cpu-turbo-section-head', text: 'SUMMARY' });
        this.actor.add_child(section);
        this._summaryBox = new St.BoxLayout({ vertical: true, style_class: 'cpu-turbo-summary-box' });
        this.actor.add_child(this._summaryBox);
        this._errorLabel = new St.Label({ style_class: 'cpu-turbo-error', text: '', visible: false });
        this._errorLabel.clutter_text.line_wrap = true;
        this.actor.add_child(this._errorLabel);
    }

    showError(message) {
        this._summaryBox.destroy_all_children();
        this._errorLabel.text = message;
        this._errorLabel.visible = true;
    }

    update(prev, now, intervalLabel = '') {
        this._errorLabel.visible = false;

        const pkg = now.package;
        const skin = now.skin;
        this._dieValue.text = pkg !== null && pkg !== undefined ? `${Math.round(parseFloat(pkg))}°` : '—';
        this._skinValue.text = skin !== null && skin !== undefined ? `${Math.round(parseFloat(skin))}°` : '—';
        applyTempClass(this._dieValue, pkg, 'cpu');
        applyTempClass(this._skinValue, skin, 'skin');
        const headroom = now.headroom || '';
        this._dieCaption.text = headroom ? `CPU package · ${friendlyHeadroom(headroom)}` : 'CPU package';
        const skinBand = skinFeel(skin);
        this._skinCaption.text = skinBand ? `Chassis sensor · ${skinBand[0]}` : 'Chassis sensor';

        const ts = now.timestamp || '';
        const clock = ts ? ts.split(' ').pop().slice(0, 5) : '—';
        this._reportMeta.text = intervalLabel ? `${clock} · every ${intervalLabel}` : clock;

        for (const [key, , kind, tempKind] of GRID_ROWS) {
            const [, prevLabel, nowLabel, deltaLabel] = this._rowLabels[key];
            const b = prev ? prev[key] : null;
            const n = now[key];
            prevLabel.text = prev ? fmtByKind(kind, b) : 'n/a';
            nowLabel.text = fmtByKind(kind, n);
            deltaLabel.text = prev ? fmtDelta(b, n, kind) : 'n/a';
            if (tempKind) {
                applyTempClass(prevLabel, prev ? b : null, tempKind);
                applyTempClass(nowLabel, n, tempKind);
            }
        }

        this._summaryBox.destroy_all_children();
        for (const [key, val] of buildSummary(prev, now)) {
            const row = new St.BoxLayout({ style_class: 'cpu-turbo-summary-row' });
            row.add_child(new St.Label({ text: key, style_class: 'cpu-turbo-summary-key' }));
            const v = new St.Label({ text: val, style_class: 'cpu-turbo-summary-val', x_expand: true });
            v.clutter_text.line_wrap = true;
            row.add_child(v);
            this._summaryBox.add_child(row);
        }
    }

    clockStatusLine(snap) {
        return clockStatusLine(snap);
    }
}
