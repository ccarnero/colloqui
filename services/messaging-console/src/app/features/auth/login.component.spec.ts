import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { vi } from "vitest";
import { of, throwError } from "rxjs";
import type { ITokenResponse } from "@yoizen/angular-shared";

import { LoginComponent } from "./login.component";
import { AuthService } from "../../core/services/auth.service";

const tokenResponse: ITokenResponse = {
  access_token: "a",
  refresh_token: "r",
  expires_in: 3600,
  scope: "tenant:test",
};

describe("LoginComponent", () => {
  let fixture: ComponentFixture<LoginComponent>;
  let auth: {
    loginWithResult: ReturnType<typeof vi.fn>;
    handleLoginSuccess: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    auth = {
      loginWithResult: vi.fn(() => of(tokenResponse)),
      handleLoginSuccess: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  });

  it("renders Messaging Console heading", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Messaging Console");
  });

  it("sets error message on failed login", () => {
    auth.loginWithResult.mockReturnValue(
      throwError(() => ({ error: { message: "Invalid credentials" } })),
    );
    const c = fixture.componentInstance;
    c.email = "a@b.com";
    c.password = "secret";
    c.onSubmit();
    expect(c.error()).toBe("Invalid credentials");
    expect(c.submitting()).toBe(false);
  });

  it("calls handleLoginSuccess on success", () => {
    const c = fixture.componentInstance;
    c.email = "a@b.com";
    c.password = "secret";
    c.onSubmit();
    expect(auth.handleLoginSuccess).toHaveBeenCalledWith(tokenResponse);
  });
});
