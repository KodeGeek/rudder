# Overview Dashboard Customization — Design

> Status: approved (2026-06-05). Lets users rearrange the Overview into a
> free-form resizable grid, add widgets from a built-in catalog, and persist the
> layout via GitOps (a `dashboard:` block in `rudder.yml`), with a browser draft
> + "Copy dashboard YAML" as the edit→commit bridge.

## Goals

1. **Move/resize widgets** on the Overview in a free-form grid (drag + resize).
2. **Add metrics as widgets** from a curated catalog built on data Rudder already
   has (no Prometheus dependency, offline-safe).
3. **Restore after a rebuild** with no manual step — the layout lives in Git and
   reconcile reads it.

## Decisions (locked with the user)

- **Persistence:** GitOps. The layout is a `dashboard:` block in `rudder.yml`,
  read on every reconcile. Git is the source of truth.
- **Metric source:** a built-in catalog (not custom PromQL).
- **Grid:** free-form resizable, built on `react-grid-layout` (MIT, bundled at
  build time → zero runtime CDN, stays offline-safe).
- **Edit→Git flow:** edits live in a **browser draft** (localStorage) so nothing
  is lost; a **"Copy dashboard YAML"** button generates the `dashboard:` block to
  paste into `rudder.yml` and commit. The UI never writes to Git.
- **The current Overview layout is the default.** With no `dashboard:` block,
  Overview renders exactly today's arrangement, and "Copy dashboard YAML" exports
  that current layout as the starting point to tweak.

## Schema — `dashboard:` in `rudder.yml`

Optional. Absent ⇒ the built-in default layout (today's Overview).

```yaml
dashboard:
  cols: 12                       # optional, default 12
  widgets:
    - { type: verdict,          x: 0, y: 0, w: 12, h: 2 }
    - { type: metrics-summary,  x: 0, y: 2, w: 8,  h: 2 }
    - { type: server-resources, x: 8, y: 2, w: 4,  h: 3 }
    - { type: metric, metric: success-rate, x: 0, y: 4, w: 4, h: 2 }
```

- `type` — widget kind (see catalog). `metric` is a generic kind whose `metric`
  field names a catalog metric.
- `x,y,w,h` — grid units (cols = 12 by default; row height fixed in the UI).
- Unknown `type`/`metric` values are **dropped with a warning**, never fatal.

## Widget catalog

**Built-in cards** (today's Overview widgets, now placeable):
`verdict`, `metrics-summary`, `needs-attention`, `fleet-at-a-glance`,
`server-resources`, `reconcile`, `connected-repos`, `upcoming-runs`.

**Catalog metrics** (new, all from data already in the UI / control-plane):
`success-rate`, `avg-run-duration`, `group-reachability`, `recent-activity`,
`queue-depth`, `jobs-by-status`, `next-run`.

Each catalog metric is a small card rendering a number/sparkline/list from
`useData()` (jobs, hosts, groups, reconcile, activity) — no new data source.

## Control-plane

- `store` already parses `rudder.yml` (for alert channels). Extend it to parse
  and **validate** `dashboard:` into a normalized layout object: clamp bounds,
  default `cols`, drop unknown widget types, coerce types. Pure function, unit
  tested.
- Expose `GET /dashboard` returning `{ cols, widgets: [...] }` (the committed
  layout) or `{ widgets: null }` when no `dashboard:` block exists (UI then uses
  its built-in default). Read-only; behind the same auth as other routes.
- Validation never raises — a malformed block yields the default + a logged
  warning, so a bad commit can't take down the Overview.

## Web-UI

- **Render:** `OverviewScreen` builds the grid from the served layout (or the
  built-in default). A `widgetRegistry` maps `type` → component; each existing
  card is refactored into a registry entry (no behavior change).
- **Edit mode:** an "Edit dashboard" toggle enables `react-grid-layout`
  drag/resize, an "Add widget" picker (the catalog), and per-widget hide/remove.
- **Draft:** edits write to a localStorage draft keyed per repo. A banner —
  "Local draft — not committed" — appears when the draft differs from the Git
  layout, with **Copy dashboard YAML** and **Reset**.
- **Export:** "Copy dashboard YAML" serializes the current grid to the
  `dashboard:` YAML block (clipboard).
- **Precedence:** Git layout is canonical; the local draft overlays only until
  committed. Load order: local draft → served Git layout → built-in default.

## Restore flow

After a rebuild there is nothing to restore: the `dashboard:` block is in Git, so
reconcile reads it and `GET /dashboard` serves it. Export-and-commit *is* the
durable save.

## Testing

- **pytest:** dashboard parse/validate — valid block round-trips; malformed YAML,
  unknown types, and out-of-bounds coords degrade to the default without raising.
- **web-ui:** `tsc --noEmit` + production build; a unit test for the
  layout ↔ YAML serialization round-trip.

## Out of scope (YAGNI)

- Custom PromQL widgets (catalog chosen).
- Per-user layouts / server-side write API (Export-YAML chosen).
- Resizing the fixed row height or multi-breakpoint responsive layouts.
