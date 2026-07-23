import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { provideRouter, Router } from "@angular/router";
import { of } from "rxjs";
import { vi } from "vitest";
import type { IMcpServer } from "../../core/models/agent.model";
import { AgentAdminService } from "../../core/services/agent-admin.service";
import { HttpAdapterService } from "../../core/services/http-adapter.service";
import { RegistryService } from "../../core/services/registry.service";
import type { IMcpServerDialogResult } from "../../shared/components/mcp-server-dialog/mcp-server-dialog.types";
import { McpFleetPageComponent } from "./mcp-fleet-page.component";

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

function buildDialogResult(
  overrides: Partial<IMcpServerDialogResult> = {}
): IMcpServerDialogResult {
  return {
    name: "new-server",
    description: undefined,
    transport_type: "http",
    url: "https://new.example.com",
    headers: undefined,
    authType: "none",
    authConfig: undefined,
    enabled: true,
    scope: "external",
    ...overrides,
  };
}

async function renderComponent(options: {
  mcpServers?: IMcpServer[];
  dialogAfterClosed?: unknown;
  createResult?: IMcpServer;
}): Promise<{
  fixture: ComponentFixture<McpFleetPageComponent>;
  agentAdmin: {
    listMcpServers: ReturnType<typeof vi.fn>;
    createMcpServer: ReturnType<typeof vi.fn>;
  };
  dialogOpen: ReturnType<typeof vi.fn>;
}> {
  const mcpServers = options.mcpServers ?? [];
  const agentAdmin = {
    listMcpServers: vi.fn().mockReturnValue(of(mcpServers)),
    createMcpServer: vi
      .fn()
      .mockReturnValue(of(options.createResult ?? buildMcpServer())),
  };
  const dialogOpen = vi.fn().mockReturnValue({
    afterClosed: () => of(options.dialogAfterClosed),
  });

  await TestBed.configureTestingModule({
    imports: [McpFleetPageComponent],
    providers: [
      provideRouter([]),
      { provide: AgentAdminService, useValue: agentAdmin },
      {
        provide: HttpAdapterService,
        useValue: { list: vi.fn().mockReturnValue(of([])) },
      },
      {
        provide: RegistryService,
        useValue: { services: () => [], loadServices: vi.fn() },
      },
      {
        provide: Router,
        useValue: { navigate: vi.fn().mockResolvedValue(true) },
      },
      { provide: MatDialog, useValue: { open: dialogOpen } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(McpFleetPageComponent);
  fixture.detectChanges();
  return { fixture, agentAdmin, dialogOpen };
}

describe("McpFleetPageComponent", () => {
  it(
    "renders the unified fleet pre-filtered to MCP rows (T01 finding 6, " +
      "SIGNED decision 5b)",
    async () => {
      const { fixture } = await renderComponent({
        mcpServers: [buildMcpServer({ id: "mcp-1", name: "seeded-mcp" })],
      });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("MCP Servers");
      expect(el.textContent).toContain("seeded-mcp");
      const activeChip = el.querySelector(".chip--active") as HTMLElement;
      expect(activeChip.textContent?.trim()).toBe("MCP");
    }
  );

  it("keeps the KPI strip and inventory table from the shared fleet composition", async () => {
    const { fixture } = await renderComponent({});
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("app-kpi-card")).toBeTruthy();
    expect(el.querySelector("app-inventory-table")).toBeTruthy();
  });

  describe("Add MCP server affordance (create wiring identical to the legacy page)", () => {
    it("opens the MCP server dialog on click", async () => {
      const { fixture, dialogOpen } = await renderComponent({
        dialogAfterClosed: undefined,
      });
      const el = fixture.nativeElement as HTMLElement;
      const btn = Array.from(el.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Add MCP Server")
      ) as HTMLButtonElement;
      btn.click();
      expect(dialogOpen).toHaveBeenCalledTimes(1);
      expect(dialogOpen.mock.calls[0][1]).toMatchObject({
        data: { mode: "create" },
      });
    });

    it("creates the MCP server with the dialog result and refreshes the fleet", async () => {
      const created = buildMcpServer({ id: "mcp-99", name: "brand-new" });
      const { fixture, agentAdmin } = await renderComponent({
        dialogAfterClosed: buildDialogResult({ name: "brand-new" }),
        createResult: created,
      });
      const el = fixture.nativeElement as HTMLElement;
      // ConnectionsMetricsService.loadCounts() also calls listMcpServers()
      // on init (for the KPI strip), so the baseline is 2, not 1.
      const baseline = agentAdmin.listMcpServers.mock.calls.length;
      const btn = Array.from(el.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Add MCP Server")
      ) as HTMLButtonElement;
      btn.click();
      fixture.detectChanges();

      expect(agentAdmin.createMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({ name: "brand-new" })
      );
      // Fleet refresh calls listMcpServers again after create.
      expect(agentAdmin.listMcpServers.mock.calls.length).toBe(baseline + 1);
    });

    it("does nothing when the dialog is dismissed without a result", async () => {
      const { fixture, agentAdmin } = await renderComponent({
        dialogAfterClosed: undefined,
      });
      const el = fixture.nativeElement as HTMLElement;
      const btn = Array.from(el.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Add MCP Server")
      ) as HTMLButtonElement;
      btn.click();
      fixture.detectChanges();
      expect(agentAdmin.createMcpServer).not.toHaveBeenCalled();
    });
  });
});
