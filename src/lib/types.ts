// Shapes of the committed catalog snapshot. Field names match the looot API response.

export interface Job {
  id: string;
  title: string;
  providerCount: number;
  cheapestPerCall: number | null;
  cheapestPerResult: number | null;
}

export interface Platform {
  id: string;
  title: string;
  jobCount: number;
  providerCount: number;
  cheapestPerCall: number | null;
  cheapestPerResult: number | null;
}

export interface Category {
  id: string;
  title: string;
  platformCount: number;
  jobCount: number;
  providerCount: number;
  cheapestPerCall: number | null;
  cheapestPerResult: number | null;
  platforms: Platform[];
}

export interface Totals {
  categories: number;
  platforms: number;
  /** Platform entries on the map: a platform in two categories counts twice here. */
  stars: number;
  jobs: number;
  providers: number;
}

export interface Catalog {
  /** Day the snapshot was fetched, YYYY-MM-DD (UTC). */
  snapshotDate: string;
  revision: string;
  builtAt: string;
  totals: Totals;
  categories: Category[];
}

/** One file per category: platform id to its jobs. */
export type CategoryJobs = Record<string, Job[]>;
