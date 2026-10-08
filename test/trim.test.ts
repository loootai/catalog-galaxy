import { describe, expect, it } from "vitest";
import { price, trimOverview } from "../src/lib/trim.ts";
import catalog from "../src/data/catalog.json";

const RAW = {
  revision: 7,
  builtAt: "2026-10-08T16:56:01.085Z",
  depth: "jobs",
  totals: { categories: 2, platforms: 2, jobs: 3, providers: 9, endpoints: 40, runnableEndpoints: 38 },
  categories: [
    {
      id: "enrichment", title: "Enrichment", platformCount: 2, jobCount: 3, providerCount: 5, endpointCount: 30, runnableCount: 29,
      cheapestPerCall: 0, cheapestPerResult: 0.001,
      platforms: [
        { id: "people", title: "People", jobCount: 2, providerCount: 4, endpointCount: 20, runnableCount: 20, cheapestPerCall: 0.0014, cheapestPerResult: null,
          jobs: [
            { id: "people.email.find", title: "Find a work email", providerCount: 23, endpointCount: 25, runnableCount: 25, cheapestPerCall: 0.003598, cheapestPerResult: 0.019 },
            { id: "people.email.verify", title: "Verify an email", providerCount: 15, endpointCount: 15, runnableCount: 15, cheapestPerCall: 0.00145, cheapestPerResult: null },
          ] },
        { id: "web", title: "Web", jobCount: 1, providerCount: 1, cheapestPerCall: null, cheapestPerResult: "n/a",
          jobs: [{ id: "web.read", title: "Read a page", providerCount: 1, cheapestPerCall: -1, cheapestPerResult: undefined }] },
      ],
    },
    { id: "search", title: "Search", providerCount: 4, cheapestPerCall: 0.001, cheapestPerResult: null,
      platforms: [{ id: "web", title: "Web", providerCount: 2, cheapestPerCall: 0.001, cheapestPerResult: null, jobs: [] }] },
  ],
};

describe("trimOverview", () => {
  const { catalog: out, jobs } = trimOverview(RAW, "2026-10-08");

  it("keeps the date, revision and totals", () => {
    expect(out.snapshotDate).toBe("2026-10-08");
    expect(out.revision).toBe("7");
    expect(out.totals).toEqual({ categories: 2, platforms: 2, stars: 3, jobs: 3, providers: 9 });
  });
  it("drops jobs and endpoint counts from the catalog file", () => {
    const people = out.categories[0].platforms[0];
    expect(people).toEqual({ id: "people", title: "People", jobCount: 2, providerCount: 4, cheapestPerCall: 0.0014, cheapestPerResult: null });
    expect(JSON.stringify(out)).not.toContain("endpointCount");
  });
  it("writes one job file per category, keyed by platform id", () => {
    expect(Object.keys(jobs)).toEqual(["enrichment", "search"]);
    expect(jobs.enrichment.people.map((j) => j.id)).toEqual(["people.email.find", "people.email.verify"]);
    expect(jobs.enrichment.people[0]).toEqual({ id: "people.email.find", title: "Find a work email", providerCount: 23, cheapestPerCall: 0.003598, cheapestPerResult: 0.019 });
    expect(jobs.search.web).toEqual([]);
  });
  it("reads a bad price as null, never as zero", () => {
    expect(jobs.enrichment.web[0].cheapestPerCall).toBeNull();
    expect(jobs.enrichment.web[0].cheapestPerResult).toBeNull();
    expect(out.categories[0].platforms[1].cheapestPerResult).toBeNull();
    expect(price(0)).toBe(0);
    expect(price("0")).toBeNull();
  });
  it("refuses an empty or malformed response", () => {
    expect(() => trimOverview({}, "2026-10-08")).toThrow(/no categories/);
    expect(() => trimOverview({ categories: [{ title: "x" }] }, "2026-10-08")).toThrow(/category.id/);
  });
});

describe("the committed snapshot", () => {
  it("is dated and its counts add up", () => {
    expect(catalog.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(catalog.categories.length).toBe(catalog.totals.categories);
    const stars = catalog.categories.reduce((n, c) => n + c.platforms.length, 0);
    expect(stars).toBe(catalog.totals.stars);
    const jobs = catalog.categories.reduce((n, c) => n + c.platforms.reduce((m, p) => m + p.jobCount, 0), 0);
    expect(jobs).toBe(catalog.totals.jobs);
  });
});
