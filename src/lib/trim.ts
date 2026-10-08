// Turns the raw /v1/catalog/overview?depth=jobs response into the files this site commits:
// one small catalog (categories and platforms) and one job file per category.

import type { Catalog, Category, CategoryJobs, Job, Platform } from "./types.ts";

type Raw = Record<string, unknown>;

function str(v: unknown, field: string): string {
  if (typeof v !== "string" || v === "") throw new Error(`snapshot: ${field} is missing`);
  return v;
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** A price is a non-negative number or null. Anything else in the response reads as null. */
export function price(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function list(v: unknown): Raw[] {
  return Array.isArray(v) ? (v as Raw[]) : [];
}

function trimJob(j: Raw): Job {
  return {
    id: str(j.id, "job.id"),
    title: str(j.title, `job ${String(j.id)} title`),
    providerCount: count(j.providerCount),
    cheapestPerCall: price(j.cheapestPerCall),
    cheapestPerResult: price(j.cheapestPerResult),
  };
}

export interface Trimmed {
  catalog: Catalog;
  /** Category id to that category's job file. */
  jobs: Record<string, CategoryJobs>;
}

/** Keeps only the fields the site shows and splits jobs out by category. */
export function trimOverview(raw: unknown, snapshotDate: string): Trimmed {
  const root = (raw ?? {}) as Raw;
  const rawCategories = list(root.categories);
  if (rawCategories.length === 0) throw new Error("snapshot: the response has no categories");

  const jobs: Record<string, CategoryJobs> = {};
  let platformTotal = 0;
  let jobTotal = 0;

  const categories: Category[] = rawCategories.map((c) => {
    const id = str(c.id, "category.id");
    const file: CategoryJobs = {};
    const platforms: Platform[] = list(c.platforms).map((p) => {
      const pid = str(p.id, `platform id in ${id}`);
      const platformJobs = list(p.jobs).map(trimJob);
      file[pid] = platformJobs;
      jobTotal += platformJobs.length;
      return {
        id: pid,
        title: str(p.title, `platform ${pid} title`),
        jobCount: platformJobs.length,
        providerCount: count(p.providerCount),
        cheapestPerCall: price(p.cheapestPerCall),
        cheapestPerResult: price(p.cheapestPerResult),
      };
    });
    platformTotal += platforms.length;
    jobs[id] = file;
    return {
      id,
      title: str(c.title, `category ${id} title`),
      platformCount: platforms.length,
      jobCount: platforms.reduce((n, p) => n + p.jobCount, 0),
      providerCount: count(c.providerCount),
      cheapestPerCall: price(c.cheapestPerCall),
      cheapestPerResult: price(c.cheapestPerResult),
      platforms,
    };
  });

  const totals = (root.totals ?? {}) as Raw;
  return {
    catalog: {
      snapshotDate,
      revision: String(root.revision ?? ""),
      builtAt: String(root.builtAt ?? ""),
      totals: {
        categories: categories.length,
        // A platform listed under two categories is one platform in the API's total and one
        // star per category on the map, so the star count can be higher than this number.
        platforms: count(totals.platforms) || platformTotal,
        stars: platformTotal,
        jobs: jobTotal,
        providers: count(totals.providers),
      },
      categories,
    },
    jobs,
  };
}
