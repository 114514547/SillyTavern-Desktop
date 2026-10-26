// Profile-scoped UI preferences. Old port-scoped localStorage is read only for migration.
const NAMESPACE = 'desktop_ui_v1';
export function readUIPreference(key, fallback, legacyKey) {
    const settings = globalThis.SillyTavern?.getContext?.().extensionSettings;
    const stored = settings?.[NAMESPACE]?.[key];
    if (stored !== undefined) return structuredClone(stored);
    if (legacyKey) try {
        const value = JSON.parse(localStorage.getItem(legacyKey));
        if (value !== null) return value;
    } catch { /* A malformed old layout must not prevent startup. */ }
    return structuredClone(fallback);
}
export function writeUIPreference(key, value) {
    const context = globalThis.SillyTavern?.getContext?.();
    if (!context?.extensionSettings) return false;
    const previous = context.extensionSettings[NAMESPACE];
    const bank = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
    context.extensionSettings[NAMESPACE] = bank;
    bank[key] = structuredClone(value);
    context.saveSettingsDebounced();
    return true;
}
