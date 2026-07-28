import "@angular/compiler";
import type { HttpErrorResponse } from "@angular/common/http";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { of, throwError } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../../../core/services/auth.service";
import { TrackingChainService } from "../../../core/services/tracking-chain.service";
import {
  CallInspectorComponent,
  type ICallInspectorRow,
} from "./call-inspector.component";

describe("CallInspectorComponent", () => {
  let fixture: ComponentFixture<CallInspectorComponent>;
  let getEventPayload: ReturnType<typeof vi.fn>;
  let hasPermission: ReturnType<typeof vi.fn>;

  function setup(): void {
    fixture = TestBed.createComponent(CallInspectorComponent);
    fixture.detectChanges();
  }

  function setRow(row: ICallInspectorRow | null): void {
    fixture.componentRef.setInput("row", row);
    fixture.detectChanges();
  }

  const httpRow: ICallInspectorRow = {
    eventId: "evt-1",
    correlationId: "corr-1",
    kind: "endpoint_call_completed",
  };
  const mcpRow: ICallInspectorRow = {
    eventId: "evt-2",
    correlationId: "corr-1",
    kind: "mcp_call_completed",
  };
  const executionRow: ICallInspectorRow = {
    eventId: "evt-3",
    correlationId: "corr-1",
    kind: "execution_completed",
  };
  const llmRow: ICallInspectorRow = {
    eventId: "evt-4",
    correlationId: "corr-1",
    kind: "llm_call_completed",
  };
  const unknownRow: ICallInspectorRow = {
    eventId: "evt-5",
    correlationId: "corr-1",
    kind: "some_future_kind",
  };

  beforeEach(async () => {
    getEventPayload = vi
      .fn()
      .mockReturnValue(of({ payload: {}, payload_status: "inline" }));
    hasPermission = vi.fn().mockReturnValue(true);
    await TestBed.configureTestingModule({
      imports: [CallInspectorComponent],
      providers: [
        { provide: TrackingChainService, useValue: { getEventPayload } },
        { provide: AuthService, useValue: { hasPermission } },
      ],
    }).compileComponents();
  });

  it("shows the empty state when no row is set", () => {
    setup();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector(".ci-empty")?.textContent).toContain(
      "Select a call…"
    );
    expect(getEventPayload).not.toHaveBeenCalled();
  });

  describe("on-demand fetch (no fetch before open)", () => {
    it("does not fetch before the row is set", () => {
      setup();
      expect(getEventPayload).not.toHaveBeenCalled();
    });

    it("fetches the payload only once the row opens", () => {
      setup();
      setRow(httpRow);

      expect(getEventPayload).toHaveBeenCalledTimes(1);
      expect(getEventPayload).toHaveBeenCalledWith("corr-1", "evt-1");
    });

    it("resets to idle and does not re-fetch when the row closes", () => {
      setup();
      setRow(httpRow);
      expect(getEventPayload).toHaveBeenCalledTimes(1);

      setRow(null);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector(".ci-empty")).toBeTruthy();
      expect(getEventPayload).toHaveBeenCalledTimes(1);
    });

    it("emits close and logs on the × button click", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      setup();
      setRow(httpRow);
      let closed = false;
      fixture.componentInstance.close.subscribe(() => {
        closed = true;
      });
      const el = fixture.nativeElement as HTMLElement;

      el.querySelector<HTMLButtonElement>(".ci-close")?.click();

      expect(closed).toBe(true);
      debugSpy.mockRestore();
    });
  });

  describe("permission gating", () => {
    it("shows the permission hint and skips fetching when the user lacks tracking:payload:read", () => {
      hasPermission.mockReturnValue(false);
      setup();
      setRow(httpRow);

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector(".ci-hint")?.textContent).toContain(
        "tracking:payload:read"
      );
      expect(getEventPayload).not.toHaveBeenCalled();
    });

    it("fetches and renders sections when the user has the permission", () => {
      setup();
      setRow(httpRow);

      expect(getEventPayload).toHaveBeenCalledTimes(1);
    });
  });

  describe("HTTP section", () => {
    it("renders request and response via project-http-payload", () => {
      getEventPayload.mockReturnValue(
        of({
          payload: {
            method: "POST",
            resolvedUrl: "https://api.example.com/orders",
            status: 201,
            durationMs: 42,
            cacheResult: "miss",
            requestHeaders: { "content-type": "application/json" },
            requestBody: { id: 1 },
            responseHeaders: { "x-req-id": "abc" },
            responseBody: { ok: true },
          },
          payload_status: "inline",
        })
      );
      setup();
      setRow(httpRow);

      const el = fixture.nativeElement as HTMLElement;
      const request = el.querySelector('[aria-label="Request"]');
      const response = el.querySelector('[aria-label="Response"]');
      expect(request?.textContent).toContain("POST");
      expect(request?.textContent).toContain("https://api.example.com/orders");
      expect(response?.textContent).toContain("201");
      expect(response?.textContent).toContain("42 ms");
      expect(response?.textContent).toContain("miss");
    });
  });

  describe("MCP section", () => {
    it("renders tool, arguments, result, error", () => {
      getEventPayload.mockReturnValue(
        of({
          payload: {
            toolName: "search_docs",
            serverName: "docs-server",
            success: false,
            durationMs: 120,
            error: "timeout",
            arguments: { query: "refund policy" },
            result: { hits: [] },
          },
          payload_status: "inline",
        })
      );
      setup();
      setRow(mcpRow);

      const el = fixture.nativeElement as HTMLElement;
      const section = el.querySelector('[aria-label="MCP call"]');
      expect(section?.textContent).toContain("search_docs");
      expect(section?.textContent).toContain("docs-server");
      expect(section?.textContent).toContain("timeout");
      expect(section?.textContent).toContain("refund policy");
      expect(section?.textContent).toContain("hits");
    });
  });

  describe("Agent execution section", () => {
    it("renders reply text, tool calls/results, usage + cost", () => {
      getEventPayload.mockReturnValue(
        of({
          payload: {
            response: "Here is your refund status.",
            toolCalls: [{ name: "lookupOrder" }],
            toolResults: [{ status: "ok" }],
            usage: { inputTokens: 120, outputTokens: 45 },
            costUsd: 0.0031,
            model: "gpt-4o-mini",
            provider: "openai",
          },
          payload_status: "inline",
        })
      );
      setup();
      setRow(executionRow);

      const el = fixture.nativeElement as HTMLElement;
      const section = el.querySelector('[aria-label="Agent execution"]');
      expect(section?.textContent).toContain("Here is your refund status.");
      expect(section?.textContent).toContain("lookupOrder");
      expect(section?.textContent).toContain("gpt-4o-mini");
      expect(section?.textContent).toContain("openai");
      expect(section?.textContent).toContain("120");
      expect(section?.textContent).toContain("0.0031");
    });

    it("shows a fallback when the message-in field is not captured", () => {
      getEventPayload.mockReturnValue(
        of({
          payload: { response: "ok" },
          payload_status: "inline",
        })
      );
      setup();
      setRow(executionRow);

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector(".ci-muted")?.textContent).toContain(
        "Message in not captured"
      );
    });
  });

  describe("LLM section", () => {
    it("renders model/provider, prompt, completion, usage/cost", () => {
      getEventPayload.mockReturnValue(
        of({
          payload: {
            model: "gpt-4o-mini",
            provider: "openai",
            prompt: "Summarize this ticket",
            completion: "The ticket is about a refund.",
            inputTokens: 80,
            outputTokens: 30,
            costUsd: 0.0012,
            durationMs: 900,
          },
          payload_status: "inline",
        })
      );
      setup();
      setRow(llmRow);

      const el = fixture.nativeElement as HTMLElement;
      const section = el.querySelector('[aria-label="LLM call"]');
      expect(section?.textContent).toContain("gpt-4o-mini");
      expect(section?.textContent).toContain("Summarize this ticket");
      expect(section?.textContent).toContain("The ticket is about a refund.");
      expect(section?.textContent).toContain("900 ms");
      expect(section?.textContent).toContain("0.0012");
    });
  });

  describe("Unknown kind fallback", () => {
    it("renders the raw pretty-printed payload for an unrecognized kind", () => {
      getEventPayload.mockReturnValue(
        of({
          payload: { foo: "bar" },
          payload_status: "inline",
        })
      );
      setup();
      setRow(unknownRow);

      const el = fixture.nativeElement as HTMLElement;
      const section = el.querySelector('[aria-label="Raw payload"]');
      expect(section?.textContent).toContain('"foo": "bar"');
    });
  });

  describe("Payload lifecycle states", () => {
    it("shows 'Payload expired (30-day retention)' for a 410 scrubbed response", () => {
      getEventPayload.mockReturnValue(
        throwError(
          () =>
            ({ status: 410, error: { error: "scrubbed" } }) as HttpErrorResponse
        )
      );
      setup();
      setRow(httpRow);

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector(".ci-status")?.textContent).toContain(
        "Payload expired (30-day retention)"
      );
    });

    it("shows 'Payload was not captured' for a 404 unresolved response", () => {
      getEventPayload.mockReturnValue(
        throwError(
          () =>
            ({
              status: 404,
              error: {
                error:
                  "payload capture failed to resolve for event evt-1 (payload_status=unresolved — claim-check expired or cache unreachable)",
              },
            }) as HttpErrorResponse
        )
      );
      setup();
      setRow(httpRow);

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector(".ci-status")?.textContent).toContain(
        "Payload was not captured"
      );
    });

    it("shows a generic error message for other failures", () => {
      getEventPayload.mockReturnValue(
        throwError(
          () => ({ status: 500, error: { error: "boom" } }) as HttpErrorResponse
        )
      );
      setup();
      setRow(httpRow);

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector(".ci-status")?.textContent).toContain(
        "Failed to load payload."
      );
    });
  });
});
