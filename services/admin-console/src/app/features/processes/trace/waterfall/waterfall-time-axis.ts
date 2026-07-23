/**
 * Time-axis ruler ticks for the Waterfall tab (SPEC.md
 * `manual-loops/admin-console/console-redesign-polish.md` T07, T01 finding
 * 11: mock `Rediseño Terminal.dc.html` lines 734-744 renders 5 evenly-spaced
 * ms labels — `0` / `309ms` / `618ms` / `927ms` / `1,236ms` for a 1,236ms
 * chain — above the waterfall rows). Pure geometry: 5 ticks at 0/25/50/75/
 * 100% of the chain's `total_ms`, the SAME total the rows already position
 * their bars against (`computeWaterfallRows`/`waterfall-geometry.ts`) — no
 * new data source, no invented values.
 */
export interface ITimeAxisTick {
  readonly percent: number;
  readonly ms: number;
}

const TICK_PERCENTS: readonly number[] = [0, 25, 50, 75, 100];

export function computeTimeAxisTicks(
  totalMs: number
): readonly ITimeAxisTick[] {
  const safeTotal = totalMs > 0 ? totalMs : 0;
  if (safeTotal === 0) {
    console.debug(
      "[computeTimeAxisTicks] zero/absent total_ms — all ticks render 0ms",
      { totalMs }
    );
  }
  return TICK_PERCENTS.map((percent) => ({
    percent,
    ms: Math.round((safeTotal * percent) / 100),
  }));
}
