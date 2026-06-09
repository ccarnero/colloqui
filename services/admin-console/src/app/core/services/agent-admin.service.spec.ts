import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";

import { AgentAdminService } from "./agent-admin.service";

describe("AgentAdminService", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AgentAdminService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it("can be instantiated", () => {
    const service = TestBed.inject(AgentAdminService);
    expect(service).toBeTruthy();
  });

  it("exposes expected HTTP API methods", () => {
    const service = TestBed.inject(AgentAdminService);
    expect(typeof service.listAgents).toBe("function");
    expect(typeof service.createAgent).toBe("function");
    expect(typeof service.publishAgent).toBe("function");
    expect(typeof service.unpublishAgent).toBe("function");
    expect(typeof service.getAgent).toBe("function");
    expect(typeof service.updateAgent).toBe("function");
    expect(typeof service.deleteAgent).toBe("function");
    expect(typeof service.listTemplates).toBe("function");
    expect(typeof service.listMemories).toBe("function");
    expect(typeof service.getMemory).toBe("function");
    expect(typeof service.createMemory).toBe("function");
    expect(typeof service.updateMemory).toBe("function");
    expect(typeof service.approveMemory).toBe("function");
    expect(typeof service.rejectMemory).toBe("function");
    expect(typeof service.deleteMemory).toBe("function");
  });
});
