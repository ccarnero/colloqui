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
