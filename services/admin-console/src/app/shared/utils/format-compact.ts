export function formatCompact(n: number): string {
  if (isNaN(n)) return "0";

  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);

  if (abs >= 1_000_000) {
    return sign + (abs / 1_000_000).toFixed(1) + "M";
  }

  if (abs >= 1_000) {
    return sign + (abs / 1_000).toFixed(1) + "K";
  }

  return sign + String(abs);
}
