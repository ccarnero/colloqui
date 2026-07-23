import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { of } from "rxjs";
import { vi } from "vitest";
import type { IMcpServer } from "../../core/models/agent.model";
import type { IRegisteredService } from "../../core/models/registry.model";
import { AgentAdminService } from "../../core/services/agent-admin.service";
import type { IAdapterDto } from "../../core/services/http-adapter.service";
import { HttpAdapterService } from "../../core/services/http-adapter.service";
import { RegistryService } from "../../core/services/registry.service";
import { ConnectionsFleetComponent } from "./connections-fleet.component";

function buildAdapter(overrides: Partial<IAdapterDto> = {}): IAdapterDto {
  return {
    id: "http-1",
    tenantId: "t1",
    name: "billing-api",
    context: "external",
    baseUrl: "https://billing.example.com",
    authType: "apiKey",
    authConfig: {},
    headers: [],
    timeoutMs: 5000,
    maxRetries: 2,
    retryBackoffMs: 200,
    healthCheckPath: "/health",
    status: "enabled",
    tags: [],
    isEncrypted: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    endpoints: [],
    ...overrides,
  };
}

function buildMcpServer(overrides: Partial<IMcpServer> = {}): IMcpServer {
  return {
    id: "mcp-1",
    tenant_id: "t1",
    name: "tools-server",
    description: null,
    transport_type: "http",
    url: "https://mcp.example.com",
    headers: null,
    auth_type: "none",
    auth_config: null,
    enabled: true,
    is_active: true,
    managed_by: null,
    managed_locked_fields: null,
    scope: "external",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildHostedService(
  overrides: Partial<IRegisteredService> = {}
): IRegisteredService {
  return {
    id: "hosted-1",
    tenantId: "t1",
    name: "worker-svc",
    image: "registry/worker:latest",
    port: 8080,
    minScale: 0,
    maxScale: 3,
    concurrencyTarget: 10,
    envVars: {},
    status: "active",
    knativeName: "worker-svc-knative",
    namespace: "default",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function renderComponent(options: {
  adapters?: IAdapterDto[];
  mcpServers?: IMcpServer[];
  hostedServices?: IRegisteredService[];
  navigate?: ReturnType<typeof vi.fn>;
  initialKind?: "all" | "http" | "mcp" | "hosted";
}): Promise<{
  fixture: ComponentFixture<ConnectionsFleetComponent>;
  navigate: ReturnType<typeof vi.fn>;
  agentAdmin: { listMcpServers: ReturnType<typeof vi.fn> };
}> {
  const adapters = options.adapters ?? [];
  const mcpServers = options.mcpServers ?? [];
  const hostedServices = options.hostedServices ?? [];
  const navigate = options.navigate ?? vi.fn().mockResolvedValue(true);
  const agentAdmin = {
    listMcpServers: vi.fn().mockReturnValue(of(mcpServers)),
  };

  await TestBed.configureTestingModule({
    imports: [ConnectionsFleetComponent],
    providers: [
      provideRouter([]),
      {
        provide: HttpAdapterService,
        useValue: { list: vi.fn().mockReturnValue(of(adapters)) },
      },
      { provide: AgentAdminService, useValue: agentAdmin },
      {
        provide: RegistryService,
        useValue: {
          services: () => hostedServices,
          loadServices: vi.fn(),
        },
      },
      { provide: Router, useValue: { navigate } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ConnectionsFleetComponent);
  if (options.initialKind) {
    fixture.componentRef.setInput("initialKind", options.initialKind);
  }
  fixture.detectChanges();
  return { fixture, navigate, agentAdmin };
}

describe("ConnectionsFleetComponent", () => {
  describe("endpoint/auth columns (T01 finding 5, FIX T05)", () => {
    it("renders the HTTP connector's real baseUrl and authType", async () => {
      const { fixture } = await renderComponent({
        adapters: [
          buildAdapter({
            baseUrl: "https://billing.example.com",
            authType: "apiKey",
          }),
        ],
      });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("https://billing.example.com");
      expect(el.textContent).toContain("apiKey");
    });

    it("renders the MCP server's real url and auth_type", async () => {
      const { fixture } = await renderComponent({
        mcpServers: [
          buildMcpServer({
            url: "https://mcp.example.com",
            auth_type: "bearer",
          }),
        ],
      });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("https://mcp.example.com");
      expect(el.textContent).toContain("bearer");
    });

    it("renders a placeholder endpoint/auth for hosted services (no such fields)", async () => {
      const { fixture } = await renderComponent({
        hostedServices: [buildHostedService()],
      });
      const el = fixture.nativeElement as HTMLElement;
      const row = el.querySelector(".table-row") as HTMLElement;
      expect(row.textContent).toContain("—");
    });
  });

  describe("kind filter chips (T01 finding 6, SIGNED decision 5b)", () => {
    it("defaults to the 'all' chip and shows every kind", async () => {
      const { fixture } = await renderComponent({
        adapters: [buildAdapter({ id: "http-1" })],
        mcpServers: [buildMcpServer({ id: "mcp-1" })],
        hostedServices: [buildHostedService({ id: "hosted-1" })],
      });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll(".table-row").length).toBe(3);
      const activeChip = el.querySelector(".chip--active") as HTMLElement;
      expect(activeChip.textContent?.trim()).toBe("All");
    });

    it("pre-filters to the initialKind input (mcp)", async () => {
      const { fixture } = await renderComponent({
        adapters: [buildAdapter({ id: "http-1" })],
        mcpServers: [buildMcpServer({ id: "mcp-1", name: "only-mcp" })],
        hostedServices: [buildHostedService({ id: "hosted-1" })],
        initialKind: "mcp",
      });
      const el = fixture.nativeElement as HTMLElement;
      const rows = el.querySelectorAll(".table-row");
      expect(rows.length).toBe(1);
      expect(el.textContent).toContain("only-mcp");
      const activeChip = el.querySelector(".chip--active") as HTMLElement;
      expect(activeChip.textContent?.trim()).toBe("MCP");
    });

    it("clicking the HTTP chip filters the table to HTTP rows only", async () => {
      const { fixture } = await renderComponent({
        adapters: [buildAdapter({ id: "http-1", name: "the-http-one" })],
        mcpServers: [buildMcpServer({ id: "mcp-1", name: "the-mcp-one" })],
      });
      const el = fixture.nativeElement as HTMLElement;
      const chips = Array.from(el.querySelectorAll<HTMLButtonElement>(".chip"));
      const httpChip = chips.find((c) => c.textContent?.trim() === "HTTP")!;
      httpChip.click();
      fixture.detectChanges();
      const rows = el.querySelectorAll(".table-row");
      expect(rows.length).toBe(1);
      expect(el.textContent).toContain("the-http-one");
      expect(el.textContent).not.toContain("the-mcp-one");
    });

    it("clicking back to All clears the filter", async () => {
      const { fixture } = await renderComponent({
        adapters: [buildAdapter({ id: "http-1" })],
        mcpServers: [buildMcpServer({ id: "mcp-1" })],
        initialKind: "mcp",
      });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll(".table-row").length).toBe(1);
      const chips = Array.from(el.querySelectorAll<HTMLButtonElement>(".chip"));
      const allChip = chips.find((c) => c.textContent?.trim() === "All")!;
      allChip.click();
      fixture.detectChanges();
      expect(el.querySelectorAll(".table-row").length).toBe(2);
    });
  });

  describe("row click navigation", () => {
    it("navigates to the HTTP connector detail route", async () => {
      const { fixture, navigate } = await renderComponent({
        adapters: [buildAdapter({ id: "http-42" })],
      });
      const el = fixture.nativeElement as HTMLElement;
      const row = el.querySelector(".table-row") as HTMLElement;
      row.click();
      expect(navigate).toHaveBeenCalledWith([
        "/connections",
        "http",
        "http-42",
      ]);
    });

    it("navigates to the MCP server detail route", async () => {
      const { fixture, navigate } = await renderComponent({
        mcpServers: [buildMcpServer({ id: "mcp-42" })],
      });
      const el = fixture.nativeElement as HTMLElement;
      const row = el.querySelector(".table-row") as HTMLElement;
      row.click();
      expect(navigate).toHaveBeenCalledWith(["/connections", "mcp", "mcp-42"]);
    });
  });

  describe("refreshMcpServers (external mutation refresh hook)", () => {
    it("reloads MCP servers on demand", async () => {
      const { fixture, agentAdmin } = await renderComponent({
        mcpServers: [buildMcpServer({ id: "mcp-1" })],
      });
      // ConnectionsMetricsService.loadCounts() also calls listMcpServers()
      // on init (for the KPI strip), so the baseline is 2, not 1.
      const baseline = agentAdmin.listMcpServers.mock.calls.length;
      fixture.componentInstance.refreshMcpServers();
      expect(agentAdmin.listMcpServers.mock.calls.length).toBe(baseline + 1);
    });
  });
});
