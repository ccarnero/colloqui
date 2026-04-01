import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";

import { App } from "./app";
import { AuthService } from "./core/services/auth.service";
import { authGuard } from "./core/guards/auth.guard";

describe("App", () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it("creates the app component", () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });
});

describe("AuthService", () => {
  beforeEach(() => {
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
});

describe("authGuard", () => {
  it("is defined", () => {
    expect(authGuard).toBeDefined();
    expect(typeof authGuard).toBe("function");
  });
});
