import {readUIPreference,writeUIPreference} from './ui-preferences.mjs';
const KEY = 'desktop-writing-layout-v1';
export function layoutPreferences(value = {}) {
    return {
        view: ['workbench', 'body', 'discussion'].includes(value?.view) ? value.view : 'workbench',
        left: Number.isFinite(value?.left) ? Math.max(170, Math.min(340, value.left)) : 200,
        right: Number.isFinite(value?.right) ? Math.max(28, Math.min(60, value.right)) : 28,
        navigation: value?.navigation !== false,
    };
}
export class WritingLayout {
    constructor({ save = () => {} } = {}) {
        this.save = save;
        try { this.preferences = layoutPreferences(readUIPreference('writingLayout',{},KEY)); }
        catch { this.preferences = layoutPreferences(); }
        this.root = document.getElementById('dw-workbench');
        this.mobile = matchMedia('(max-width: 900px)'); this.drawer = false;
        this.mobile.addEventListener('change', () => { this.drawer = false; this.apply(); });
        for (const handle of this.root.querySelectorAll('.dw-resizer')) this.bindHandle(handle);
        this.apply();
    }
    persist() { writeUIPreference('writingLayout',this.preferences); this.save({ ...this.preferences }); }
    restore(value) { if (value) this.preferences = layoutPreferences(value); this.apply(); }
    setView(view) { this.preferences.view = layoutPreferences({ view }).view; this.drawer = false; this.persist(); this.apply(); }
    toggleNavigation() {
        if (this.mobile.matches) this.drawer = !this.drawer;
        else if (this.preferences.view !== 'workbench') { this.preferences.view = 'workbench'; this.preferences.navigation = true; }
        else this.preferences.navigation = !this.preferences.navigation;
        this.persist(); this.apply();
    }
    showReferences() {
        document.getElementById('dw-navigation-tab').value = 'references';
        this.preferences.navigation = true; this.drawer = true;
        if (!this.mobile.matches) this.preferences.view = 'workbench';
        this.persist(); this.apply();
    }
    apply() {
        const p = this.preferences, narrow = this.mobile.matches;
        const view = narrow && p.view === 'workbench' ? 'discussion' : p.view;
        this.root.dataset.view = view;
        this.root.style.setProperty('--dw-navigation-width', p.left + 'px');
        this.root.style.setProperty('--dw-discussion-width', `clamp(300px,${p.right*.8}vw,560px)`);
        const navigation = narrow ? this.drawer : p.navigation && view === 'workbench';
        this.root.style.setProperty('--dw-left-space', navigation && !narrow ? (p.left + 7) + 'px' : '0px');
        document.getElementById('dw-navigation').hidden = !navigation;
        document.getElementById('dw-main').hidden = view === 'discussion';
        document.getElementById('dw-discussion').hidden = view === 'body';
        for (const handle of this.root.querySelectorAll('.dw-resizer')) {
            handle.hidden = narrow || view !== 'workbench' || (handle.dataset.pane === 'left' && !navigation);
            handle.setAttribute('aria-valuenow', Math.round(handle.dataset.pane === 'left' ? p.left : p.right));
        }
        document.querySelectorAll('#dw-viewbar [data-view]').forEach(b => {
            b.hidden = narrow && b.dataset.view === 'workbench';
            b.setAttribute('aria-pressed', String(b.dataset.view === view));
        });
        document.querySelector('#dw-viewbar [data-dw-action="navigation"]').setAttribute('aria-expanded', String(navigation));
        const references = document.getElementById('dw-navigation-tab').value === 'references';
        document.getElementById('dw-chapter-panel').hidden = references;
        document.getElementById('dw-references').hidden = !references;
    }
    resize(pane, value) {
        this.preferences = layoutPreferences({ ...this.preferences, [pane]: value });
        this.apply();
    }
    bindHandle(handle) {
        const pane = handle.dataset.pane;
        handle.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const key = pane === 'left' ? 'left' : 'right', direction = event.key === 'ArrowRight' ? 1 : -1;
            const value = event.key === 'Home' ? (pane === 'left' ? 170 : 28) : event.key === 'End' ? (pane === 'left' ? 340 : 60) : this.preferences[key] + direction * (pane === 'left' ? 10 : -2);
            this.resize(key, value); this.persist();
        });
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault(); handle.setPointerCapture(event.pointerId);
            const start = event.clientX, initial = this.preferences[pane];
            const width = this.root.getBoundingClientRect().width;
            const move = e => this.resize(pane, initial + (pane === 'left' ? e.clientX - start : (start - e.clientX) * 100 / width));
            const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); handle.removeEventListener('lostpointercapture', end); this.persist(); };
            handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
        });
    }
}
