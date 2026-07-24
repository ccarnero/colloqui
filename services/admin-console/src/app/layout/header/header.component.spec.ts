import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap } from "@angular/router";
import { vi } from "vitest";
import { AuthService } from "../../core/services/auth.service";
import { NotificationService } from "../../core/services/notification.service";
import { TenantService } from "../../core/services/tenant.service";
import { ThemeService } from "../../core/services/theme.service";
import { HeaderComponent } from "./header.component";

describe("HeaderComponent", () => {
  let fixture: ComponentFixture<HeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        {
          provide: TenantService,
          useValue: {
            currentTenant: signal({
              id: "t1",
              name: "Acme Corp",
              configuration: {},
            }),
          },
        },
        {
          provide: ThemeService,
          useValue: { isDark: signal(false), toggle: vi.fn() },
        },
        {
          provide: AuthService,
          useValue: {
            userProfile: signal({
              id: "u1",
              name: "Alice",
              email: "a@b.com",
              initials: "AL",
              role: "admin",
            }),
            logout: vi.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            unreadCount: signal(0),
            notifications: signal([]),
            markAllRead: vi.fn(),
            push: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({}),
              queryParamMap: convertToParamMap({}),
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();
  });

  it("shows tenant name", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Acme Corp");
  });

  it("renders the breadcrumb row and the tab row as two separate rows (T08 finding 1)", () => {
    const el = fixture.nativeElement as HTMLElement;
    const crumbs = el.querySelector(".topbar-crumbs");
    const tabs = el.querySelector(".tab-nav");
    expect(crumbs).toBeTruthy();
    expect(tabs).toBeTruthy();
    // Row 1 must not contain the tab nav, and row 2 must not contain the
    // breadcrumb chrome — they are siblings, not nested.
    expect(crumbs?.querySelector(".tab-nav")).toBeNull();
    expect(tabs?.querySelector(".crumb-tenant")).toBeNull();
  });

  /**
   * Regression — full-bleed views (workflow builder) subtract the header
   * height via the shared --rd-topbar-h token, which is only accurate while
   * BOTH rows keep fixed token-driven heights. jsdom does no layout, so this
   * asserts against the compiled stylesheet: a tripwire against reverting a
   * row to content-driven height and desyncing the token.
   */
  it("keeps both topbar rows at fixed token-driven heights (--rd-topbar-h sync)", () => {
    const css = Array.from(document.head.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .filter((t) => t.includes(".topbar-crumbs"))
      .join("\n");
    expect(css).toContain("var(--rd-topbar-crumbs-h");
    expect(css).toContain("var(--rd-topbar-tabs-h");
  });

  it("shows the org mark and the active section label in the breadcrumb row", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(".org-mark")?.textContent?.trim()).toBe("Y");
    expect(el.querySelector(".crumb-section")?.textContent?.trim()).toBe(
      "Overview"
    );
  });

  it("calls ThemeService.toggle() when the theme toggle button is clicked", () => {
    const themeService = TestBed.inject(ThemeService);
    const el = fixture.nativeElement as HTMLElement;
    const toggleButton = el.querySelector<HTMLButtonElement>(
      '[data-testid="theme-toggle"]'
    );

    expect(toggleButton).toBeTruthy();
    toggleButton!.click();

    expect(themeService.toggle).toHaveBeenCalledTimes(1);
  });
});
