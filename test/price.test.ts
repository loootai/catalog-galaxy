import { describe, expect, it } from "vitest";
import { formatFrom, formatPrice, plural, usd } from "../src/lib/price.ts";

describe("usd", () => {
  it("keeps sub-cent prices readable and never rounds them to zero", () => {
    expect(usd(0.0019)).toBe("$0.0019");
    expect(usd(0.003598)).toBe("$0.0036");
    expect(usd(0.00145)).toBe("$0.00145");
    expect(usd(0.000033)).toBe("$0.000033");
    expect(usd(0.00012)).toBe("$0.00012");
  });
  it("prints cents and dollars plainly", () => {
    expect(usd(0.01)).toBe("$0.01");
    expect(usd(0.06532)).toBe("$0.0653");
    expect(usd(0.5)).toBe("$0.5");
    expect(usd(1.5)).toBe("$1.50");
    expect(usd(12)).toBe("$12.00");
  });
});

describe("formatPrice", () => {
  it("says n/a when no price is listed", () => {
    expect(formatPrice(null, null)).toBe("n/a");
    expect(formatFrom(null, null)).toBe("price n/a");
  });
  it("says free only for an exact zero", () => {
    expect(formatPrice(0, null)).toBe("free per call");
    expect(formatPrice(0.0000004, null)).not.toContain("free");
  });
  it("shows the unit, and both units when both are listed", () => {
    expect(formatPrice(0.0019, null)).toBe("$0.0019 per call");
    expect(formatPrice(null, 0.004)).toBe("$0.004 per result");
    expect(formatPrice(0, 0.01)).toBe("free per call or $0.01 per result");
    expect(formatFrom(0.001, null)).toBe("from $0.001 per call");
    expect(formatFrom(0, 0.0001)).toBe("free per call or from $0.0001 per result");
  });
});

describe("plural", () => {
  it("picks the right word and groups thousands", () => {
    expect(plural(1, "job")).toBe("1 job");
    expect(plural(2071, "job")).toBe("2,071 jobs");
    expect(plural(2, "category", "categories")).toBe("2 categories");
  });
});
