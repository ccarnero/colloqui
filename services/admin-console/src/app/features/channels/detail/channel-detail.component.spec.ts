import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, ActivatedRoute, convertToParamMap } from "@angular/router";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { BehaviorSubject, of } from "rxjs";
import { vi } from "vitest";
import { MatDialog } from "@angular/material/dialog";
import { ChannelDetailComponent } from "./channel-detail.component";
import { ChannelAdminService } from "../../../core/services/channel-admin.service";

describe("ChannelDetailComponent", () => {
  let fixture: ComponentFixture<ChannelDetailComponent>;
  let channels: {
    getUsage: ReturnType<typeof vi.fn>;
    getUsageTotals: ReturnType<typeof vi.fn>;
    getStreams: ReturnType<typeof vi.fn>;
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
            { direction: "ingress", events: 10 },
            { direction: "egress", events: 4 },
          ],
        }),
      ),
      getStreams: vi.fn().mockReturnValue(
        of({
          items: [
            {
              name: "INGRESS-tenant-1",
              kind: "ingress",
              subjects: ["ingress.>"],
              messages: 100,
              bytes: 1024,
              firstSeq: 1,
              lastSeq: 100,
              firstTs: null,
              lastTs: null,
              maxAgeNs: 0,
              maxBytes: 0,
              consumerCount: 2,
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

  it("loads usage, totals and streams on init", () => {
    expect(channels.getUsage).toHaveBeenCalledTimes(1);
    expect(channels.getUsageTotals).toHaveBeenCalledTimes(1);
    expect(channels.getStreams).toHaveBeenCalledTimes(1);
    const call = channels.getUsage.mock.calls[0][0];
    expect(call.accountId).toBe("acct-1");
    expect(call.channel).toBe("whatsapp");
  });

  it("propagates account context in the breadcrumb/title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toMatch(/acct-1/);
  });
});
