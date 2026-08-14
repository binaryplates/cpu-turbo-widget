import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const REFRESH_PRESETS = [[5, '5 seconds'], [15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [300, '5 minutes']];

export default class CpuTurboPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({ title: 'CPU Turbo' });
        page.add(group);

        const model = new Gtk.StringList();
        REFRESH_PRESETS.forEach(([, label]) => model.append(label));
        const current = settings.get_int('refresh-seconds');
        const currentIndex = Math.max(0, REFRESH_PRESETS.findIndex(([secs]) => secs === current));

        const row = new Adw.ComboRow({
            title: 'Refresh interval',
            subtitle: 'How often the report updates while the menu is open',
            model,
            selected: currentIndex,
        });
        row.connect('notify::selected', () => {
            const [secs] = REFRESH_PRESETS[row.selected];
            settings.set_int('refresh-seconds', secs);
        });
        group.add(row);

        window.add(page);
    }
}
