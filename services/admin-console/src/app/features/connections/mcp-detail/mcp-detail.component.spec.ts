import "@angular/compiler";
import { type ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from "@angular/router";
import { BehaviorSubject, of, tap, throwError } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IMcpServer, IMcpUsage } from "../../../core/models/agent.model";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import { AuthService } from "../../../core/services/auth.service";
import {
  ConnectorCallService,
  type IMcpCall,
} from "../../../core/services/connector-call.service";
import { ConfirmDialogComponent } from "../../../shared/components/confirm-dialog/confirm-dialog.component";
import { McpServerDialogComponent } from "../../../shared/components/mcp-server-dialog/mcp-server-dialog.component";
import { McpDetailComponent } from "./mcp-detail.component";

function makeServer(overrides: Partial<IMcpServer> = {}): IMcpServer {
  return {
    id: "mcp-1",
    tenant_id: "t1",
    name: "My MCP Server",
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
    scope: "internal",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeUsage(overrides: Partial<IMcpUsage> = {}): IMcpUsage {
  return {
    windowDays: 7,
    summary: {
      totalCalls: 0,
      successCalls: 0,
      errorCalls: 0,
      avgDurationMs: 0,
    },
    recentCalls: [],
    ...overrides,
  };
}

describe("McpDetailComponent", () => {
  let fixture: ComponentFixture<McpDetailComponent>;
  let agentAdminService: {
    getMcpServer: ReturnType<typeof vi.fn>;
    listMcpServerTools: ReturnType<typeof vi.fn>;
    getMcpServerUsage: ReturnType<typeof vi.fn>;
    updateMcpServer: ReturnType<typeof vi.fn>;
    deleteMcpServer: ReturnType<typeof vi.fn>;
  };
  let calls: { recentMcpCalls: ReturnType<typeof vi.fn> };
  let dialogMock: { open: ReturnType<typeof vi.fn> };
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let router: Router;

  async function setup(
    serverObs = of(makeServer()),
    toolsObs = of([]),
    usageObs = of(makeUsage()),
    callsObs = of<IMcpCall[]>([])
  ) {
    paramMap$ = new BehaviorSubject(convertToParamMap({ id: "mcp-1" }));
    agentAdminService = {
      getMcpServer: vi.fn().mockReturnValue(serverObs),
      listMcpServerTools: vi.fn().mockReturnValue(toolsObs),
      getMcpServerUsage: vi.fn().mockReturnValue(usageObs),
      updateMcpServer: vi.fn().mockReturnValue(of(makeServer())),
      deleteMcpServer: vi.fn().mockReturnValue(of(undefined)),
    };
    calls = { recentMcpCalls: vi.fn().mockReturnValue(callsObs) };
    dialogMock = {
      open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined) }),
    };

    await TestBed.configureTestingModule({
      imports: [McpDetailComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable() },
        },
        { provide: AgentAdminService, useValue: agentAdminService },
        { provide: ConnectorCallService, useValue: calls },
        { provide: AuthService, useValue: { hasPermission: () => true } },
        { provide: MatDialog, useValue: dialogMock },
      ],
    }).compileComponents();

    // TestBed gotcha (L2): McpDetailComponent imports MatDialogModule
    // directly, which re-provides (and shadows) MatDialog via a
    // component-scoped injector — only overrideProvider reaches it.
    TestBed.overrideProvider(MatDialog, { useValue: dialogMock });

    router = TestBed.inject(Router);
    vi.spyOn(router, "navigate").mockResolvedValue(true);

    fixture = TestBed.createComponent(McpDetailComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it("resolves the server for the route param", async () => {
    await setup();
    expect(agentAdminService.getMcpServer).toHaveBeenCalledWith("mcp-1");
    expect(fixture.componentInstance.server()?.id).toBe("mcp-1");
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it("sets errorMessage when getMcpServer errors", async () => {
    await setup(throwError(() => new Error("Not found")));
    expect(fixture.componentInstance.errorMessage()).toBe(
      "Failed to load MCP server."
    );
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it("shows the real Calls (Nd) KPI sourced from usage.summary.totalCalls", async () => {
    await setup(
      of(makeServer()),
      of([]),
      of(
        makeUsage({
          windowDays: 7,
          summary: {
            totalCalls: 42,
            successCalls: 40,
            errorCalls: 2,
            avgDurationMs: 120,
          },
        })
      )
    );

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Calls (7d)");
    expect(text).toContain("42");
  });

  // T03 — health mapping (decision 3, orchestrator ruling 2026-07-22):
  // MCP servers map enabled && is_active -> ok, else error.
  it("health() is ok when enabled and is_active", async () => {
    await setup(of(makeServer({ enabled: true, is_active: true })));
    expect(fixture.componentInstance.health()).toBe("ok");
  });

  it("health() is error when disabled", async () => {
    await setup(of(makeServer({ enabled: false, is_active: true })));
    expect(fixture.componentInstance.health()).toBe("error");
  });

  it("health() is error when enabled but not active", async () => {
    await setup(of(makeServer({ enabled: true, is_active: false })));
    expect(fixture.componentInstance.health()).toBe("error");
  });

  // T03 — decision 3: secrets/credentials are never rendered, masked
  // placeholders only. auth_config must never leak into the DOM, even
  // though it is a real field on IMcpServer (used only to seed the reused
  // edit dialog's data input, never rendered as text here).
  it("never renders auth_config secret values in the DOM", async () => {
    const SENTINEL = "mcp-super-secret-token-should-never-render-7c1e";
    await setup(
      of(
        makeServer({
          auth_type: "bearer",
          auth_config: { token: SENTINEL },
        })
      )
    );

    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).not.toContain(SENTINEL);
  });

  // T03 — form reuse: Edit must open the EXISTING McpServerDialogComponent,
  // never a duplicated/local form component.
  it("Edit opens the existing McpServerDialogComponent, not a duplicate form", async () => {
    await setup();

    fixture.componentInstance.openEdit();

    expect(dialogMock.open).toHaveBeenCalledTimes(1);
    expect(dialogMock.open.mock.calls[0]?.[0]).toBe(McpServerDialogComponent);
  });

  it("openEdit logs and no-ops when no server is loaded", async () => {
    await setup(throwError(() => new Error("Not found")));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    fixture.componentInstance.openEdit();

    expect(dialogMock.open).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // Regression test for the reviewer-flagged behavioral drift: openEdit's
  // save failure must be user-visible (saveError signal + banner), mirroring
  // connector-detail.component.spec.ts's equivalent test — it must not only
  // console.error and leave the page silently stale.
  it("openEdit surfaces a user-visible error and does NOT silently succeed when updateMcpServer fails", async () => {
    const existingServer = makeServer();
    await setup(of(existingServer));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    dialogMock.open.mockReturnValue({
      afterClosed: () =>
        of({
          name: "Renamed server",
          url: existingServer.url,
          transport_type: existingServer.transport_type,
          auth_type: existingServer.auth_type,
          auth_config: null,
          headers: null,
          enabled: existingServer.enabled,
          scope: existingServer.scope,
        }),
    });
    agentAdminService.updateMcpServer.mockReturnValue(
      throwError(() => new Error("update rejected"))
    );

    fixture.componentInstance.openEdit();
    fixture.detectChanges();

    expect(fixture.componentInstance.saveError()).toBe(
      "Couldn't save changes. Please try again."
    );
    // No silent success — the stale server signal must remain unchanged.
    expect(fixture.componentInstance.server()).toEqual(existingServer);
    expect(errorSpy).toHaveBeenCalledWith(
      "[McpDetailComponent] failed to save MCP server edit",
      expect.objectContaining({ id: "mcp-1" })
    );
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Couldn't save changes. Please try again.");

    errorSpy.mockRestore();
  });

  it("openEdit happy path saves successfully, updates the view, and leaves saveError null", async () => {
    const existingServer = makeServer();
    await setup(of(existingServer));

    const callOrder: string[] = [];
    dialogMock.open.mockReturnValue({
      afterClosed: () =>
        of({
          name: "Renamed server",
          url: existingServer.url,
          transport_type: existingServer.transport_type,
          auth_type: existingServer.auth_type,
          auth_config: null,
          headers: null,
          enabled: existingServer.enabled,
          scope: existingServer.scope,
        }),
    });
    const updatedServer = makeServer({ name: "Renamed server" });
    agentAdminService.updateMcpServer.mockReturnValue(
      of(updatedServer).pipe(tap(() => callOrder.push("update")))
    );

    fixture.componentInstance.openEdit();
    fixture.detectChanges();

    expect(callOrder).toEqual(["update"]);
    expect(fixture.componentInstance.server()?.name).toBe("Renamed server");
    expect(fixture.componentInstance.saveError()).toBeNull();
  });

  it("renders tools empty state when the server exposes none", async () => {
    await setup(of(makeServer()), of([]));
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("This server exposes no tools right now.");
  });

  it("renders the recent-calls empty state naming the 7-day window", async () => {
    await setup(of(makeServer()), of([]), of(makeUsage()), of([]));
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("No calls in the last 7 days.");
  });

  // T09 — "Recent calls" rows source from the tracking feed
  // (ConnectorCallService.recentMcpCalls), NOT usage.recentCalls.
  describe("T09 — tracking feed migration", () => {
    function makeMcpCall(overrides: Partial<IMcpCall> = {}): IMcpCall {
      return {
        mcpServerId: "mcp-1",
        toolName: "search",
        success: true,
        durationMs: 42,
        error: null,
        timestamp: "2026-06-01T12:00:00.000Z",
        correlationId: "corr-42",
        eventId: "evt-42",
        ...overrides,
      };
    }

    it("loads recent calls from ConnectorCallService.recentMcpCalls, not usage.recentCalls", async () => {
      await setup(
        of(makeServer()),
        of([]),
        of(
          makeUsage({
            // If the component still read usage.recentCalls, this row
            // would leak into the DOM as toolName "should-not-render".
            recentCalls: [
              {
                toolName: "should-not-render",
                success: true,
                durationMs: 1,
                error: null,
                createdAt: "2026-06-01T12:00:00.000Z",
              },
            ],
          })
        ),
        of([makeMcpCall({ toolName: "list-files" })])
      );

      expect(calls.recentMcpCalls).toHaveBeenCalledWith("mcp-1", undefined, 20);
      const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
      expect(text).toContain("list-files");
      expect(text).not.toContain("should-not-render");
    });

    it("summary cards keep reading getMcpServerUsage (SPEC decision 3)", async () => {
      await setup(
        of(makeServer()),
        of([]),
        of(
          makeUsage({
            windowDays: 7,
            summary: {
              totalCalls: 42,
              successCalls: 40,
              errorCalls: 2,
              avgDurationMs: 120,
            },
          })
        ),
        of([])
      );

      expect(agentAdminService.getMcpServerUsage).toHaveBeenCalledWith("mcp-1");
      const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
      expect(text).toContain("Calls (7d)");
      expect(text).toContain("42");
    });

    it("clicking a call row opens the inspector with that row's event", async () => {
      await setup(
        of(makeServer()),
        of([]),
        of(makeUsage()),
        of([makeMcpCall()])
      );

      const host = fixture.nativeElement as HTMLElement;
      const row = host.querySelector<HTMLElement>(".call-row");
      expect(row).toBeTruthy();
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      fixture.detectChanges();

      expect(fixture.componentInstance.inspectorRow()).toEqual({
        eventId: "evt-42",
        correlationId: "corr-42",
        kind: "mcp_call_completed",
        scalars: {
          toolName: "search",
          success: true,
          durationMs: 42,
          error: null,
        },
      });
      expect(host.querySelector("app-call-inspector")).toBeTruthy();
    });

    it("does not open the inspector for a row without eventId/correlationId", async () => {
      await setup(
        of(makeServer()),
        of([]),
        of(makeUsage()),
        of([makeMcpCall({ correlationId: undefined, eventId: undefined })])
      );

      const host = fixture.nativeElement as HTMLElement;
      const row = host.querySelector<HTMLElement>(".call-row");
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      fixture.detectChanges();

      expect(fixture.componentInstance.inspectorRow()).toBeNull();
      expect(host.querySelector("app-call-inspector")).toBeFalsy();
    });

    it("the View trace link navigates to /processes/trace/<correlationId> and does not toggle the inspector", async () => {
      await setup(
        of(makeServer()),
        of([]),
        of(makeUsage()),
        of([makeMcpCall()])
      );

      const host = fixture.nativeElement as HTMLElement;
      const trace = host.querySelector<HTMLAnchorElement>(
        "a.trace-link[href='/processes/trace/corr-42']"
      );
      expect(trace).toBeTruthy();
      expect(trace?.getAttribute("href")).toBe("/processes/trace/corr-42");
    });
  });

  // Regression tests for review objection 1 (MCP Delete capability lost
  // when the legacy mcp-servers-page.component.ts was deleted): Delete now
  // lives on the detail header, mirroring channel-detail.component.ts's
  // confirmDelete()/deleteAccount() precedent.
  describe("confirmDelete", () => {
    it("confirm -> calls deleteMcpServer, shows a snackbar, and navigates back to /connections/mcp", async () => {
      const server = makeServer({ managed_by: null });
      await setup(of(server));
      dialogMock.open.mockReturnValue({ afterClosed: () => of(true) });
      // Same shadowing gotcha as MatDialog (L2 above): McpDetailComponent
      // imports MatSnackBarModule directly, which re-provides MatSnackBar
      // via a component-scoped injector — TestBed.inject would resolve a
      // different instance. Spy on the one the component actually holds.
      const snackBar = fixture.debugElement.injector.get(MatSnackBar);
      const snackSpy = vi.spyOn(snackBar, "open");

      fixture.componentInstance.confirmDelete();
      fixture.detectChanges();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(dialogMock.open.mock.calls[0]?.[0]).toBe(ConfirmDialogComponent);
      expect(agentAdminService.deleteMcpServer).toHaveBeenCalledWith(server.id);
      expect(snackSpy).toHaveBeenCalledWith(
        "MCP server deleted.",
        undefined,
        expect.objectContaining({ duration: 2000 })
      );
      expect(router.navigate).toHaveBeenCalledWith(["/connections/mcp"]);
    });

    it("cancel -> does NOT call deleteMcpServer or navigate", async () => {
      const server = makeServer({ managed_by: null });
      await setup(of(server));
      dialogMock.open.mockReturnValue({ afterClosed: () => of(false) });

      fixture.componentInstance.confirmDelete();
      fixture.detectChanges();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(agentAdminService.deleteMcpServer).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it("managed server -> blocked with an explanation, no dialog opened, service NOT called", async () => {
      const server = makeServer({
        managed_by: "orchestrator",
        name: "Synced MCP",
      });
      await setup(of(server));

      fixture.componentInstance.confirmDelete();
      fixture.detectChanges();

      expect(dialogMock.open).not.toHaveBeenCalled();
      expect(agentAdminService.deleteMcpServer).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
      expect(fixture.componentInstance.saveError()).toContain("orchestrator");
      expect(fixture.componentInstance.saveError()).toContain(
        "MANAGED_MCP_SERVER"
      );
      const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
      expect(text).toContain("MANAGED_MCP_SERVER");
    });

    it("failure -> shows a visible error banner and does NOT navigate", async () => {
      const server = makeServer({ managed_by: null });
      await setup(of(server));
      dialogMock.open.mockReturnValue({ afterClosed: () => of(true) });
      agentAdminService.deleteMcpServer.mockReturnValue(
        throwError(() => new Error("delete rejected"))
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      fixture.componentInstance.confirmDelete();
      fixture.detectChanges();

      expect(fixture.componentInstance.saveError()).toBe(
        "Couldn't delete MCP server. Please try again."
      );
      expect(router.navigate).not.toHaveBeenCalled();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
      expect(text).toContain("Couldn't delete MCP server. Please try again.");

      errorSpy.mockRestore();
    });

    it("no-ops and logs when no server is loaded", async () => {
      await setup(throwError(() => new Error("Not found")));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      fixture.componentInstance.confirmDelete();

      expect(dialogMock.open).not.toHaveBeenCalled();
      expect(agentAdminService.deleteMcpServer).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
