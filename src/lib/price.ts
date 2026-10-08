// Price text. "free" appears only when the listed value is exactly 0, "n/a" when no price is
// listed. Nothing is rounded to zero.

/** Dollars with enough digits to stay truthful for sub-cent prices: $0.0019, $0.000033, $1.50. */
export function usd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${trimZeros(n.toFixed(4))}`;
  // Three significant digits, written without an exponent.
  const digits = Math.min(12, Math.max(4, 2 - Math.floor(Math.log10(n))));
  return `$${trimZeros(n.toFixed(digits))}`;
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function part(n: number, unit: string): string {
  return n === 0 ? `free per ${unit}` : `${usd(n)} per ${unit}`;
}

/**
 * The cheapest listed price for a job, platform or category. Some providers bill per call and
 * some per result, so both are shown when both are listed.
 */
export function formatPrice(perCall: number | null, perResult: number | null): string {
  const parts: string[] = [];
  if (perCall !== null) parts.push(part(perCall, "call"));
  if (perResult !== null) parts.push(part(perResult, "result"));
  return parts.length === 0 ? "n/a" : parts.join(" or ");
}

/** The cheapest price across several jobs or providers: "from" goes in front of each paid price. */
export function formatFrom(perCall: number | null, perResult: number | null): string {
  const parts: string[] = [];
  if (perCall !== null) parts.push(perCall === 0 ? "free per call" : `from ${part(perCall, "call")}`);
  if (perResult !== null) parts.push(perResult === 0 ? "free per result" : `from ${part(perResult, "result")}`);
  return parts.length === 0 ? "price n/a" : parts.join(" or ");
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
