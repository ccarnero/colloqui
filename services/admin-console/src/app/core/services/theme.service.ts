import { effect, Injectable, signal } from "@angular/core";

const LOG_PREFIX = "[ThemeService]";

@Injectable({ providedIn: "root" })
export class ThemeService {
  private readonly STORAGE_KEY = "admin-console-theme";

  readonly isDark = signal(this.loadPreference());

  constructor() {
    effect(() => {
      const dark = this.isDark();
      const themeName = dark ? "dark" : "light";

      // Legacy mechanism (pre-T02): CSS class toggled on <html>, kept
      // alongside the new attribute so old screens/selectors that already
      // depend on `.light-theme` keep working (user decision 3).
      document.documentElement.classList.toggle("light-theme", !dark);

      // New mechanism (T02): `data-theme` attribute on <html>, consumed by
      // the redesign token scopes in src/styles.scss ([data-theme="light"]).
      document.documentElement.setAttribute("data-theme", themeName);

      localStorage.setItem(this.STORAGE_KEY, themeName);

      console.debug(
        `${LOG_PREFIX} theme applied: ${themeName} (data-theme attribute + light-theme class + localStorage persisted)`
      );
    });
  }

  toggle(): void {
    console.debug(
      `${LOG_PREFIX} toggle() called, current isDark=${this.isDark()}`
    );
    this.isDark.update((v) => !v);
  }

  private loadPreference(): boolean {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored) {
      console.debug(
        `${LOG_PREFIX} restoring persisted preference from localStorage: ${stored}`
      );
      return stored === "dark";
    }

    // Dark is the default theme (user decision 2): no persisted preference
    // means dark, regardless of the OS `prefers-color-scheme` setting.
    console.debug(
      `${LOG_PREFIX} no persisted preference found, defaulting to dark theme (dark is the default per user decision 2)`
    );
    return true;
  }
}
