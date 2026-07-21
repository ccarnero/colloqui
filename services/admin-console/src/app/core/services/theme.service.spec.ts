import { TestBed } from "@angular/core/testing";
import { ThemeService } from "./theme.service";

function ensureLocalStorage(): void {
  const storage = globalThis.localStorage as Partial<Storage> | undefined;
  if (
    storage &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function" &&
    typeof storage.clear === "function"
  ) {
    return;
  }

  const memory = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return memory.size;
    },
    clear: () => {
      memory.clear();
    },
    getItem: (key: string) => {
      return memory.has(key) ? (memory.get(key) ?? null) : null;
    },
    key: (index: number) => {
      return Array.from(memory.keys())[index] ?? null;
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    setItem: (key: string, value: string) => {
      memory.set(key, String(value));
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    configurable: true,
    writable: true,
  });
}

describe("ThemeService", () => {
  beforeEach(() => {
    ensureLocalStorage();
    localStorage.removeItem("admin-console-theme");
    document.documentElement.classList.remove("light-theme");
    document.documentElement.removeAttribute("data-theme");
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  });

  afterEach(() => {
    document.documentElement.classList.remove("light-theme");
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem("admin-console-theme");
  });

  it("toggle flips isDark signal", () => {
    TestBed.configureTestingModule({ providers: [ThemeService] });
    const svc = TestBed.inject(ThemeService);
    const before = svc.isDark();
    svc.toggle();
    expect(svc.isDark()).toBe(!before);
  });

  it("defaults to dark theme when no preference is persisted and OS has no preference", () => {
    TestBed.configureTestingModule({ providers: [ThemeService] });
    const svc = TestBed.inject(ThemeService);
    expect(svc.isDark()).toBe(true);
  });

  it("restores a persisted light preference on init", () => {
    localStorage.setItem("admin-console-theme", "light");
    TestBed.configureTestingModule({ providers: [ThemeService] });
    const svc = TestBed.inject(ThemeService);
    expect(svc.isDark()).toBe(false);
  });

  it("restores a persisted dark preference on init", () => {
    localStorage.setItem("admin-console-theme", "dark");
    TestBed.configureTestingModule({ providers: [ThemeService] });
    const svc = TestBed.inject(ThemeService);
    expect(svc.isDark()).toBe(true);
  });

  it("sets data-theme=dark and no light-theme class when dark", () => {
    TestBed.configureTestingModule({ providers: [ThemeService] });
    TestBed.inject(ThemeService);
    TestBed.flushEffects();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("light-theme")).toBe(
      false
    );
  });

  it("sets data-theme=light and the legacy light-theme class when toggled to light", () => {
    TestBed.configureTestingModule({ providers: [ThemeService] });
    const svc = TestBed.inject(ThemeService);
    TestBed.flushEffects();
    if (svc.isDark()) {
      svc.toggle();
    }
    TestBed.flushEffects();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.classList.contains("light-theme")).toBe(
      true
    );
  });

  it("persists the theme choice under the admin-console-theme localStorage key", () => {
    TestBed.configureTestingModule({ providers: [ThemeService] });
    const svc = TestBed.inject(ThemeService);
    TestBed.flushEffects();
    svc.toggle();
    TestBed.flushEffects();
    expect(localStorage.getItem("admin-console-theme")).toBe(
      svc.isDark() ? "dark" : "light"
    );
  });
});
