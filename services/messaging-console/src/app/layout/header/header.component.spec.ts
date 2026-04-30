import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { signal } from "@angular/core";
import { vi } from "vitest";

import { HeaderComponent } from "./header.component";
import { AuthService } from "../../core/services/auth.service";

describe("HeaderComponent", () => {
  let fixture: ComponentFixture<HeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            userProfile: signal({
              id: "u1",
              name: "User",
              email: "user@example.com",
              initials: "UE",
              role: "Viewer",
            }),
            logout: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();
  });

  it("renders brand and primary navigation", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Messaging Console");
    expect(el.textContent).toContain("Accounts");
    expect(el.textContent).toContain("Send Message");
  });

  it("shows user initials from AuthService", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("UE");
  });
});
