import "@angular/compiler";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { beforeEach, describe, expect, it } from "vitest";
import { environment } from "../../../../environments/environment";
import { AuthService } from "../../../core/services/auth.service";
import type {
  IRunEvent,
  IRunResponse,
} from "../../../core/services/run-view.service";
import type { IWorkflowDefinitionDto } from "../../automation/workflows/services/workflow-api.service";
import type { ILayoutNode } from "./domain/run-view.model";
import { RunViewPopupComponent } from "./run-view-popup.component";
import type { IAnchorRect } from "./run-view-popup-render";

const CONNECTORS_URL = `${environment.apiUrl}/connectors`;
const TRACKING_EVENTS_URL = `${environment.apiUrl}/tracking/events`;
const AGENTS_URL = `${environment.apiUrl}/admin/agents`;
const CHANNELS_URL = `${environment.apiUrl}/channels/accounts`;
const PAYLOAD_URL = (correlationId: string, eventId: string) =>
  `${environment.apiUrl}/tracking/chains/${correlationId}/events/${eventId}/payload`;

function event(overrides: Partial<IRunEvent>): IRunEvent {
  return {
    event_id: "evt-x",
    subject: "workflow.action.started.v1",
    tenant: "acme",
    producer: "workflow-service",
    domain: "workflow",
    kind: "action_started",
    version: "v1",
    correlation_id: "corr-1",
    causation_id: null,
    causation_depth: 1,
    occurred_at: "2026-07-11T10:00:00.000Z",
    tech: "temporal",
    business_fn: "workflow-execution",
    rule: 19,
    consumed_by: [],
    is_claim_check: false,
    compliance: "full",
    workflow_id: "wf-1",
    run_id: "run-1",
    connector_id: null,
    cache_status: null,
    has_envelope: true,
    payload_connector_id: null,
    payload_agent_id: null,
    payload_step_status: null,
    payload_execution_id: "exec-1",
    payload_action_index: null,
    payload_action_type: null,
    payload_action_name: null,
    payload_branch: null,
    payload_expression: null,
    payload_evaluated_value: null,
    payload_branch_taken: null,
    payload_cases: null,
    ...overrides,
  };
}

function runResponse(overrides: Partial<IRunResponse> = {}): IRunResponse {
  return {
    workflow_id: "wf-1",
    run_id: "run-1",
    correlation_id: "corr-1",
    tenant: "acme",
    events: [
      event({
        event_id: "evt-started",
        kind: "action_started",
        payload_action_index: 0,
      }),
      event({
        event_id: "evt-completed",
        kind: "action_completed",
        payload_action_index: 0,
        payload_step_status: "ok",
      }),
    ],
    spans: [],
    summary: {
      status: "completed",
      started_at: "2026-07-11T10:00:00.000Z",
      completed_at: "2026-07-11T10:00:00.500Z",
      total_ms: 500,
      steps_ok: 1,
      steps_failed: 0,
    },
    cast: [],
    step_detail: true,
    ...overrides,
  };
}

function node(overrides: Partial<ILayoutNode> = {}): ILayoutNode {
  return {
    id: "root::0",
    kind: "action",
    color: "platform",
    label: "1 · endpointCall → order-api",
    status: "ok",
    row: 0,
    lane: 0,
    onSpine: true,
    nestingDepth: 0,
    durationMs: 120,
    dashed: false,
    instanceId: "order-api",
    evaluatedValue: null,
    branchTaken: null,
    actionType: "endpointCall",
    stepName: "callOrderApi",
    conditionEventId: null,
    ...overrides,
  };
}

function definition(
  overrides: Partial<IWorkflowDefinitionDto> = {}
): IWorkflowDefinitionDto {
  return {
    id: "wf-1",
    name: "order-workflow",
    application: "acme",
    tenantId: "tenant-a",
    actions: [{ activity: "endpointCall", name: "callOrderApi" }],
    trigger: null,
    createdAt: "2026-07-11T09:00:00.000Z",
    ...overrides,
  };
}

const CENTER_LEFT_ANCHOR: IAnchorRect = {
  top: 100,
  left: 60,
  right: 260,
  bottom: 140,
  width: 200,
  height: 40,
};

describe("RunViewPopupComponent", () => {
  let fixture: ComponentFixture<RunViewPopupComponent>;
  let httpMock: HttpTestingController;

  function setup(
    options: {
      node?: ILayoutNode;
      run?: IRunResponse;
      anchorRect?: IAnchorRect;
      definition?: IWorkflowDefinitionDto | null;
      canViewPayload?: boolean;
    } = {}
  ): void {
    TestBed.configureTestingModule({
      imports: [RunViewPopupComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { hasPermission: () => options.canViewPayload ?? true },
        },
      ],
    });
    fixture = TestBed.createComponent(RunViewPopupComponent);
    fixture.componentRef.setInput("run", options.run ?? runResponse());
    fixture.componentRef.setInput("node", options.node ?? node());
    fixture.componentRef.setInput(
      "anchorRect",
      options.anchorRect ?? CENTER_LEFT_ANCHOR
    );
    fixture.componentRef.setInput(
      "definition",
      options.definition ?? definition()
    );
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  describe("open / anchor side / close", () => {
    it("renders a dialog anchored beside the clicked step", () => {
      setup();
      const dialog = el().querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
      expect(dialog?.getAttribute("aria-modal")).toBe("true");
      expect(dialog?.getAttribute("aria-label")).toContain("callOrderApi");
    });

    it("anchors to the right of a step on the left half of the viewport", () => {
      setup();
      const panel = el().querySelector(".rvp-panel") as HTMLElement;
      // CENTER_LEFT_ANCHOR.right (260) + gap(12) = 272
      expect(panel.style.left).toBe("272px");
    });

    it("anchors to the left of a step on the right half with no room", () => {
      Object.defineProperty(window, "innerWidth", {
        value: 1200,
        configurable: true,
      });
      setup({
        anchorRect: {
          top: 100,
          left: 1000,
          right: 1150,
          bottom: 140,
          width: 150,
          height: 40,
        },
      });
      const panel = el().querySelector(".rvp-panel") as HTMLElement;
      const left = Number.parseInt(panel.style.left, 10);
      expect(left).toBeLessThan(1000);
    });

    it("emits closed when the overlay is clicked", () => {
      setup();
      let closed = false;
      fixture.componentInstance.closed.subscribe(() => (closed = true));
      (el().querySelector(".rvp-overlay") as HTMLElement).click();
      expect(closed).toBe(true);
    });

    it("emits closed on Escape", () => {
      setup();
      let closed = false;
      fixture.componentInstance.closed.subscribe(() => (closed = true));
      el().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      expect(closed).toBe(true);
    });

    it("does not close when clicking inside the panel", () => {
      setup();
      let closed = false;
      fixture.componentInstance.closed.subscribe(() => (closed = true));
      (el().querySelector(".rvp-panel") as HTMLElement).click();
      expect(closed).toBe(false);
    });
  });

  describe("step detail", () => {
    beforeEach(() => setup());

    it("shows identity and rows: name, type, instance, status, duration", () => {
      const text = el().textContent ?? "";
      expect(text).toContain("callOrderApi");
      expect(text).toContain("endpointCall");
      expect(text).toContain("order-api");
      expect(text).toContain("ok");
      expect(text).toContain("120 ms");
    });

    it("shows the started/completed events pair from the run's own events", () => {
      const text = el().textContent ?? "";
      expect(text).toContain("evt-started");
      expect(text).toContain("evt-completed");
    });

    it("offers a connector peek button for a connector-backed step", () => {
      expect(el().textContent?.includes("View connector profile")).toBe(true);
    });

    it("offers a workflow definition peek button", () => {
      expect(el().textContent?.includes("View workflow definition")).toBe(true);
    });

    it("renders no 'Open <entity>' deep link when the matched event carries no connector/agent id", () => {
      expect(el().querySelector(".rvp-step-deep-link")).toBeFalsy();
    });
  });

  describe("'Open <entity>' deep link (T05 of manual-loops/connector-trace-linking.md)", () => {
    it("renders 'Open connector' for a completed event carrying payload_connector_id", () => {
      setup({
        run: runResponse({
          events: [
            event({
              event_id: "evt-completed",
              kind: "action_completed",
              payload_action_index: 0,
              payload_connector_id: "adapter-9",
            }),
          ],
        }),
      });

      const link = el().querySelector(".rvp-step-deep-link");
      expect(link).toBeTruthy();
      expect(link?.textContent?.trim()).toBe("Open connector");
    });

    it("renders 'Open agent' for a completed event carrying payload_agent_id", () => {
      setup({
        node: node({ actionType: "agentCall", instanceId: "agent-1" }),
        run: runResponse({
          events: [
            event({
              event_id: "evt-completed",
              kind: "action_completed",
              payload_action_index: 0,
              payload_agent_id: "agent-7",
            }),
          ],
        }),
      });

      const link = el().querySelector(".rvp-step-deep-link");
      expect(link).toBeTruthy();
      expect(link?.textContent?.trim()).toBe("Open agent");
    });
  });

  describe("connector peek navigation", () => {
    beforeEach(() => {
      setup();
      const btn = Array.from(el().querySelectorAll("button")).find((b) =>
        b.textContent?.includes("View connector profile")
      ) as HTMLElement;
      btn.click();
      fixture.detectChanges();
    });

    it("fetches the connector profile and recent calls, then renders them", () => {
      httpMock
        .expectOne((r) => r.url === `${CONNECTORS_URL}/order-api`)
        .flush({
          id: "order-api",
          tenantId: "acme",
          name: "Order API",
          context: "orders",
          baseUrl: "https://api.example.com",
          authType: "none",
          authConfig: {},
          headers: [],
          timeoutMs: 5000,
          maxRetries: 1,
          retryBackoffMs: 100,
          healthCheckPath: "/health",
          status: "active",
          tags: [],
          isEncrypted: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          endpoints: [],
        });
      httpMock
        .expectOne((r) => r.url === TRACKING_EVENTS_URL)
        .flush({ events: [] });
      fixture.detectChanges();

      const text = el().textContent ?? "";
      expect(text).toContain("Order API");
      expect(text).toContain("https://api.example.com");
      expect(text).toContain("No recent calls in the last hour.");
    });

    it("has a deep-link back to the Connectors feature", () => {
      httpMock
        .expectOne((r) => r.url === `${CONNECTORS_URL}/order-api`)
        .flush({
          id: "order-api",
          tenantId: "acme",
          name: "Order API",
          context: "orders",
          baseUrl: "https://api.example.com",
          authType: "none",
          authConfig: {},
          headers: [],
          timeoutMs: 5000,
          maxRetries: 1,
          retryBackoffMs: 100,
          healthCheckPath: "/health",
          status: "active",
          tags: [],
          isEncrypted: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          endpoints: [],
        });
      httpMock
        .expectOne((r) => r.url === TRACKING_EVENTS_URL)
        .flush({ events: [] });
      fixture.detectChanges();

      const link = el().querySelector("a.rvp-deep-link") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("/connections/http/order-api");
    });

    it("navigates back to step detail via the back arrow", () => {
      httpMock
        .expectOne((r) => r.url === `${CONNECTORS_URL}/order-api`)
        .flush({
          id: "order-api",
          tenantId: "acme",
          name: "Order API",
          context: "orders",
          baseUrl: "https://api.example.com",
          authType: "none",
          authConfig: {},
          headers: [],
          timeoutMs: 5000,
          maxRetries: 1,
          retryBackoffMs: 100,
          healthCheckPath: "/health",
          status: "active",
          tags: [],
          isEncrypted: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          endpoints: [],
        });
      httpMock
        .expectOne((r) => r.url === TRACKING_EVENTS_URL)
        .flush({ events: [] });
      fixture.detectChanges();

      (el().querySelector(".rvp-back") as HTMLElement).click();
      fixture.detectChanges();

      expect(el().textContent).toContain("Events");
      expect(el().querySelector(".rvp-back")).toBeFalsy();
    });
  });

  describe("agent peek navigation", () => {
    beforeEach(() => {
      setup({
        node: node({
          actionType: "agentCall",
          instanceId: "agent-1",
          stepName: "summarize",
        }),
      });
      const btn = Array.from(el().querySelectorAll("button")).find((b) =>
        b.textContent?.includes("View agent profile")
      ) as HTMLElement;
      btn.click();
      fixture.detectChanges();
    });

    it("fetches the agent profile and shows a not-available note for recent runs", () => {
      httpMock
        .expectOne((r) => r.url === `${AGENTS_URL}/agent-1`)
        .flush({
          id: "agent-1",
          name: "Summarizer",
          description: null,
          system_prompt: "",
          model_config: { rules: "", soul: "", subagents: [], model: "gpt-4" },
          tools: [],
          enabled_tools: null,
          enabled_mcp_servers: null,
          enabled_mcp_tools: null,
          tool_description_overrides: null,
          channels: [],
          status: "published",
          is_active: true,
          published_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        });
      fixture.detectChanges();

      const text = el().textContent ?? "";
      expect(text).toContain("Summarizer");
      expect(text).toContain("gpt-4");
      expect(text).toContain("Recent-run history is not available yet");
      const link = el().querySelector("a.rvp-deep-link") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("/ai/agents/agent-1");
    });
  });

  describe("channel peek navigation", () => {
    beforeEach(() => {
      setup({
        node: node({
          actionType: "channelSend",
          instanceId: "acct-1",
          stepName: "sendReply",
        }),
      });
      const btn = Array.from(el().querySelectorAll("button")).find((b) =>
        b.textContent?.includes("View channel account")
      ) as HTMLElement;
      btn.click();
      fixture.detectChanges();
    });

    it("fetches accounts and quotes the matching one with a deep link", () => {
      httpMock
        .expectOne((r) => r.url === CHANNELS_URL)
        .flush([
          {
            id: "acct-1",
            channel: "whatsapp",
            provider: "meta",
            name: "Support WA",
            externalId: "ext-1",
            accessToken: "secret",
            isActive: true,
          },
        ]);
      fixture.detectChanges();

      const text = el().textContent ?? "";
      expect(text).toContain("Support WA");
      expect(text).toContain("whatsapp");
      const link = el().querySelector("a.rvp-deep-link") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe(
        "/channels/whatsapp/accounts/acct-1"
      );
    });
  });

  describe("workflow definition peek", () => {
    beforeEach(() => {
      setup();
      const btn = Array.from(el().querySelectorAll("button")).find((b) =>
        b.textContent?.includes("View workflow definition")
      ) as HTMLElement;
      btn.click();
      fixture.detectChanges();
    });

    it("quotes the passed-in definition with no extra HTTP call", () => {
      const text = el().textContent ?? "";
      expect(text).toContain("order-workflow");
      expect(text).toContain("acme");
      const link = el().querySelector("a.rvp-deep-link") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("/workflows/wf-1/builder");
    });
  });

  describe("payload states", () => {
    it("fetches and shows the request payload on demand", () => {
      setup();
      const btn = Array.from(el().querySelectorAll("button")).find((b) =>
        b.textContent?.includes("View request")
      ) as HTMLElement;
      btn.click();
      fixture.detectChanges();
      expect(el().textContent).toContain("Loading payload");

      httpMock
        .expectOne((r) => r.url === PAYLOAD_URL("corr-1", "evt-started"))
        .flush({ payload: { foo: "bar" }, payload_status: "inline" });
      fixture.detectChanges();

      expect(el().querySelector(".rvp-payload-details")).toBeTruthy();
      expect(el().textContent).toContain("Request");
    });

    it("shows the expired state on a 410", () => {
      setup();
      const btn = Array.from(el().querySelectorAll("button")).find((b) =>
        b.textContent?.includes("View response")
      ) as HTMLElement;
      btn.click();
      fixture.detectChanges();

      httpMock
        .expectOne((r) => r.url === PAYLOAD_URL("corr-1", "evt-completed"))
        .flush(
          { error: "payload for event evt-completed was scrubbed" },
          { status: 410, statusText: "Gone" }
        );
      fixture.detectChanges();

      expect(el().textContent).toContain("Payload expired");
    });

    it("shows the not-captured state on a 404", () => {
      setup();
      const btn = Array.from(el().querySelectorAll("button")).find((b) =>
        b.textContent?.includes("View request")
      ) as HTMLElement;
      btn.click();
      fixture.detectChanges();

      httpMock
        .expectOne((r) => r.url === PAYLOAD_URL("corr-1", "evt-started"))
        .flush(
          { error: "payload was never captured" },
          { status: 404, statusText: "Not Found" }
        );
      fixture.detectChanges();

      expect(el().textContent).toContain("Payload was not captured");
    });

    it("locks the payload section when the user lacks tracking:payload:read", () => {
      setup({ canViewPayload: false });
      expect(el().textContent).toContain(
        "Payload requires the tracking:payload:read permission"
      );
      expect(el().querySelector(".rvp-payload-btn")).toBeFalsy();
    });
  });
});
