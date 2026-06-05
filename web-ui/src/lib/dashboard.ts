/* Overview dashboard: the widget catalog, the built-in default layout (today's
   Overview, used when no `dashboard:` block is committed), localStorage drafts,
   and serialization of a layout back to the `dashboard:` YAML you commit. */
import type { WidgetSpec } from "./api";

// A placed widget plus a stable client id (for react-grid-layout keys + draft
// round-tripping). `id` is never serialized to YAML.
export type WidgetItem = WidgetSpec & { id: string };

export const GRID_COLS = 12;

// Catalog entry: what the "Add widget" picker shows. `metric` distinguishes the
// small data widgets (type "metric") from the built-in cards.
export interface CatalogEntry {
  key: string;            // unique catalog key
  type: string;           // widget type written to YAML
  metric?: string;        // for type "metric"
  label: string;
  desc: string;
  w: number;              // default size when added
  h: number;
  group: "Cards" | "Metrics";
}

export const CATALOG: CatalogEntry[] = [
  // Built-in cards (today's Overview widgets, now placeable)
  { key: "verdict", type: "verdict", label: "Status verdict", desc: "The big all-systems banner", w: 12, h: 3, group: "Cards" },
  { key: "metrics-summary", type: "metrics-summary", label: "Job counts", desc: "Passing / failing / running / stale / never", w: 12, h: 3, group: "Cards" },
  { key: "needs-attention", type: "needs-attention", label: "Needs attention", desc: "Failing & stale jobs", w: 7, h: 5, group: "Cards" },
  { key: "fleet-at-a-glance", type: "fleet-at-a-glance", label: "Fleet at a glance", desc: "Hosts, groups, jobs", w: 7, h: 4, group: "Cards" },
  { key: "server-resources", type: "server-resources", label: "Server resources", desc: "Host CPU / memory / disk", w: 5, h: 6, group: "Cards" },
  { key: "reconcile", type: "reconcile", label: "Reconcile", desc: "Last/next reconcile + drift", w: 5, h: 5, group: "Cards" },
  { key: "connected-repos", type: "connected-repos", label: "Connected repos", desc: "Linked Git repositories", w: 5, h: 5, group: "Cards" },
  { key: "upcoming-runs", type: "upcoming-runs", label: "Upcoming runs", desc: "Next scheduled jobs", w: 5, h: 8, group: "Cards" },
  // Catalog metrics (small cards from data Rudder already has)
  { key: "m-success-rate", type: "metric", metric: "success-rate", label: "Success rate", desc: "Overall job success %", w: 3, h: 3, group: "Metrics" },
  { key: "m-avg-duration", type: "metric", metric: "avg-run-duration", label: "Avg run duration", desc: "Mean last-run duration", w: 3, h: 3, group: "Metrics" },
  { key: "m-group-reach", type: "metric", metric: "group-reachability", label: "Reachability", desc: "Hosts reachable now", w: 3, h: 3, group: "Metrics" },
  { key: "m-queue-depth", type: "metric", metric: "queue-depth", label: "Running now", desc: "Jobs executing", w: 3, h: 3, group: "Metrics" },
  { key: "m-jobs-status", type: "metric", metric: "jobs-by-status", label: "Jobs by status", desc: "Mini status breakdown", w: 4, h: 3, group: "Metrics" },
  { key: "m-next-run", type: "metric", metric: "next-run", label: "Next run", desc: "Nearest upcoming job", w: 4, h: 3, group: "Metrics" },
  { key: "m-recent-activity", type: "metric", metric: "recent-activity", label: "Recent activity", desc: "Latest runs", w: 5, h: 6, group: "Metrics" },
];

// The built-in default layout — reproduces today's Overview exactly, so with no
// committed `dashboard:` block nothing is lost. Two columns: left 7, right 5.
const D = (type: string, x: number, y: number, w: number, h: number, metric?: string): WidgetSpec =>
  metric ? { type, metric, x, y, w, h } : { type, x, y, w, h };

export const DEFAULT_WIDGETS: WidgetSpec[] = [
  D("verdict", 0, 0, 12, 3),
  D("metrics-summary", 0, 3, 12, 3),
  D("needs-attention", 0, 6, 7, 5),
  D("fleet-at-a-glance", 0, 11, 7, 4),
  D("server-resources", 7, 6, 5, 6),
  D("reconcile", 7, 12, 5, 5),
  D("connected-repos", 7, 17, 5, 5),
  D("upcoming-runs", 7, 22, 5, 8),
];

let _seq = 0;
const uid = (): string => `w${Date.now().toString(36)}${(_seq++).toString(36)}`;

export const withIds = (specs: WidgetSpec[]): WidgetItem[] =>
  specs.map((s) => ({ ...s, id: uid() }));

export const stripIds = (items: WidgetItem[]): WidgetSpec[] =>
  // serialize in reading order (top→bottom, left→right) for stable YAML diffs
  [...items]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(({ type, metric, x, y, w, h }) => (metric ? { type, metric, x, y, w, h } : { type, x, y, w, h }));

export const addFromCatalog = (items: WidgetItem[], c: CatalogEntry): WidgetItem[] => {
  const y = items.reduce((m, it) => Math.max(m, it.y + it.h), 0); // append at the bottom
  return [...items, { id: uid(), type: c.type, metric: c.metric, x: 0, y, w: c.w, h: c.h }];
};

// ── YAML emit (small hand-written emitter; the shape is fixed and simple) ──
export function layoutToYaml(items: WidgetItem[], cols = GRID_COLS): string {
  const lines = ["dashboard:", `  cols: ${cols}`, "  widgets:"];
  for (const s of stripIds(items)) {
    const f = s.metric ? `type: ${s.type}, metric: ${s.metric}` : `type: ${s.type}`;
    lines.push(`    - { ${f}, x: ${s.x}, y: ${s.y}, w: ${s.w}, h: ${s.h} }`);
  }
  return lines.join("\n") + "\n";
}

// ── localStorage draft (per repo, so unrelated repos don't share a layout) ──
const draftKey = (repoId: string) => `rudder_dashboard_draft:${repoId || "default"}`;

export function loadDraft(repoId: string): WidgetItem[] | null {
  try {
    const raw = localStorage.getItem(draftKey(repoId));
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length ? (arr as WidgetItem[]) : null;
  } catch { return null; }
}
export function saveDraft(repoId: string, items: WidgetItem[]): void {
  try { localStorage.setItem(draftKey(repoId), JSON.stringify(items)); } catch { /* ignore */ }
}
export function clearDraft(repoId: string): void {
  try { localStorage.removeItem(draftKey(repoId)); } catch { /* ignore */ }
}

// Compare two layouts by their committed shape — used to decide whether the
// local draft actually differs from what's in Git. Both sides go through
// stripIds so the comparison is canonical: same sort order, same field set, and
// same key order (the server emits `metric` last, stripIds emits it second — so
// comparing raw JSON would mark any metric widget permanently "different").
export const sameLayout = (a: WidgetItem[], b: WidgetSpec[]): boolean =>
  JSON.stringify(stripIds(a)) === JSON.stringify(stripIds(b as WidgetItem[]));
