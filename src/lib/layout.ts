// Where every cluster and star sits. Pure and seeded, so the map is the same on every visit
// and the tests can check it.

import type { Category } from "./types.ts";

export type Vec3 = [number, number, number];

export interface Cluster {
  categoryIndex: number;
  center: Vec3;
  radius: number;
}

export interface Star {
  /** Index into the flat star list, which is also the instance id in the scene. */
  index: number;
  categoryIndex: number;
  platformIndex: number;
  position: Vec3;
  size: number;
}

export interface Galaxy {
  clusters: Cluster[];
  stars: Star[];
  /** Radius of a sphere around the origin that holds every star. */
  extent: number;
}

/** Small seeded generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Star radius from the number of jobs: 1 job is small, 200 jobs is about four times wider. */
export function starSize(jobCount: number): number {
  return 0.24 + 0.15 * Math.log2(1 + Math.max(0, jobCount));
}

export function clusterRadius(platformCount: number): number {
  return 3.4 + 1.25 * Math.sqrt(Math.max(1, platformCount));
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const FLATTEN = 0.55;

/**
 * Nudges overlapping stars of one cluster apart, then pulls any that left the cluster back
 * inside. A fixed number of passes, so the result is the same on every run.
 */
function separate(members: Star[], cluster: Cluster): void {
  for (let pass = 0; pass < 40; pass++) {
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        const pa = members[a].position;
        const pb = members[b].position;
        const dx = pb[0] - pa[0];
        const dy = pb[1] - pa[1];
        const dz = pb[2] - pa[2];
        const d = Math.hypot(dx, dy, dz) || 1e-3;
        const want = (members[a].size + members[b].size) * 1.15;
        if (d >= want) continue;
        // The smaller star moves more.
        const total = members[a].size + members[b].size;
        const push = (want - d) / d;
        const wa = members[b].size / total;
        const wb = members[a].size / total;
        pa[0] -= dx * push * wa;
        pa[1] -= dy * push * wa * 0.6;
        pa[2] -= dz * push * wa;
        pb[0] += dx * push * wb;
        pb[1] += dy * push * wb * 0.6;
        pb[2] += dz * push * wb;
      }
    }
    for (const m of members) {
      const p = m.position;
      const c = cluster.center;
      const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
      const max = cluster.radius - m.size;
      if (d > max && d > 0) {
        const k = max / d;
        p[0] = c[0] + (p[0] - c[0]) * k;
        p[1] = c[1] + (p[1] - c[1]) * k;
        p[2] = c[2] + (p[2] - c[2]) * k;
      }
    }
  }
}

export function layoutGalaxy(categories: Category[]): Galaxy {
  // Cluster centres on a flat golden-angle spiral, larger categories nearer the middle.
  const order = categories.map((c, i) => ({ i, jobs: c.jobCount })).sort((a, b) => b.jobs - a.jobs || a.i - b.i);
  const clusters: Cluster[] = categories.map((c, i) => ({
    categoryIndex: i,
    center: [0, 0, 0],
    radius: clusterRadius(c.platforms.length),
  }));
  order.forEach(({ i }, rank) => {
    const r = 10.5 * Math.sqrt(rank);
    const angle = rank * GOLDEN_ANGLE;
    const lift = (seeded(hash(categories[i].id))() - 0.5) * 7;
    clusters[i].center = [Math.cos(angle) * r, lift, Math.sin(angle) * r];
  });

  // Push overlapping clusters apart on the disc. Fixed pass count keeps it deterministic.
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        const ca = clusters[a].center;
        const cb = clusters[b].center;
        let dx = cb[0] - ca[0];
        let dz = cb[2] - ca[2];
        let d = Math.hypot(dx, dz);
        const want = clusters[a].radius + clusters[b].radius + 1;
        if (d >= want) continue;
        if (d < 1e-6) {
          dx = 1;
          dz = 0;
          d = 1;
        }
        const push = (want - d) / 2 + 0.01;
        ca[0] -= (dx / d) * push;
        ca[2] -= (dz / d) * push;
        cb[0] += (dx / d) * push;
        cb[2] += (dz / d) * push;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const stars: Star[] = [];
  let extent = 0;
  categories.forEach((category, ci) => {
    const cluster = clusters[ci];
    const rand = seeded(hash(`stars:${category.id}`));
    const bySize = category.platforms.map((p, pi) => ({ pi, jobs: p.jobCount })).sort((a, b) => b.jobs - a.jobs || a.pi - b.pi);
    const n = bySize.length;
    const first = stars.length;
    bySize.forEach(({ pi, jobs }, rank) => {
      const size = starSize(jobs);
      // The biggest platform sits in the middle, the rest spiral outward on a flattened ball.
      const t = n === 1 ? 0 : rank / (n - 1);
      const reach = (cluster.radius - size) * Math.sqrt(t) * (0.82 + 0.18 * rand());
      const angle = rank * GOLDEN_ANGLE + rand() * 0.5;
      const tilt = (rand() - 0.5) * 2;
      const flat = Math.sqrt(Math.max(0, 1 - tilt * tilt * 0.6));
      const position: Vec3 = [
        cluster.center[0] + Math.cos(angle) * reach * flat,
        cluster.center[1] + tilt * reach * FLATTEN,
        cluster.center[2] + Math.sin(angle) * reach * flat,
      ];
      stars.push({ index: 0, categoryIndex: ci, platformIndex: pi, position, size });
    });
    separate(stars.slice(first), cluster);
    for (let i = first; i < stars.length; i++) {
      const p = stars[i].position;
      extent = Math.max(extent, Math.hypot(p[0], p[1], p[2]) + stars[i].size);
    }
  });
  // Stable order: category, then platform order from the catalog.
  stars.sort((a, b) => a.categoryIndex - b.categoryIndex || a.platformIndex - b.platformIndex);
  stars.forEach((s, i) => (s.index = i));
  return { clusters, stars, extent };
}
