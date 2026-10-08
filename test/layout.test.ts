import { describe, expect, it } from "vitest";
import { clusterRadius, layoutGalaxy, starSize } from "../src/lib/layout.ts";
import { categoryColor, displayTitles } from "../src/lib/palette.ts";
import type { Catalog } from "../src/lib/types.ts";
import raw from "../src/data/catalog.json";

const catalog = raw as Catalog;

describe("layoutGalaxy", () => {
  const galaxy = layoutGalaxy(catalog.categories);

  it("gives one cluster per category and one star per platform entry", () => {
    expect(galaxy.clusters.length).toBe(catalog.categories.length);
    expect(galaxy.stars.length).toBe(catalog.totals.stars);
    galaxy.stars.forEach((s, i) => expect(s.index).toBe(i));
  });
  it("is the same on every run", () => {
    expect(layoutGalaxy(catalog.categories)).toEqual(galaxy);
  });
  it("keeps every star inside its cluster", () => {
    for (const s of galaxy.stars) {
      const c = galaxy.clusters[s.categoryIndex];
      const d = Math.hypot(s.position[0] - c.center[0], s.position[1] - c.center[1], s.position[2] - c.center[2]);
      expect(d + s.size).toBeLessThanOrEqual(c.radius + 1e-6);
    }
  });
  it("keeps clusters from overlapping", () => {
    for (let a = 0; a < galaxy.clusters.length; a++) {
      for (let b = a + 1; b < galaxy.clusters.length; b++) {
        const ca = galaxy.clusters[a];
        const cb = galaxy.clusters[b];
        const d = Math.hypot(ca.center[0] - cb.center[0], ca.center[2] - cb.center[2]);
        expect(d).toBeGreaterThanOrEqual(ca.radius + cb.radius);
      }
    }
  });
  it("sizes stars by job count", () => {
    expect(starSize(226)).toBeGreaterThan(starSize(20));
    expect(starSize(20)).toBeGreaterThan(starSize(1));
    expect(starSize(226) / starSize(1)).toBeLessThan(5);
    expect(clusterRadius(41)).toBeGreaterThan(clusterRadius(2));
    const social = catalog.categories.findIndex((c) => c.id === "social");
    const stars = galaxy.stars.filter((s) => s.categoryIndex === social);
    const biggest = stars.reduce((a, b) => (b.size > a.size ? b : a));
    expect(catalog.categories[social].platforms[biggest.platformIndex].jobCount).toBe(Math.max(...catalog.categories[social].platforms.map((p) => p.jobCount)));
  });
  it("handles a category with one platform and an empty list", () => {
    expect(layoutGalaxy([]).stars).toEqual([]);
    const one = layoutGalaxy([{ ...catalog.categories[0], platforms: [catalog.categories[0].platforms[0]] }]);
    expect(one.stars.length).toBe(1);
    expect(one.stars[0].position.every(Number.isFinite)).toBe(true);
  });
});

describe("palette", () => {
  it("has a distinct colour for every category in the snapshot", () => {
    const colors = catalog.categories.map((c, i) => categoryColor(c.id, i));
    expect(new Set(colors).size).toBe(colors.length);
    expect(categoryColor("new-category", 1)).toMatch(/^#[0-9A-F]{6}$/i);
  });
  it("tells apart two categories that share a title", () => {
    const titles = displayTitles(catalog.categories);
    expect(new Set(titles).size).toBe(titles.length);
    expect(displayTitles([{ id: "a", title: "Other" }, { id: "b", title: "Other" }])).toEqual(["Other", "Other (b)"]);
  });
});
