// npm run snapshot: fetch the free looot catalog overview and rewrite the committed snapshot.
// No token needed. Writes src/data/catalog.json and public/data/jobs/<category>.json.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { trimOverview } from "../src/lib/trim.ts";

const SOURCE = "https://api.looot.ai/v1/catalog/overview?depth=jobs";
const CATALOG_FILE = new URL("../src/data/catalog.json", import.meta.url);
const JOBS_DIR = new URL("../public/data/jobs/", import.meta.url);

const res = await fetch(SOURCE, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
if (!res.ok) {
  console.error(`snapshot: ${SOURCE} answered HTTP ${res.status}. Nothing was changed.`);
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
const { catalog, jobs } = trimOverview(await res.json(), today);

mkdirSync(JOBS_DIR, { recursive: true });
for (const name of readdirSync(JOBS_DIR)) {
  if (name.endsWith(".json")) rmSync(new URL(name, JOBS_DIR));
}
for (const [categoryId, file] of Object.entries(jobs)) {
  if (!/^[a-z0-9-]+$/.test(categoryId)) throw new Error(`snapshot: unexpected category id ${categoryId}`);
  writeFileSync(new URL(`${categoryId}.json`, JOBS_DIR), JSON.stringify(file));
}
mkdirSync(new URL(".", CATALOG_FILE), { recursive: true });
writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 1) + "\n");

const t = catalog.totals;
console.log(`snapshot ${today}: ${t.categories} categories, ${t.platforms} platforms, ${t.jobs} jobs, ${t.providers} providers (catalog revision ${catalog.revision})`);
