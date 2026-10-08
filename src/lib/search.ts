// Search across platform names and job titles. Plain substring scoring, no dependency.

import type { Catalog, CategoryJobs } from "./types.ts";

export interface PlatformHit {
  kind: "platform";
  categoryIndex: number;
  platformIndex: number;
  title: string;
  score: number;
}

export interface JobHit {
  kind: "job";
  categoryIndex: number;
  platformIndex: number;
  jobId: string;
  title: string;
  score: number;
}

export interface JobIndexEntry {
  categoryIndex: number;
  platformIndex: number;
  jobId: string;
  title: string;
  /** Lowercased title and id, built once. */
  text: string;
}

export function normalize(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

/** 3 for an exact match, 2 for a prefix or word start, 1 for anywhere else, 0 for no match. */
export function score(text: string, q: string): number {
  if (q === "") return 0;
  const at = text.indexOf(q);
  if (at < 0) {
    const words = q.split(" ");
    return words.length > 1 && words.every((w) => text.includes(w)) ? 0.5 : 0;
  }
  if (text === q) return 3;
  if (at === 0 || /[\s._\-/]/.test(text[at - 1])) return 2;
  return 1;
}

export function searchPlatforms(catalog: Catalog, query: string, limit = 6): PlatformHit[] {
  const q = normalize(query);
  if (q === "") return [];
  const hits: PlatformHit[] = [];
  catalog.categories.forEach((c, ci) => {
    c.platforms.forEach((p, pi) => {
      const s = Math.max(score(p.title.toLowerCase(), q), score(p.id.toLowerCase(), q));
      if (s > 0) hits.push({ kind: "platform", categoryIndex: ci, platformIndex: pi, title: p.title, score: s + Math.min(0.4, p.jobCount / 600) });
    });
  });
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

export function buildJobIndex(catalog: Catalog, files: (CategoryJobs | null)[]): JobIndexEntry[] {
  const out: JobIndexEntry[] = [];
  catalog.categories.forEach((c, ci) => {
    const file = files[ci];
    if (!file) return;
    c.platforms.forEach((p, pi) => {
      for (const j of file[p.id] ?? []) {
        out.push({ categoryIndex: ci, platformIndex: pi, jobId: j.id, title: j.title, text: `${j.title} ${j.id}`.toLowerCase() });
      }
    });
  });
  return out;
}

export function searchJobs(index: JobIndexEntry[], query: string, limit = 12): JobHit[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const hits: JobHit[] = [];
  for (const e of index) {
    const s = score(e.text, q);
    if (s > 0) hits.push({ kind: "job", categoryIndex: e.categoryIndex, platformIndex: e.platformIndex, jobId: e.jobId, title: e.title, score: s });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.length - b.title.length || a.title.localeCompare(b.title)).slice(0, limit);
}
