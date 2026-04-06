import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";

import { YoizenclawAdminService } from "./yoizenclaw-admin.service";

describe("YoizenclawAdminService", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        YoizenclawAdminService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it("can be instantiated", () => {
    const service = TestBed.inject(YoizenclawAdminService);
    expect(service).toBeTruthy();
  });

  it("exposes expected HTTP API methods", () => {
    const service = TestBed.inject(YoizenclawAdminService);
    expect(typeof service.listAgents).toBe("function");
    expect(typeof service.listCredentialProfiles).toBe("function");
    expect(typeof service.createAgent).toBe("function");
    expect(typeof service.publishAgent).toBe("function");
    expect(typeof service.unpublishAgent).toBe("function");
    expect(typeof service.getAgent).toBe("function");
    expect(typeof service.updateAgent).toBe("function");
    expect(typeof service.listTemplates).toBe("function");
    expect(typeof service.chatWithAgent).toBe("function");
  });
});
