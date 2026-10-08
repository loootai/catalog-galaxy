// One colour per category, chosen to stay apart on a dark green background for the common
// forms of colour blindness (Okabe-Ito hues first, then lighter and darker steps). Colour is
// never the only cue: every cluster and row also carries its name.

const COLORS: Record<string, string> = {
  social: "#56B4E9",
  enrichment: "#2FD68F",
  search: "#F0E442",
  ads: "#E69F00",
  markets: "#CC79A7",
  scrapers: "#FF6B4A",
  apps: "#7FE3D4",
  other: "#A9B8B0",
  maps: "#B6E36B",
  research: "#8FA8FF",
  ecommerce: "#FFB3A1",
  genai: "#E3B5F2",
  reviews: "#FFD9A0",
  developer: "#4E9BC7",
  utilities: "#7CA890",
  "market-data": "#8C9A93",
};

const SPARE = ["#D9E5DF", "#C2D4A3", "#9CC9D9", "#E8C39E"];

export function categoryColor(id: string, index = 0): string {
  return COLORS[id] ?? SPARE[index % SPARE.length];
}

/**
 * Display names. The API can give two categories the same title; the second one gets its id
 * added so the two can be told apart.
 */
export function displayTitles(categories: { id: string; title: string }[]): string[] {
  const seen = new Map<string, number>();
  return categories.map((c) => {
    const n = seen.get(c.title) ?? 0;
    seen.set(c.title, n + 1);
    return n === 0 ? c.title : `${c.title} (${c.id})`;
  });
}
