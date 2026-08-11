import { ComponentFixture, TestBed } from "@angular/core/testing";
import type {
  IUsageBucketRow,
  UsageBucket,
} from "../../../core/models/channel-streams.model";
import {
  UsageChartComponent,
  type IUsageChartRange,
} from "./usage-chart.component";

function rangeOf(
  fromIso: string,
  toIso: string,
  bucket: UsageBucket = "hour",
): IUsageChartRange {
  return { from: fromIso, to: toIso, bucket };
}

describe("UsageChartComponent", () => {
  let fixture: ComponentFixture<UsageChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UsageChartComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UsageChartComponent);
  });

  it("densifies a 24h hour-bucket range and renders polylines even with one sparse row", () => {
    const sparse: ReadonlyArray<IUsageBucketRow> = [
      {
        bucket: "2026-04-24T17:00:00.000Z",
        accountId: "acct-1",
        channel: "telegram",
        direction: "ingress",
        events: 5,
      },
    ];
    fixture.componentRef.setInput("data", sparse);
    fixture.componentRef.setInput(
      "range",
      rangeOf("2026-04-24T00:00:00.000Z", "2026-04-25T00:00:00.000Z"),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.chart().bucketCount).toBe(24);
    expect(fixture.componentInstance.chart().hasData).toBe(true);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("svg.usage-chart__svg")).not.toBeNull();
    const polylines = el.querySelectorAll("svg.usage-chart__svg polyline");
    expect(polylines.length).toBe(3);
    expect(el.textContent).not.toContain(
      "Selected range has activity, but it is too narrow",
    );
    expect(el.textContent).not.toContain("No usage data");
  });

  it("renders dot markers when the dense range collapses to a single bucket", () => {
    const data: ReadonlyArray<IUsageBucketRow> = [
      {
        bucket: "2026-04-24T17:00:00.000Z",
        accountId: "acct-1",
        channel: "telegram",
        direction: "ingress",
        events: 3,
      },
      {
        bucket: "2026-04-24T17:00:00.000Z",
        accountId: "acct-1",
        channel: "telegram",
        direction: "egress",
        events: 1,
      },
    ];
    fixture.componentRef.setInput("data", data);
    fixture.componentRef.setInput(
      "range",
      rangeOf("2026-04-24T17:00:00.000Z", "2026-04-24T18:00:00.000Z"),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.chart().bucketCount).toBe(1);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("svg.usage-chart__svg polyline")).toBeNull();
    const circles = el.querySelectorAll("svg.usage-chart__svg circle");
    expect(circles.length).toBe(2);
  });

  it("shows the empty state when no range and no data are provided", () => {
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("svg.usage-chart__svg")).toBeNull();
    expect(el.textContent).toContain("No usage data for the selected range.");
  });

  it("shows the empty state when the dense range has zero events across all buckets", () => {
    fixture.componentRef.setInput("data", []);
    fixture.componentRef.setInput(
      "range",
      rangeOf("2026-04-24T00:00:00.000Z", "2026-04-25T00:00:00.000Z"),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.chart().bucketCount).toBe(24);
    expect(fixture.componentInstance.chart().hasData).toBe(false);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("svg.usage-chart__svg")).toBeNull();
    expect(el.textContent).toContain("No usage data for the selected range.");
  });

  it("aligns hour buckets to UTC boundaries when 'from' is mid-hour", () => {
    fixture.componentRef.setInput(
      "range",
      rangeOf("2026-04-24T17:30:00.000Z", "2026-04-24T20:00:00.000Z"),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.chart().bucketCount).toBe(2);
  });

  it("aligns day buckets to UTC midnight", () => {
    fixture.componentRef.setInput(
      "range",
      rangeOf(
        "2026-04-20T00:00:00.000Z",
        "2026-04-27T00:00:00.000Z",
        "day",
      ),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.chart().bucketCount).toBe(7);
  });
});
