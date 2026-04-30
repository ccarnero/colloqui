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
      return memory.has(key) ? memory.get(key) ?? null : null;
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

  it("toggle flips isDark signal", () => {
    TestBed.configureTestingModule({ providers: [ThemeService] });
    const svc = TestBed.inject(ThemeService);
    const before = svc.isDark();
    svc.toggle();
    expect(svc.isDark()).toBe(!before);
  });
});
