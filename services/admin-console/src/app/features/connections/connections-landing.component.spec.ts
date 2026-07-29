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
import { ConnectionsLandingComponent } from "./connections-landing.component";

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
}): Promise<{
  fixture: ComponentFixture<ConnectionsLandingComponent>;
  navigate: ReturnType<typeof vi.fn>;
}> {
  const adapters = options.adapters ?? [];
  const mcpServers = options.mcpServers ?? [];
  const hostedServices = options.hostedServices ?? [];
  const navigate = options.navigate ?? vi.fn().mockResolvedValue(true);

  await TestBed.configureTestingModule({
    imports: [ConnectionsLandingComponent],
    providers: [
      provideRouter([]),
      {
        provide: HttpAdapterService,
        useValue: { list: vi.fn().mockReturnValue(of(adapters)) },
      },
      {
        provide: AgentAdminService,
        useValue: { listMcpServers: vi.fn().mockReturnValue(of(mcpServers)) },
      },
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

  const fixture = TestBed.createComponent(ConnectionsLandingComponent);
  fixture.detectChanges();
  return { fixture, navigate };
}

describe("ConnectionsLandingComponent", () => {
  it("renders the section header", async () => {
    const { fixture } = await renderComponent({});
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Connections");
  });

  describe("health mapping (decision 3 ruling, 2026-07-22)", () => {
    it("maps an enabled HTTP connector to the ok health dot", async () => {
      const { fixture } = await renderComponent({
        adapters: [buildAdapter({ status: "enabled" })],
      });
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--ok");
    });

    it("maps a disabled HTTP connector to the error health dot", async () => {
      const { fixture } = await renderComponent({
        adapters: [buildAdapter({ status: "disabled" })],
      });
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--error");
    });

    it("maps an enabled+active MCP server to the ok health dot", async () => {
      const { fixture } = await renderComponent({
        mcpServers: [buildMcpServer({ enabled: true, is_active: true })],
      });
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--ok");
    });

    it("maps a disabled MCP server to the error health dot", async () => {
      const { fixture } = await renderComponent({
        mcpServers: [buildMcpServer({ enabled: false, is_active: true })],
      });
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--error");
    });

    it("maps an inactive MCP server to the error health dot", async () => {
      const { fixture } = await renderComponent({
        mcpServers: [buildMcpServer({ enabled: true, is_active: false })],
      });
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--error");
    });

    it("maps an active hosted service to the ok health dot (statusColor semantics)", async () => {
      const { fixture } = await renderComponent({
        hostedServices: [buildHostedService({ status: "active" })],
      });
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--ok");
    });

    it("maps a pending hosted service to the warn health dot (statusColor semantics)", async () => {
      const { fixture } = await renderComponent({
        hostedServices: [buildHostedService({ status: "pending" })],
      });
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--warn");
    });

    it("maps an error hosted service to the error health dot (statusColor semantics)", async () => {
      const { fixture } = await renderComponent({
        hostedServices: [buildHostedService({ status: "error" })],
      });
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--error");
    });
  });

  describe("empty state", () => {
    it("renders the inventory table empty message when there are no connections", async () => {
      const { fixture } = await renderComponent({});
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll(".table-row").length).toBe(0);
      expect(el.textContent).toContain("No connections found.");
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

    // T11 of manual-loops/connectors/connection-call-inspector.md (SPEC
    // decision 4): supersedes the old "hosted rows go to the list" route —
    // hosted services now have a per-item detail route.
    it("navigates to the hosted service detail route", async () => {
      const { fixture, navigate } = await renderComponent({
        hostedServices: [buildHostedService({ id: "hosted-42" })],
      });
      const el = fixture.nativeElement as HTMLElement;
      const row = el.querySelector(".table-row") as HTMLElement;
      row.click();
      expect(navigate).toHaveBeenCalledWith([
        "/connections",
        "hosted-services",
        "hosted-42",
      ]);
    });
  });

  describe("needs-attention panel", () => {
    it("lists only non-ok connections across all three types", async () => {
      const { fixture } = await renderComponent({
        adapters: [
          buildAdapter({ id: "http-ok", name: "http-ok", status: "enabled" }),
          buildAdapter({
            id: "http-bad",
            name: "http-bad",
            status: "disabled",
          }),
        ],
        mcpServers: [
          buildMcpServer({ id: "mcp-bad", name: "mcp-bad", is_active: false }),
        ],
        hostedServices: [
          buildHostedService({
            id: "hosted-bad",
            name: "hosted-bad",
            status: "error",
          }),
        ],
      });
      const el = fixture.nativeElement as HTMLElement;
      const issueRows = el.querySelectorAll(".issue-row");
      expect(issueRows.length).toBe(3);
      expect(el.textContent).not.toContain("http-ok (http) is enabled.");
      expect(el.textContent).toContain("http-bad (http) is disabled.");
      expect(el.textContent).toContain("mcp-bad (mcp) is inactive.");
      expect(el.textContent).toContain("hosted-bad (hosted) is error.");
    });

    it("shows the empty state when every connection is ok", async () => {
      const { fixture } = await renderComponent({
        adapters: [buildAdapter({ status: "enabled" })],
      });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll(".issue-row").length).toBe(0);
      expect(el.textContent).toContain("No connections need attention");
    });

    it("navigates to the correct route when an attention action is clicked", async () => {
      const { fixture, navigate } = await renderComponent({
        mcpServers: [buildMcpServer({ id: "mcp-77", is_active: false })],
      });
      const el = fixture.nativeElement as HTMLElement;
      const action = el.querySelector(".issue-action") as HTMLAnchorElement;
      expect(action).toBeTruthy();
      action.click();
      expect(navigate).toHaveBeenCalledWith(["/connections", "mcp", "mcp-77"]);
    });
  });

  describe("fleet metrics", () => {
    it("does not render any of the NO-DATA fleet KPIs", async () => {
      const { fixture } = await renderComponent({});
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).not.toContain("Calls");
      expect(el.textContent).not.toContain("Error rate");
      expect(el.textContent).not.toContain("Avg p95");
      expect(el.textContent).not.toContain("Secrets");
    });
  });
});
