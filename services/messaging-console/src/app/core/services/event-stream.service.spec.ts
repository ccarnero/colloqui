import { TestBed } from "@angular/core/testing";
import { provideHttpClient, withFetch } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";

import { AuthService } from "./auth.service";
import { EventStreamService } from "./event-stream.service";

describe("EventStreamService", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        EventStreamService,
        AuthService,
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
  });

  it("can be instantiated", () => {
    const service = TestBed.inject(EventStreamService);
    expect(service).toBeTruthy();
  });

  it("exposes connect and disconnect", () => {
    const service = TestBed.inject(EventStreamService);
    expect(typeof service.connect).toBe("function");
    expect(typeof service.disconnect).toBe("function");
  });
});
