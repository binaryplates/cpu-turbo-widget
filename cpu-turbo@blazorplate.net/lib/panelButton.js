import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { StatusRunner } from './statusRunner.js';
import { PerfActions } from './perfActions.js';
import { ReportRows } from './reportRows.js';
import { readNoTurbo } from './sysReport.js';

const PROFILES = [['performance', 'Performance'], ['balanced', 'Balanced'], ['power-saver', 'Saver']];
const PRIME_MODES = [['nvidia', 'NVIDIA'], ['on-demand', 'On-demand'], ['intel', 'Intel']];
const REFRESH_LABELS = { 5: '5s', 15: '15s', 30: '30s', 60: '1m', 300: '5m' };

export const CpuTurboIndicator = GObject.registerClass(
class CpuTurboIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'CPU Turbo');
        this._extension = extension;
        this._settings = extension.getSettings();

        this._iconOn = Gio.icon_new_for_string(`${extension.path}/icons/cpu-turbo-gauge-on.png`);
        this._iconOff = Gio.icon_new_for_string(`${extension.path}/icons/cpu-turbo-gauge-off.png`);
        this._icon = new St.Icon({ gicon: this._iconOff, style_class: 'system-status-icon' });
        this.add_child(this._icon);

        this._statusRunner = new StatusRunner(this._settings, extension.path);
        this._perf = new PerfActions();

        this._nowSnap = null;
        this._prevSnap = null;
        this._busy = false;
        this._gpuPendingMode = null;
        this._actionSeq = 0;
        this._menuOpen = false;
        this._iconPollId = 0;

        this.menu.box.add_style_class_name('cpu-turbo-menu');
        this._buildMenu();
        this._startIconPoll();

        this.menu.connect('open-state-changed', (menu, open) => {
            this._menuOpen = open;
            if (open) {
                this._stopIconPoll();
                this._statusRunner.startPolling(payload => this._onStatus(payload));
                this._refreshCooling();
            } else {
                this._statusRunner.stopPolling();
                this._startIconPoll();
            }
        });
    }

    _updatePanelIcon() {
        const turboOn = readNoTurbo() === 0;
        const gicon = turboOn ? this._iconOn : this._iconOff;
        if (this._icon.gicon !== gicon)
            this._icon.gicon = gicon;
    }

    _startIconPoll() {
        this._stopIconPoll();
        this._updatePanelIcon();
        const seconds = this._settings.get_int('refresh-seconds') || 5;
        this._iconPollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._updatePanelIcon();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopIconPoll() {
        if (this._iconPollId) {
            GLib.source_remove(this._iconPollId);
            this._iconPollId = 0;
        }
    }

    _wrap(widget) {
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        item.add_child(widget);
        return item;
    }

    _sectionLabel(text, centered = false) {
        const params = { text, style_class: 'cpu-turbo-section-head' };
        if (centered) {
            params.x_expand = true;
            params.x_align = Clutter.ActorAlign.CENTER;
        }
        return new St.Label(params);
    }

    _sectionBlock(title, ...children) {
        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'cpu-turbo-section-block',
        });
        box.add_child(this._sectionLabel(title, true));
        for (const child of children)
            box.add_child(child);
        return box;
    }

    _buildMenu() {
        this.menu.addMenuItem(this._wrap(this._buildHeader()));
        this.menu.addMenuItem(this._wrap(this._buildToggleRow()));

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const battery = this._buildChipRow(PROFILES, key => this._onProfile(key));
        this._profileChips = battery.buttons;
        this.menu.addMenuItem(this._wrap(this._sectionBlock('POWER PROFILE', battery.row)));

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._wrap(this._sectionBlock('CONTAINERS', this._buildContainersRow())));

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const gpu = this._buildChipRow(PRIME_MODES, key => this._onPrime(key));
        this._primeChips = gpu.buttons;
        this._gpuConfirmBox = new St.BoxLayout({ vertical: true, visible: false, style_class: 'cpu-turbo-gpu-confirm' });
        this.menu.addMenuItem(this._wrap(this._sectionBlock('GRAPHICS', gpu.row, this._gpuConfirmBox)));

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._reportRows = new ReportRows();
        this.menu.addMenuItem(this._wrap(this._reportRows.actor));

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settingsItem = new PopupMenu.PopupMenuItem('Settings…');
        settingsItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(settingsItem);
    }

    _buildHeader() {
        const row = new St.BoxLayout({ style_class: 'cpu-turbo-header-row', x_expand: true });
        row.add_child(new St.Label({
            text: 'CPU TURBO',
            style_class: 'cpu-turbo-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        }));
        return row;
    }

    _buildToggleRow() {
        const box = new St.BoxLayout({ vertical: true, x_expand: true });
        this._toggleBtn = new St.Button({ style_class: 'cpu-turbo-toggle-btn cpu-turbo-off', label: '●  OFF' });
        this._toggleBtn.connect('clicked', () => this._onToggle());
        const toggleWrap = new St.BoxLayout({ x_expand: true, x_align: Clutter.ActorAlign.CENTER });
        toggleWrap.add_child(this._toggleBtn);
        box.add_child(toggleWrap);
        this._clockLine = new St.Label({
            text: '',
            style_class: 'cpu-turbo-clock-line',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._clockLine);
        this._refreshBtn = new St.Button({ style_class: 'cpu-turbo-icon-btn', child: new St.Icon({ icon_name: 'view-refresh-symbolic', style_class: 'cpu-turbo-icon-btn-icon' }) });
        this._refreshBtn.connect('clicked', () => this._statusRunner.refreshNow());
        const refreshWrap = new St.BoxLayout({ x_expand: true, x_align: Clutter.ActorAlign.CENTER, style_class: 'cpu-turbo-refresh-wrap' });
        refreshWrap.add_child(this._refreshBtn);
        box.add_child(refreshWrap);
        return box;
    }

    _buildChipRow(options, onSelect) {
        const row = new St.BoxLayout({
            style_class: 'cpu-turbo-chip-row',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        const buttons = {};
        for (const [key, label] of options) {
            const btn = new St.Button({ label, style_class: 'cpu-turbo-chip' });
            btn.connect('clicked', () => onSelect(key));
            row.add_child(btn);
            buttons[key] = btn;
        }
        return { row, buttons };
    }

    _setActiveChip(buttons, activeKey) {
        for (const [key, btn] of Object.entries(buttons)) {
            if (key === activeKey)
                btn.add_style_class_name('cpu-turbo-chip-active');
            else
                btn.remove_style_class_name('cpu-turbo-chip-active');
        }
    }

    _buildContainersRow() {
        this._dockerBtn = new St.Button({ label: '…', style_class: 'cpu-turbo-chip', x_expand: true });
        this._dockerBtn.connect('clicked', () => this._onDocker());
        return this._dockerBtn;
    }

    _setChipsSensitive(sensitive) {
        for (const btn of Object.values(this._profileChips))
            btn.reactive = sensitive;
        for (const btn of Object.values(this._primeChips))
            btn.reactive = sensitive;
        this._dockerBtn.reactive = sensitive;
    }

    async _refreshCooling() {
        const profile = this._perf.getPowerProfile();
        this._setActiveChip(this._profileChips, profile);

        const dockerResult = await this._perf.dockerStatus();
        if (dockerResult.ok) {
            const running = dockerResult.value;
            this._dockerBtn.label = running ? 'Running — click to stop' : 'Stopped — click to start';
            if (running)
                this._dockerBtn.add_style_class_name('cpu-turbo-chip-active');
            else
                this._dockerBtn.remove_style_class_name('cpu-turbo-chip-active');
        }

        const primeResult = await this._perf.primeStatus();
        if (primeResult.ok)
            this._setActiveChip(this._primeChips, primeResult.value);
    }

    _onStatus(payload) {
        if (!payload.ok) {
            this._reportRows.showError(payload.error || 'refresh failed');
            return;
        }
        this._prevSnap = this._nowSnap;
        this._nowSnap = payload.snapshot;
        this._paint();
    }

    _paint() {
        const snap = this._nowSnap || {};
        const turboOn = snap.turbo === 'ON';
        this._updatePanelIcon();
        this._toggleBtn.label = turboOn ? '●  ON' : '●  OFF';
        this._toggleBtn.remove_style_class_name('cpu-turbo-on');
        this._toggleBtn.remove_style_class_name('cpu-turbo-off');
        this._toggleBtn.add_style_class_name(turboOn ? 'cpu-turbo-on' : 'cpu-turbo-off');
        this._clockLine.text = this._reportRows.clockStatusLine(snap);

        const seconds = this._settings.get_int('refresh-seconds') || 5;
        this._reportRows.update(this._prevSnap, this._nowSnap, REFRESH_LABELS[seconds] || `${seconds}s`);
    }

    async _onToggle() {
        if (this._busy)
            return;
        this._busy = true;
        const target = (this._nowSnap && this._nowSnap.turbo === 'ON') ? 'off' : 'on';
        const payload = await this._statusRunner.apply(target);
        this._busy = false;
        if (!payload.ok) {
            this._reportRows.showError(payload.error || 'toggle failed');
            return;
        }
        this._prevSnap = payload.snapshot ? this._nowSnap : this._prevSnap;
        this._nowSnap = payload.snapshot || this._nowSnap;
        this._paint();
    }

    async _onProfile(key) {
        this._setChipsSensitive(false);
        const err = this._perf.setPowerProfile(key);
        this._setChipsSensitive(true);
        if (err)
            this._reportRows.showError(err);
        else
            this._setActiveChip(this._profileChips, key);
    }

    async _onDocker() {
        this._setChipsSensitive(false);
        const running = this._dockerBtn.has_style_class_name('cpu-turbo-chip-active');
        const result = running ? await this._perf.dockerStop() : await this._perf.dockerStart();
        this._setChipsSensitive(true);
        if (!result.ok)
            this._reportRows.showError(result.error || 'Docker action failed');
        await this._refreshCooling();
    }

    _onPrime(mode) {
        if (this._primeChips[mode] && this._primeChips[mode].has_style_class_name('cpu-turbo-chip-active'))
            return;
        this._gpuPendingMode = mode;
        this._gpuConfirmBox.destroy_all_children();
        const label = PRIME_MODES.find(([k]) => k === mode)?.[1] || mode;
        this._gpuConfirmBox.add_child(new St.Label({
            text: `Switch to ${label}? Save work — needs logout.`,
            style_class: 'cpu-turbo-gpu-confirm-label',
        }));
        const btnRow = new St.BoxLayout({ style_class: 'cpu-turbo-chip-row' });
        const cancelBtn = new St.Button({ label: 'Cancel', style_class: 'cpu-turbo-chip', x_expand: true });
        cancelBtn.connect('clicked', () => {
            this._gpuConfirmBox.visible = false;
            this._gpuPendingMode = null;
        });
        const switchBtn = new St.Button({ label: 'Switch', style_class: 'cpu-turbo-chip cpu-turbo-chip-active', x_expand: true });
        switchBtn.connect('clicked', () => this._confirmPrime());
        btnRow.add_child(cancelBtn);
        btnRow.add_child(switchBtn);
        this._gpuConfirmBox.add_child(btnRow);
        this._gpuConfirmBox.visible = true;
    }

    async _confirmPrime() {
        const mode = this._gpuPendingMode;
        this._gpuConfirmBox.visible = false;
        if (!mode)
            return;
        this._setChipsSensitive(false);
        const result = await this._perf.primeSelect(mode);
        this._setChipsSensitive(true);
        if (!result.ok)
            this._reportRows.showError(result.error || 'GPU switch failed');
        else
            this._setActiveChip(this._primeChips, mode);
    }

    destroy() {
        this._stopIconPoll();
        this._statusRunner?.stopPolling();
        super.destroy();
    }
});
