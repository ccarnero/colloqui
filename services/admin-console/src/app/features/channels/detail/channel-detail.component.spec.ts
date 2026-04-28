import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, ActivatedRoute, convertToParamMap } from "@angular/router";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { BehaviorSubject, of } from "rxjs";
import { vi } from "vitest";
import { MatDialog } from "@angular/material/dialog";
import { ChannelDetailComponent } from "./channel-detail.component";
import { ChannelAdminService } from "../../../core/services/channel-admin.service";
import { AuthService } from "../../../core/services/auth.service";

describe("ChannelDetailComponent", () => {
  let fixture: ComponentFixture<ChannelDetailComponent>;
  let channels: {
    getUsage: ReturnType<typeof vi.fn>;
    getUsageTotals: ReturnType<typeof vi.fn>;
    getStreamMessages: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const paramMap$ = new BehaviorSubject(
      convertToParamMap({ channel: "whatsapp", accountId: "acct-1" }),
    );
    channels = {
      getUsage: vi.fn().mockReturnValue(
        of({
          items: [
            {
              bucket: "2026-04-23T10:00:00Z",
              accountId: "acct-1",
              channel: "whatsapp",
              direction: "ingress",
              events: 10,
            },
          ],
        }),
      ),
      getUsageTotals: vi.fn().mockReturnValue(
        of({
          items: [
            {
              direction: "ingress",
              events: 10,
              firstTs: "2026-04-23T10:00:00.000Z",
              lastTs: "2026-04-23T11:00:00.000Z",
            },
            {
              direction: "egress",
              events: 4,
              firstTs: null,
              lastTs: null,
            },
          ],
        }),
      ),
      getStreamMessages: vi.fn().mockReturnValue(of({ items: [] })),
    };
    await TestBed.configureTestingModule({
      imports: [ChannelDetailComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable() },
        },
        { provide: ChannelAdminService, useValue: channels },
        {
          provide: AuthService,
          useValue: { tenantId: () => "tenant-1" },
        },
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined) }),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ChannelDetailComponent);
    fixture.detectChanges();
  });

  it("loads usage and totals on init", () => {
    expect(channels.getUsage).toHaveBeenCalledTimes(1);
    expect(channels.getUsageTotals).toHaveBeenCalledTimes(1);
    const call = channels.getUsage.mock.calls[0][0];
    expect(call.accountId).toBe("acct-1");
    expect(call.channel).toBe("whatsapp");
    expect(call.bucket).toBe("hour");
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      "1h",
    );
  });

  it("propagates account context in the breadcrumb/title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toMatch(/acct-1/);
  });

  it("uses hour buckets for the 6h preset", () => {
    fixture.componentInstance.onRangeChange({ mode: "preset", preset: "6h" });

    const call = channels.getUsage.mock.calls.at(-1)?.[0];
    expect(call.bucket).toBe("hour");
    expect(call.accountId).toBe("acct-1");
  });

  it("uses day buckets for the 7d preset", () => {
    fixture.componentInstance.onRangeChange({ mode: "preset", preset: "7d" });

    const call = channels.getUsage.mock.calls.at(-1)?.[0];
    expect(call.bucket).toBe("day");
    expect(call.accountId).toBe("acct-1");
  });

  it("uses exact custom range values when custom selection is valid", () => {
    const from = "2026-04-24T15:00:00.000Z";
    const to = "2026-04-24T16:00:00.000Z";

    fixture.componentInstance.onRangeChange({ mode: "custom", from, to });

    const usageCall = channels.getUsage.mock.calls.at(-1)?.[0];
    const totalsCall = channels.getUsageTotals.mock.calls.at(-1)?.[0];
    expect(usageCall.from).toBe(from);
    expect(usageCall.to).toBe(to);
    expect(usageCall.bucket).toBe("hour");
    expect(totalsCall.from).toBe(from);
    expect(totalsCall.to).toBe(to);
  });

  it("shows an error and skips reload when custom range is invalid", () => {
    channels.getUsage.mockClear();
    channels.getUsageTotals.mockClear();

    fixture.componentInstance.onRangeChange({
      mode: "custom",
      from: "2026-04-24T16:00:00.000Z",
      to: "2026-04-24T15:00:00.000Z",
    });
    fixture.detectChanges();

    expect(channels.getUsage).not.toHaveBeenCalled();
    expect(channels.getUsageTotals).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      "Start date must be before end date",
    );
  });

  it("renders the densified chart even when usage has a single sparse bucket", () => {
    const component = fixture.componentInstance;
    component.resolvedRange.set({
      from: "2026-04-24T00:00:00.000Z",
      to: "2026-04-25T00:00:00.000Z",
      bucket: "hour",
      label: "24h",
    });
    component.usage.set([
      {
        bucket: "2026-04-24T17:00:00.000Z",
        accountId: "acct-1",
        channel: "whatsapp",
        direction: "ingress",
        events: 5,
      },
    ]);
    component.totals.set([
      {
        direction: "ingress",
        events: 5,
        firstTs: "2026-04-24T17:31:41.000Z",
        lastTs: "2026-04-24T17:59:50.000Z",
      },
    ]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain(
      "Selected range has activity, but it is too narrow",
    );
    expect(el.querySelector("svg.usage-chart__svg")).not.toBeNull();
    expect(el.querySelectorAll("svg.usage-chart__svg polyline").length).toBe(3);
  });

  it("shows empty message when totals and chart buckets are empty", () => {
    const component = fixture.componentInstance;
    component.usage.set([]);
    component.totals.set([]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("No usage data for the selected range.");
  });
});
