import { ComponentFixture, TestBed } from "@angular/core/testing";
import { of } from "rxjs";
import { vi } from "vitest";
import { AuthService } from "../../core/services/auth.service";
import { LoginComponent } from "./login.component";

describe("LoginComponent", () => {
  let fixture: ComponentFixture<LoginComponent>;
  let loginWithResult: ReturnType<typeof vi.fn>;
  let handleLoginSuccess: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    loginWithResult = vi.fn().mockReturnValue(of({}));
    handleLoginSuccess = vi.fn();
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        {
          provide: AuthService,
          useValue: { loginWithResult, handleLoginSuccess },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  });

  it("renders AdminConsole branding", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("AdminConsole");
  });

  it("calls auth login with email and password", () => {
    const c = fixture.componentInstance;
    c.email.set("u@x.com");
    c.password.set("pw");
    c.onLogin();
    expect(loginWithResult).toHaveBeenCalledWith("u@x.com", "pw", undefined);
  });
});
