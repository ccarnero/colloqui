import { ComponentFixture, TestBed } from "@angular/core/testing";
import { vi } from "vitest";

import { LoginComponent } from "./login.component";
import { AuthService } from "../../core/services/auth.service";

describe("LoginComponent", () => {
  let fixture: ComponentFixture<LoginComponent>;
  let login: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    login = vi.fn();
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [{ provide: AuthService, useValue: { login } }],
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
    expect(login).toHaveBeenCalledWith("u@x.com", "pw");
  });
});
