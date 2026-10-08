import { describe, expect, it } from "vitest";
import { buildJobIndex, score, searchJobs, searchPlatforms } from "../src/lib/search.ts";
import type { Catalog, CategoryJobs } from "../src/lib/types.ts";
import raw from "../src/data/catalog.json";

const catalog = raw as Catalog;

describe("score", () => {
  it("ranks exact over prefix over inside", () => {
    expect(score("tiktok", "tiktok")).toBe(3);
    expect(score("tiktok shop", "tik")).toBe(2);
    expect(score("people.email.find", "email")).toBe(2);
    expect(score("linkedin", "kedin")).toBe(1);
    expect(score("linkedin", "xyz")).toBe(0);
    expect(score("find a work email", "email find")).toBe(0.5);
  });
});

describe("searchPlatforms", () => {
  it("finds platforms by name in every category they are listed under", () => {
    const hits = searchPlatforms(catalog, "LinkedIn", 10);
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[0].title.toLowerCase()).toContain("linkedin");
  });
  it("returns nothing for an empty query or no match", () => {
    expect(searchPlatforms(catalog, "  ")).toEqual([]);
    expect(searchPlatforms(catalog, "zzzzqq")).toEqual([]);
  });
});

describe("searchJobs", () => {
  const enrichment = catalog.categories.findIndex((c) => c.id === "enrichment");
  const files: (CategoryJobs | null)[] = catalog.categories.map(() => null);
  files[enrichment] = {
    people: [
      { id: "people.email.find", title: "Find a work email from a name and domain", providerCount: 23, cheapestPerCall: 0.003598, cheapestPerResult: 0.019 },
      { id: "people.email.verify", title: "Verify an email address is deliverable", providerCount: 15, cheapestPerCall: 0.00145, cheapestPerResult: null },
    ],
  };
  const index = buildJobIndex(catalog, files);

  it("indexes only the categories that loaded", () => {
    expect(index.length).toBe(2);
    expect(index[0].categoryIndex).toBe(enrichment);
  });
  it("matches job titles and job ids", () => {
    expect(searchJobs(index, "work email")[0].jobId).toBe("people.email.find");
    expect(searchJobs(index, "email.verify")[0].jobId).toBe("people.email.verify");
    expect(searchJobs(index, "e")).toEqual([]);
  });
});
