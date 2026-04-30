import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { vi } from "vitest";

import { HeaderComponent } from "./header.component";
import { TenantService } from "../../core/services/tenant.service";
import { ThemeService } from "../../core/services/theme.service";
import { AuthService } from "../../core/services/auth.service";
import { NotificationService } from "../../core/services/notification.service";

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
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();
  });

  it("shows tenant name", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Acme Corp");
  });
});
