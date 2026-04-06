import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";

import { AuthService } from "./auth.service";

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

  it("exposes login and logout", () => {
    const service = TestBed.inject(AuthService);
    expect(typeof service.login).toBe("function");
    expect(typeof service.logout).toBe("function");
  });
});
