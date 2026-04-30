import { TestBed } from "@angular/core/testing";
import { ThemeService } from "./theme.service";

describe("ThemeService", () => {
  beforeEach(() => {
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
