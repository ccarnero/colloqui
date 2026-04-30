import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";

import { AuthService } from "./auth.service";

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

describe("AuthService", () => {
  beforeEach(() => {
    ensureLocalStorage();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
  });

  it("can be instantiated", () => {
    const service = TestBed.inject(AuthService);
    expect(service).toBeTruthy();
  });

  it("exposes login, logout, and refreshToken", () => {
    const service = TestBed.inject(AuthService);
    expect(typeof service.login).toBe("function");
    expect(typeof service.logout).toBe("function");
    expect(typeof service.refreshToken).toBe("function");
  });
});
