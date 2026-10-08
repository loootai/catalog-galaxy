// App wiring: selection state, the side panel, search, the list view and the keyboard.
// The 3D scene is loaded on demand so the list view never downloads Three.js.

import "@fontsource-variable/geist";
import "./style.css";
import rawCatalog from "./data/catalog.json";
import { layoutGalaxy } from "./lib/layout.ts";
import { categoryColor, displayTitles } from "./lib/palette.ts";
import { formatFrom, formatPrice, plural } from "./lib/price.ts";
import { buildJobIndex, searchJobs, searchPlatforms, type JobHit, type JobIndexEntry, type PlatformHit } from "./lib/search.ts";
import type { Catalog, CategoryJobs, Job } from "./lib/types.ts";
import type { SceneApi } from "./scene.ts";

const catalog = rawCatalog as Catalog;
const titles = displayTitles(catalog.categories);
const galaxy = layoutGalaxy(catalog.categories);

/** Flat star index for a category and platform position. */
const starOf: number[][] = catalog.categories.map(() => []);
galaxy.stars.forEach((s) => (starOf[s.categoryIndex][s.platformIndex] = s.index));

const root = document.documentElement;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const stage = $("stage");
const canvas = $<HTMLCanvasElement>("scene");
const panel = $("panel");
const listEl = $("list");
const legend = $("legend");
const tooltip = $("tooltip");
const toggle = $<HTMLButtonElement>("view-toggle");
const searchInput = $<HTMLInputElement>("search-input");
const resultsEl = $("search-results");
const stageNote = $("stage-note");

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | number> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "1.75");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  svg.append(p);
  return svg;
}

const ICON_CLOSE = "M6 6l12 12M18 6L6 18";
const ICON_BACK = "M14 6l-6 6 6 6";
const ICON_OUT = "M9 6h9v9M18 6L7 17";

function dot(categoryIndex: number): HTMLSpanElement {
  const s = h("span", { class: "dot", "aria-hidden": "true" });
  s.style.setProperty("--c", categoryColor(catalog.categories[categoryIndex].id, categoryIndex));
  return s;
}

// ---------------------------------------------------------------------------------------------
// Job files, one per category, fetched the first time they are needed.

const jobFiles = new Map<number, Promise<CategoryJobs>>();

function loadJobs(categoryIndex: number): Promise<CategoryJobs> {
  let p = jobFiles.get(categoryIndex);
  if (!p) {
    const id = catalog.categories[categoryIndex].id;
    p = fetch(`${import.meta.env.BASE_URL}data/jobs/${encodeURIComponent(id)}.json`).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<CategoryJobs>;
    });
    p.catch(() => jobFiles.delete(categoryIndex));
    jobFiles.set(categoryIndex, p);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// State

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const reducedMotion = (): boolean => motionQuery.matches;

type ViewMode = "galaxy" | "list";
let view: ViewMode = "galaxy";
let scene: SceneApi | null = null;
let sceneLoading: Promise<void> | null = null;
let webglFailed = false;
let selCategory: number | null = null;
let selPlatform: number | null = null;
let highlightJob: string | null = null;
let listBuilt = false;

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

function writeHash(): void {
  let hash = "";
  if (selCategory !== null) {
    hash = `#/${catalog.categories[selCategory].id}`;
    if (selPlatform !== null) hash += `/${catalog.categories[selCategory].platforms[selPlatform].id}`;
  }
  if (hash !== location.hash) history.replaceState(null, "", hash === "" ? location.pathname + location.search : hash);
}

function readHash(): { category: number | null; platform: number | null } {
  const [, c, p] = location.hash.split("/");
  const ci = catalog.categories.findIndex((x) => x.id === c);
  if (ci < 0) return { category: null, platform: null };
  const pi = catalog.categories[ci].platforms.findIndex((x) => x.id === p);
  return { category: ci, platform: pi < 0 ? null : pi };
}

function select(categoryIndex: number | null, platformIndex: number | null, jobId: string | null = null): void {
  selCategory = categoryIndex;
  selPlatform = categoryIndex === null ? null : platformIndex;
  highlightJob = jobId;
  writeHash();
  hideTooltip();
  syncLegend();
  if (view === "list") {
    openInList();
    return;
  }
  renderPanel();
  scene?.setSelection(selCategory, selCategory !== null && selPlatform !== null ? starOf[selCategory][selPlatform] : null);
}

function stepBack(): void {
  if (selPlatform !== null) select(selCategory, null);
  else if (selCategory !== null) select(null, null);
  else scene?.showAll();
}

// ---------------------------------------------------------------------------------------------
// Legend: the keyboard path through the categories.

const legendButtons: HTMLButtonElement[] = [];

function buildLegend(): void {
  const ul = h("ul", { class: "legend-list" });
  catalog.categories.forEach((c, ci) => {
    const b = h(
      "button",
      { type: "button", class: "legend-item", "aria-pressed": "false", "aria-label": `${titles[ci]}: ${plural(c.platforms.length, "platform")}, ${plural(c.jobCount, "job")}` },
      dot(ci),
      h("span", { class: "legend-name" }, titles[ci]),
      h("span", { class: "legend-count" }, String(c.platforms.length)),
    );
    b.addEventListener("click", () => select(selCategory === ci && selPlatform === null ? null : ci, null));
    legendButtons.push(b);
    ul.append(h("li", {}, b));
  });
  legend.append(h("p", { class: "legend-title" }, "Categories", h("span", {}, "platforms")), ul);
}

function syncLegend(): void {
  legendButtons.forEach((b, i) => {
    b.setAttribute("aria-pressed", String(i === selCategory));
    b.classList.toggle("is-dim", selCategory !== null && i !== selCategory);
  });
}

// ---------------------------------------------------------------------------------------------
// Panel

function statLine(parts: string[]): HTMLParagraphElement {
  return h("p", { class: "stats" }, parts.join(" · "));
}

function jobRow(job: Job): HTMLLIElement {
  const li = h(
    "li",
    { class: "job", "data-job": job.id },
    h("span", { class: "job-title" }, job.title),
    h("span", { class: "job-price" }, formatPrice(job.cheapestPerCall, job.cheapestPerResult)),
    h("span", { class: "job-providers" }, plural(job.providerCount, "provider")),
    h("code", { class: "job-id" }, `job:${job.id}`),
  );
  return li;
}

function skeleton(rows: number): HTMLElement {
  const box = h("div", { class: "skeleton", "aria-hidden": "true" });
  for (let i = 0; i < rows; i++) box.append(h("span", {}));
  return box;
}

/** Fills `box` with the platform's jobs, with loading, empty and error states. */
function mountJobs(box: HTMLElement, categoryIndex: number, platformIndex: number, opts: { filter: boolean; highlight: string | null }): void {
  const platform = catalog.categories[categoryIndex].platforms[platformIndex];
  box.replaceChildren(h("p", { class: "sr-only", role: "status" }, "Loading jobs"), skeleton(Math.min(6, Math.max(2, platform.jobCount))));
  loadJobs(categoryIndex).then(
    (file) => {
      const jobs = file[platform.id] ?? [];
      if (jobs.length === 0) {
        box.replaceChildren(h("p", { class: "empty" }, "No jobs are listed for this platform in this snapshot."));
        return;
      }
      const ul = h("ul", { class: "jobs" });
      const rows = jobs.map((j) => ({ job: j, el: jobRow(j), text: `${j.title} ${j.id}`.toLowerCase() }));
      rows.forEach((r) => ul.append(r.el));
      const none = h("p", { class: "empty", hidden: true }, "No job matches that filter.");
      box.replaceChildren();
      if (opts.filter && jobs.length > 8) {
        const id = `job-filter-${categoryIndex}-${platformIndex}`;
        const input = h("input", { id, type: "search", autocomplete: "off", spellcheck: "false", placeholder: "email, search, profile" });
        input.addEventListener("input", () => {
          const q = input.value.toLowerCase().trim();
          let shown = 0;
          for (const r of rows) {
            const on = q === "" || r.text.includes(q);
            r.el.hidden = !on;
            if (on) shown++;
          }
          none.hidden = shown > 0;
        });
        box.append(h("div", { class: "field" }, h("label", { for: id }, `Filter ${plural(jobs.length, "job")}`), input));
      }
      box.append(ul, none);
      if (opts.highlight) {
        const hit = rows.find((r) => r.job.id === opts.highlight);
        if (hit) {
          hit.el.classList.add("is-hit");
          hit.el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
        }
      }
    },
    () => {
      const retry = h("button", { type: "button", class: "btn" }, "Try again");
      retry.addEventListener("click", () => mountJobs(box, categoryIndex, platformIndex, opts));
      box.replaceChildren(h("div", { class: "error", role: "alert" }, h("p", {}, "The job list did not load. Check the connection and try again."), retry));
    },
  );
}

function renderPanel(): void {
  if (selCategory === null) {
    panel.hidden = true;
    root.dataset.panel = "closed";
    panel.replaceChildren();
    return;
  }
  const ci = selCategory;
  const category = catalog.categories[ci];
  const close = h("button", { type: "button", class: "icon-btn", "aria-label": "Close" }, icon(ICON_CLOSE));
  close.addEventListener("click", () => select(null, null));
  const body = h("div", { class: "panel-body" });
  const head = h("div", { class: "panel-head" });

  if (selPlatform === null) {
    head.append(
      h("div", { class: "panel-title" }, h("p", { class: "eyebrow" }, dot(ci), "Category"), h("h2", {}, titles[ci])),
      close,
    );
    body.append(
      statLine([plural(category.platforms.length, "platform"), plural(category.jobCount, "job"), plural(category.providerCount, "provider")]),
      h("p", { class: "price-line" }, formatFrom(category.cheapestPerCall, category.cheapestPerResult)),
    );
    const ul = h("ul", { class: "platforms" });
    category.platforms
      .map((p, pi) => ({ p, pi }))
      .sort((a, b) => b.p.jobCount - a.p.jobCount || a.p.title.localeCompare(b.p.title))
      .forEach(({ p, pi }) => {
        const b = h(
          "button",
          { type: "button", class: "platform-row" },
          h("span", { class: "platform-name" }, p.title),
          h("span", { class: "platform-jobs" }, plural(p.jobCount, "job")),
          h("span", { class: "platform-price" }, formatFrom(p.cheapestPerCall, p.cheapestPerResult)),
        );
        b.addEventListener("click", () => select(ci, pi));
        ul.append(h("li", {}, b));
      });
    body.append(ul);
  } else {
    const pi = selPlatform;
    const platform = category.platforms[pi];
    const back = h("button", { type: "button", class: "back" }, icon(ICON_BACK), dot(ci), titles[ci]);
    back.addEventListener("click", () => select(ci, null));
    head.append(h("div", { class: "panel-title" }, back, h("h2", {}, platform.title)), close);
    body.append(
      statLine([plural(platform.jobCount, "job"), plural(platform.providerCount, "provider")]),
      h("p", { class: "price-line" }, formatFrom(platform.cheapestPerCall, platform.cheapestPerResult)),
    );
    const box = h("div", { class: "jobs-box" });
    body.append(box);
    mountJobs(box, ci, pi, { filter: true, highlight: highlightJob });
  }

  const foot = h(
    "p",
    { class: "panel-foot" },
    "Prices are the cheapest listed on ",
    catalog.snapshotDate,
    ". A failed call costs nothing. ",
    h("a", { href: "https://looot.ai" }, "Run these jobs on looot", icon(ICON_OUT)),
  );
  panel.replaceChildren(head, body, foot);
  panel.hidden = false;
  root.dataset.panel = "open";
  body.scrollTop = 0;
}

// ---------------------------------------------------------------------------------------------
// Tooltip

function hideTooltip(): void {
  tooltip.hidden = true;
}

function showTooltip(star: number | null, x: number, y: number): void {
  if (star === null) {
    hideTooltip();
    return;
  }
  const s = galaxy.stars[star];
  const platform = catalog.categories[s.categoryIndex].platforms[s.platformIndex];
  tooltip.replaceChildren(
    h("strong", {}, platform.title),
    h("span", { class: "tooltip-cat" }, dot(s.categoryIndex), titles[s.categoryIndex]),
    h("span", {}, `${plural(platform.jobCount, "job")} · ${formatFrom(platform.cheapestPerCall, platform.cheapestPerResult)}`),
  );
  tooltip.hidden = false;
  const rect = stage.getBoundingClientRect();
  const w = tooltip.offsetWidth;
  const left = Math.min(rect.width - w - 8, Math.max(8, x + 16));
  const top = y + 18 + tooltip.offsetHeight > rect.height ? y - tooltip.offsetHeight - 12 : y + 18;
  tooltip.style.transform = `translate(${left.toFixed(0)}px, ${top.toFixed(0)}px)`;
}

// ---------------------------------------------------------------------------------------------
// List view: the same catalog as plain sections. Default with reduced motion or without WebGL.

const listDetails = new Map<string, HTMLDetailsElement>();

function buildList(): void {
  if (listBuilt) return;
  listBuilt = true;
  const t = catalog.totals;
  const intro = h(
    "div",
    { class: "list-intro" },
    h("h2", {}, "The catalog as a list"),
    h(
      "p",
      {},
      `${plural(t.categories, "category", "categories")}, ${plural(t.platforms, "platform")}, ${plural(t.jobs, "job")} from ${plural(t.providers, "provider")}. Snapshot of ${catalog.snapshotDate}. Open a platform to see its jobs and the cheapest listed price of each.`,
    ),
    h("p", { id: "list-note", class: "list-note", hidden: true }),
  );
  const toc = h("ul", { class: "toc" });
  listEl.append(intro, h("nav", { "aria-label": "Jump to a category" }, toc));
  catalog.categories.forEach((c, ci) => {
    toc.append(h("li", {}, h("a", { href: `#cat-${c.id}` }, dot(ci), titles[ci])));
    const section = h(
      "section",
      { class: "list-cat", id: `cat-${c.id}` },
      h(
        "header",
        {},
        h("h3", {}, dot(ci), titles[ci]),
        h("p", {}, `${plural(c.platforms.length, "platform")} · ${plural(c.jobCount, "job")} · ${formatFrom(c.cheapestPerCall, c.cheapestPerResult)}`),
      ),
    );
    c.platforms.forEach((p, pi) => {
      const box = h("div", { class: "jobs-box" });
      const d = h(
        "details",
        { class: "list-platform" },
        h(
          "summary",
          {},
          h("span", { class: "platform-name" }, p.title),
          h("span", { class: "platform-jobs" }, plural(p.jobCount, "job")),
          h("span", { class: "platform-price" }, formatFrom(p.cheapestPerCall, p.cheapestPerResult)),
        ),
        box,
      );
      let mounted = false;
      d.addEventListener("toggle", () => {
        if (d.open && !mounted) {
          mounted = true;
          mountJobs(box, ci, pi, { filter: true, highlight: selCategory === ci && selPlatform === pi ? highlightJob : null });
        }
      });
      listDetails.set(`${ci}/${pi}`, d);
      section.append(d);
    });
    listEl.append(section);
  });
}

function openInList(): void {
  if (selCategory === null) return;
  const behavior: ScrollBehavior = reducedMotion() ? "auto" : "smooth";
  if (selPlatform === null) {
    document.getElementById(`cat-${catalog.categories[selCategory].id}`)?.scrollIntoView({ block: "start", behavior });
    return;
  }
  const d = listDetails.get(`${selCategory}/${selPlatform}`);
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ block: "start", behavior });
  d.querySelector("summary")?.focus({ preventScroll: true });
  if (highlightJob) {
    const row = d.querySelector(`[data-job="${CSS.escape(highlightJob)}"]`);
    row?.classList.add("is-hit");
  }
}

// ---------------------------------------------------------------------------------------------
// View switching

async function startScene(): Promise<void> {
  if (scene || webglFailed) return;
  if (!sceneLoading) {
    stageNote.textContent = "Loading the 3D map";
    stageNote.hidden = false;
    sceneLoading = import("./scene.ts")
      .then(({ createScene }) => {
        scene = createScene({
          stage,
          canvas,
          labels: $("labels"),
          ringHover: $("ring-hover"),
          ringSelected: $("ring-selected"),
          catalog,
          galaxy,
          titles,
          reducedMotion,
          onHover: showTooltip,
          onPick: (star) => {
            if (star === null) {
              if (selPlatform !== null) select(selCategory, null);
              return;
            }
            const s = galaxy.stars[star];
            select(s.categoryIndex, s.platformIndex);
          },
          onCategory: (ci) => select(ci, null),
        });
        scene.setSelection(selCategory, selCategory !== null && selPlatform !== null ? starOf[selCategory][selPlatform] : null);
      })
      .catch(() => {
        webglFailed = true;
        setView("list", "The 3D map could not start in this browser, so this is the list view. It has the same content.");
      })
      .finally(() => (stageNote.hidden = true));
  }
  await sceneLoading;
}

function setView(next: ViewMode, note = ""): void {
  view = next;
  root.dataset.view = next;
  toggle.setAttribute("aria-pressed", String(next === "list"));
  toggle.textContent = next === "list" ? "3D map" : "List view";
  toggle.disabled = next === "list" && webglFailed;
  if (next === "list") {
    buildList();
    stage.hidden = true;
    panel.hidden = true;
    root.dataset.panel = "closed";
    listEl.hidden = false;
    const noteEl = document.getElementById("list-note");
    if (noteEl) {
      noteEl.textContent = note;
      noteEl.hidden = note === "";
    }
    openInList();
  } else {
    listEl.hidden = true;
    stage.hidden = false;
    window.scrollTo(0, 0);
    renderPanel();
    void startScene().then(() => scene?.resize());
  }
}

toggle.addEventListener("click", () => setView(view === "list" ? "galaxy" : "list"));

// ---------------------------------------------------------------------------------------------
// Search

let jobIndex: JobIndexEntry[] | null = null;
let jobIndexState: "idle" | "loading" | "ready" | "partial" = "idle";
let hits: (PlatformHit | JobHit)[] = [];
let active = -1;

function ensureJobIndex(): void {
  if (jobIndexState !== "idle") return;
  jobIndexState = "loading";
  Promise.all(catalog.categories.map((_, ci) => loadJobs(ci).catch(() => null))).then((files) => {
    jobIndex = buildJobIndex(catalog, files);
    jobIndexState = files.some((f) => f === null) ? "partial" : "ready";
    if (searchInput.value.trim() !== "") renderResults();
  });
}

function closeResults(): void {
  resultsEl.hidden = true;
  searchInput.setAttribute("aria-expanded", "false");
  searchInput.removeAttribute("aria-activedescendant");
  active = -1;
}

function choose(hit: PlatformHit | JobHit): void {
  closeResults();
  searchInput.blur();
  select(hit.categoryIndex, hit.platformIndex, hit.kind === "job" ? hit.jobId : null);
}

function setActive(i: number): void {
  active = i;
  resultsEl.querySelectorAll<HTMLElement>("[role=option]").forEach((el, n) => {
    const on = n === i;
    el.setAttribute("aria-selected", String(on));
    if (on) {
      searchInput.setAttribute("aria-activedescendant", el.id);
      el.scrollIntoView({ block: "nearest" });
    }
  });
}

function renderResults(): void {
  const q = searchInput.value;
  if (q.trim() === "") {
    closeResults();
    return;
  }
  const platforms = searchPlatforms(catalog, q);
  const jobs = jobIndex ? searchJobs(jobIndex, q) : [];
  hits = [...platforms, ...jobs];
  resultsEl.replaceChildren();
  let n = 0;
  const option = (hit: PlatformHit | JobHit, main: string, sub: string): HTMLElement => {
    const el = h("div", { role: "option", id: `hit-${n}`, class: "result", "aria-selected": "false" }, dot(hit.categoryIndex), h("span", { class: "result-main" }, main), h("span", { class: "result-sub" }, sub));
    const i = n++;
    el.addEventListener("pointerdown", (e) => e.preventDefault());
    el.addEventListener("click", () => choose(hits[i]));
    el.addEventListener("pointermove", () => active !== i && setActive(i));
    return el;
  };
  if (platforms.length > 0) {
    resultsEl.append(h("p", { class: "results-head" }, "Platforms"));
    for (const p of platforms) {
      const platform = catalog.categories[p.categoryIndex].platforms[p.platformIndex];
      resultsEl.append(option(p, platform.title, `${titles[p.categoryIndex]} · ${plural(platform.jobCount, "job")}`));
    }
  }
  if (jobs.length > 0) {
    resultsEl.append(h("p", { class: "results-head" }, "Jobs"));
    for (const j of jobs) {
      resultsEl.append(option(j, j.title, `${catalog.categories[j.categoryIndex].platforms[j.platformIndex].title} · job:${j.jobId}`));
    }
  }
  if (jobIndexState === "loading") resultsEl.append(h("p", { class: "results-note" }, "Loading job titles"));
  else if (jobIndexState === "partial") resultsEl.append(h("p", { class: "results-note" }, "Some job lists did not load, so job results may be incomplete."));
  if (hits.length === 0 && jobIndexState !== "loading") {
    resultsEl.replaceChildren(h("p", { class: "results-note" }, `No platform or job matches "${q.trim()}". Try a platform name such as LinkedIn, or a task such as email.`));
  }
  resultsEl.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");
  active = -1;
  if (hits.length > 0) setActive(0);
}

searchInput.addEventListener("focus", () => {
  ensureJobIndex();
  if (searchInput.value.trim() !== "") renderResults();
});
searchInput.addEventListener("input", renderResults);
searchInput.addEventListener("blur", () => window.setTimeout(closeResults, 120));
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (hits.length === 0 || resultsEl.hidden) return;
    e.preventDefault();
    setActive((active + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
  } else if (e.key === "Enter") {
    if (!resultsEl.hidden && hits[active]) {
      e.preventDefault();
      choose(hits[active]);
    }
  } else if (e.key === "Escape") {
    e.stopPropagation();
    if (searchInput.value !== "") {
      searchInput.value = "";
      closeResults();
    } else {
      searchInput.blur();
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Keyboard and camera buttons

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  const typing = target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
  if (typing) return;
  if (e.key === "/") {
    e.preventDefault();
    searchInput.focus();
    return;
  }
  if (view !== "galaxy") return;
  if (e.key === "Escape") {
    stepBack();
    return;
  }
  // Leave arrow keys alone inside the scrolling panel.
  if (target !== null && panel.contains(target)) return;
  if (!scene) return;
  const step = 0.16;
  switch (e.key) {
    case "ArrowLeft": scene.rotate(-step, 0); break;
    case "ArrowRight": scene.rotate(step, 0); break;
    case "ArrowUp": scene.rotate(0, -step * 0.7); break;
    case "ArrowDown": scene.rotate(0, step * 0.7); break;
    case "+": case "=": scene.zoom(0.8); break;
    case "-": case "_": scene.zoom(1.25); break;
    case "0": select(null, null); scene.showAll(); break;
    default: return;
  }
  e.preventDefault();
});

$("zoom-in").addEventListener("click", () => scene?.zoom(0.75));
$("zoom-out").addEventListener("click", () => scene?.zoom(1.33));
$("zoom-reset").addEventListener("click", () => {
  select(null, null);
  scene?.showAll();
});

// ---------------------------------------------------------------------------------------------
// Start

const t = catalog.totals;
$("totals").textContent = `Snapshot ${catalog.snapshotDate} · ${plural(t.categories, "category", "categories")} · ${plural(t.platforms, "platform")} · ${plural(t.jobs, "job")} · ${plural(t.providers, "provider")}`;

buildLegend();
const fromHash = readHash();
selCategory = fromHash.category;
selPlatform = fromHash.platform;
syncLegend();

if (!hasWebGL()) {
  webglFailed = true;
  setView("list", "This browser has no WebGL, so this is the list view. It has the same content as the 3D map.");
} else if (reducedMotion()) {
  setView("list", "Your system asks for reduced motion, so this is the list view. The 3D map is one click away and moves only when you move it.");
} else {
  setView("galaxy");
}

window.addEventListener("hashchange", () => {
  const next = readHash();
  if (next.category !== selCategory || next.platform !== selPlatform) select(next.category, next.platform);
});
