/* Rudder — Overview dashboard (hero screen). "Is everything OK?" in 2 seconds.
   Widgets live in a registry and render into a free-form resizable grid. The
   layout is committed in rudder.yml (GitOps) and read on reconcile; an Edit mode
   lets you drag/resize/add, kept in a local draft, with "Copy dashboard YAML" as
   the commit bridge. With no committed layout, the built-in default reproduces
   today's arrangement exactly. */
import React from "react";
import RGL, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { Card, Btn, StatusDot, StatusPill, KindTag, Ring } from "../components/ui";
import { Icons } from "../components/icons";
import { EmptyState } from "../components/EmptyState";
import { relTime, cronHuman, bytes } from "../lib/format";
import { useData } from "../lib/data";
import { api, type HostStats } from "../lib/api";
import type { ConnectedRepo, Job, NavFn } from "../data/types";
import {
  CATALOG, DEFAULT_WIDGETS, GRID_COLS, withIds, addFromCatalog, layoutToYaml,
  loadDraft, saveDraft, clearDraft, sameLayout, type WidgetItem, type CatalogEntry,
} from "../lib/dashboard";

const Grid = WidthProvider(RGL);

const fmtDur = (s: number) =>
  s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`
  : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;

/* ──────────────────────────── widget context ──────────────────────────── */
interface Ctx {
  nav: NavFn;
  jobs: Job[];
  repos: ConnectedRepo[];
  hosts: ReturnType<typeof useData>["hosts"];
  groups: ReturnType<typeof useData>["groups"];
  reconcile: ReturnType<typeof useData>["reconcile"];
  counts: { ok: number; fail: number; running: number; stale: number; never: number };
  failures: Job[];
  upcoming: Job[];
  hostsUp: number;
}

/* ──────────────────────────── shared atoms ────────────────────────────── */
function ResBar({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  const c = pct >= 90 ? "var(--fail)" : pct >= 75 ? "var(--warn)" : "var(--ok)";
  return (
    <div style={{ padding: "11px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>{label}</span>
        <span className="mono" style={{ fontSize: "var(--fs-sm)", color: c, fontWeight: 600 }}>{pct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: "var(--surface-3)", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: c, borderRadius: 99, transition: "width .4s" }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{detail}</div>
    </div>
  );
}

function ServerResources() {
  const [s, setS] = React.useState<HostStats | null>(null);
  React.useEffect(() => {
    let on = true;
    const ctrl = new AbortController();
    const load = () => api.hostStats(ctrl.signal).then((d) => { if (on) setS(d); }).catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => { on = false; clearInterval(id); ctrl.abort(); };
  }, []);
  return (
    <Card pad={false} style={{ height: "100%" }}>
      <div style={{ padding: "14px 16px 12px", display: "flex", alignItems: "center", gap: 9 }}>
        <Icons.server size={15} style={{ color: "var(--text-3)" }} />
        <span style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>Server resources</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>{s?.source || "host"}</span>
      </div>
      <div style={{ borderTop: "1px solid var(--line-soft)", paddingBottom: 6 }}>
        {!s ? <div style={{ padding: "16px", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>Loading…</div>
          : s.error ? <div style={{ padding: "16px", fontSize: "var(--fs-sm)", color: "var(--warn)" }}>Unavailable: {s.error}</div>
          : <>
              <ResBar label="CPU" pct={s.cpu ?? 0} detail={`${s.cpu ?? 0}% busy`} />
              <ResBar label="Memory" pct={s.mem?.pct ?? 0} detail={`${bytes(s.mem?.used)} / ${bytes(s.mem?.total)} used`} />
              <ResBar label="Disk" pct={s.disk?.pct ?? 0} detail={`${bytes(s.disk?.used)} / ${bytes(s.disk?.total)} used`} />
            </>}
      </div>
    </Card>
  );
}

function Metric({ k, label, color, onClick }:
  { k: React.ReactNode; label: string; color: string; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      style={{ flex: 1, textAlign: "left", background: "var(--surface)", border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)", padding: "15px 16px", cursor: onClick ? "pointer" : "default",
        position: "relative", overflow: "hidden", height: "100%" }}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color }} />
      <span className="mono" style={{ fontSize: 30, fontWeight: 600, color: "var(--text)", letterSpacing: "-.02em", lineHeight: 1 }}>{k}</span>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)", marginTop: 7, fontWeight: 500 }}>{label}</div>
    </button>
  );
}

function Verdict({ jobs, nav }: { jobs: Job[]; nav: NavFn }) {
  const failing = jobs.filter((j) => j.status === "fail");
  const stale = jobs.filter((j) => j.status === "stale");
  const noJobs = jobs.length === 0;
  const allGood = !noJobs && failing.length === 0 && stale.length === 0;
  const c = noJobs ? "var(--idle)" : allGood ? "var(--ok)" : "var(--fail)";
  const dimc = noJobs ? "var(--idle-dim)" : allGood ? "var(--ok-dim)" : "var(--fail-dim)";
  return (
    <Card style={{ padding: 0, overflow: "hidden", height: "100%", borderColor: !noJobs && !allGood ? "var(--fail)" : "var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "20px 22px", position: "relative", height: "100%", boxSizing: "border-box" }}>
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(100deg, ${dimc}, transparent 55%)`, opacity: 0.8, pointerEvents: "none" }} />
        <div style={{ position: "relative", width: 46, height: 46, borderRadius: 13, background: dimc, display: "grid", placeItems: "center", color: c, flexShrink: 0 }}>
          {allGood ? <Icons.check size={26} sw={2.2} /> : noJobs ? <Icons.clock size={24} sw={2} /> : <Icons.alert size={24} sw={2} />}
        </div>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 660, letterSpacing: "-.02em", color: "var(--text)", lineHeight: 1.1 }}>
            {noJobs ? "Awaiting first reconcile" : allGood ? "All systems nominal" : `${failing.length} job${failing.length > 1 ? "s" : ""} failing`}
          </div>
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)", marginTop: 5 }}>
            {noJobs
              ? "Repository connected — the control-plane will render its jobs on the next pull."
              : allGood
                ? `${jobs.length} scheduled jobs · last reconcile passed`
                : <>Needs attention: {failing.map((f) => f.name).join(", ")}{stale.length ? ` · ${stale.length} stale` : ""}</>}
          </div>
        </div>
        {!allGood && !noJobs && <Btn kind="primary" iconR={Icons.chevR} onClick={() => nav("activity", { filter: "failed" })}>What broke</Btn>}
      </div>
    </Card>
  );
}

function FailureRow({ j, nav }: { j: Job; nav: NavFn }) {
  const last = j.runs.find((r) => r.status === "failed") || j.runs[0];
  return (
    <button onClick={() => nav("job", { name: j.name })}
      style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 13, alignItems: "center", width: "100%", textAlign: "left",
        padding: "12px 14px", background: "transparent", border: "none", borderTop: "1px solid var(--line-soft)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
      <StatusDot s={j.status} size={9} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.name}</span>
          <KindTag kind={j.kind} />
        </div>
        <div className="mono" style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {last?.host} · exit {last?.exit ?? "—"} · {j.limit}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>{relTime(j.lastRun)}</div>
        <Icons.chevR size={14} style={{ color: "var(--text-faint)", marginTop: 2 }} />
      </div>
    </button>
  );
}

function NextRunRow({ j, nav }: { j: Job; nav: NavFn }) {
  return (
    <button onClick={() => nav("job", { name: j.name })}
      style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 11, alignItems: "center", width: "100%", textAlign: "left",
        padding: "9px 4px", background: "transparent", border: "none" }}>
      <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)", width: 52 }}>{relTime(j.nextRun).replace("in ", "")}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.name}</div>
        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{cronHuman(j.cron)}</div>
      </div>
      <StatusDot s={j.status} size={7} />
    </button>
  );
}

function RepoCard({ repo }: { repo: ConnectedRepo }) {
  return (
    <div style={{ padding: "13px 14px", borderRadius: "var(--r-md)", border: "1px solid var(--line-soft)", background: "var(--surface-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {repo.provider === "ado" ? <Icons.azure size={15} style={{ color: "var(--text-2)" }} /> : <Icons.github size={15} style={{ color: "var(--text-2)" }} />}
        <span className="mono" style={{ fontSize: 12, color: "var(--text)", fontWeight: 550, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{repo.slug}</span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--ok)" }}>
          <StatusDot s="ok" size={6} /> connected
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9, color: "var(--text-3)" }}>
        <Icons.branch size={13} /><span className="mono" style={{ fontSize: 11.5 }}>{repo.branch}</span>
        <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 4 }}>added {relTime(repo.addedAt)}</span>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: React.ReactNode; v: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-3)", whiteSpace: "nowrap" }}>{k}</span>
      <span className={mono ? "mono" : ""} style={{ fontSize: mono ? 12 : "var(--fs-sm)", color: "var(--text)", fontWeight: 500, whiteSpace: "nowrap" }}>{v}</span>
    </div>
  );
}

/* ──────────────────────── extracted built-in cards ────────────────────── */
function CardShell({ title, icon, right, children }:
  { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card pad={false} style={{ height: "100%" }}>
      <div style={{ padding: "14px 16px 12px", display: "flex", alignItems: "center", gap: 9 }}>
        {icon}
        <span style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>{title}</span>
        <span style={{ flex: 1 }} />
        {right}
      </div>
      <div style={{ borderTop: "1px solid var(--line-soft)" }}>{children}</div>
    </Card>
  );
}

function MetricsSummary({ c, nav }: { c: Ctx["counts"]; nav: NavFn }) {
  return (
    <div style={{ display: "flex", gap: "var(--gap)", height: "100%" }}>
      <Metric k={c.ok} label="Passing" color="var(--ok)" />
      <Metric k={c.fail} label="Failing" color="var(--fail)" onClick={() => nav("jobs", { f: "fail" })} />
      <Metric k={c.running} label="Running now" color="var(--warn)" />
      <Metric k={c.stale} label="Stale" color="var(--warn)" />
      <Metric k={`${c.never}`} label="Never run" color="var(--idle)" />
    </div>
  );
}

function NeedsAttention({ failures, nav }: { failures: Job[]; nav: NavFn }) {
  return (
    <Card pad={false} style={{ height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 13px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Icons.alert size={15} style={{ color: "var(--fail)" }} />
          <span style={{ fontSize: "var(--fs-md)", fontWeight: 600, whiteSpace: "nowrap" }}>Needs attention</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)", padding: "1px 7px", borderRadius: 99, background: "var(--surface-3)" }}>{failures.length}</span>
        </div>
        <Btn size="sm" kind="bare" iconR={Icons.chevR} onClick={() => nav("activity", { filter: "failed" })}>Activity feed</Btn>
      </div>
      {failures.length ? failures.map((j) => <FailureRow key={j.name} j={j} nav={nav} />)
        : <div style={{ padding: "22px 16px 26px", color: "var(--text-3)", fontSize: "var(--fs-sm)", display: "flex", gap: 9, alignItems: "center", borderTop: "1px solid var(--line-soft)" }}><Icons.check size={16} style={{ color: "var(--ok)" }} /> Nothing failing right now.</div>}
    </Card>
  );
}

function FleetGlance({ ctx }: { ctx: Ctx }) {
  const { hosts, groups, jobs, hostsUp, nav } = ctx;
  return (
    <Card pad={false} style={{ height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 12px" }}>
        <span style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>Fleet at a glance</span>
        <Btn size="sm" kind="bare" iconR={Icons.chevR} onClick={() => nav("inventory")}>Inventory</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderTop: "1px solid var(--line-soft)" }}>
        {[
          { k: hosts.length ? `${hostsUp}/${hosts.length}` : "0", l: "hosts reachable", c: hostsUp === hosts.length ? "var(--ok)" : "var(--warn)" },
          { k: groups.length, l: "inventory groups", c: "var(--text)" },
          { k: jobs.length, l: "scheduled jobs", c: "var(--text)" },
        ].map((x, i) => (
          <div key={i} style={{ padding: "16px", borderRight: i < 2 ? "1px solid var(--line-soft)" : "none" }}>
            <div className="mono" style={{ fontSize: 22, fontWeight: 600, color: x.c }}>{x.k}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{x.l}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ReconcileCard({ reconcile }: { reconcile: Ctx["reconcile"] }) {
  return (
    <CardShell title="Reconcile" icon={<Icons.refresh size={15} style={{ color: "var(--accent-text)" }} />}
      right={<StatusPill s="ok" size="sm">In sync</StatusPill>}>
      <div style={{ padding: "13px 16px", display: "grid", gap: 9 }}>
        <Row k="Last reconcile" v={relTime(reconcile?.lastAt)} mono />
        <Row k="Next reconcile" v={relTime(reconcile?.nextAt)} mono />
        <Row k="Interval" v={`every ${reconcile?.intervalMin ?? "—"}m`} mono />
        <Row k="Config drift" v={<span style={{ color: "var(--ok)" }}>none</span>} />
      </div>
    </CardShell>
  );
}

function ConnectedRepos({ repos, nav }: { repos: ConnectedRepo[]; nav: NavFn }) {
  return (
    <Card pad={false} style={{ height: "100%" }}>
      <div style={{ padding: "14px 16px 12px", fontSize: "var(--fs-md)", fontWeight: 600 }}>Connected repos</div>
      <div style={{ borderTop: "1px solid var(--line-soft)", padding: "12px 14px", display: "grid", gap: 9 }}>
        {repos.map((r) => <RepoCard key={r.id} repo={r} />)}
        <Btn size="sm" kind="ghost" icon={Icons.settings} full onClick={() => nav("settings")}>Manage connections</Btn>
      </div>
    </Card>
  );
}

function UpcomingRuns({ upcoming, nav }: { upcoming: Job[]; nav: NavFn }) {
  return (
    <Card pad={false} style={{ height: "100%" }}>
      <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: 9 }}>
        <Icons.clock size={15} style={{ color: "var(--text-3)" }} />
        <span style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>Upcoming runs</span>
      </div>
      <div style={{ borderTop: "1px solid var(--line-soft)", padding: "6px 12px 12px" }}>
        {upcoming.length ? upcoming.map((j) => <NextRunRow key={j.name} j={j} nav={nav} />)
          : <div style={{ padding: "14px 4px", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>No upcoming runs.</div>}
      </div>
    </Card>
  );
}

/* ──────────────────────────── catalog metrics ─────────────────────────── */
function StatCard({ title, value, sub, color, children }:
  { title: string; value?: React.ReactNode; sub?: React.ReactNode; color?: string; children?: React.ReactNode }) {
  return (
    <Card pad={false} style={{ height: "100%" }}>
      <div style={{ padding: "13px 16px 0", fontSize: "var(--fs-xs)", color: "var(--text-3)", fontWeight: 500 }}>{title}</div>
      <div style={{ padding: "8px 16px 16px" }}>
        {value !== undefined && (
          <div className="mono" style={{ fontSize: 28, fontWeight: 600, color: color || "var(--text)", letterSpacing: "-.02em", lineHeight: 1.1 }}>{value}</div>
        )}
        {sub && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 5 }}>{sub}</div>}
        {children}
      </div>
    </Card>
  );
}

function MetricWidget({ metric, ctx }: { metric: string; ctx: Ctx }) {
  const { jobs, hosts, counts, hostsUp, upcoming, nav } = ctx;
  const data = useData();                          // hook at top — not conditional
  switch (metric) {
    case "success-rate": {
      const rates = jobs.map((j) => j.successRate).filter((r): r is number => r != null);
      const avg = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
      return (
        <StatCard title="Success rate">
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 2 }}>
            <Ring pct={avg} size={48} sw={5} />
            <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{rates.length} jobs with history</div>
          </div>
        </StatCard>
      );
    }
    case "avg-run-duration": {
      const durs = jobs.map((j) => j.duration).filter((d): d is number => d != null && d > 0);
      const avg = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null;
      return <StatCard title="Avg run duration" value={avg == null ? "—" : fmtDur(avg)} sub={`${durs.length} timed runs`} />;
    }
    case "group-reachability": {
      const c = hosts.length && hostsUp === hosts.length ? "var(--ok)" : "var(--warn)";
      return <StatCard title="Reachability" value={hosts.length ? `${hostsUp}/${hosts.length}` : "0"} sub="hosts reachable now" color={c} />;
    }
    case "queue-depth":
      return <StatCard title="Running now" value={counts.running} sub="jobs executing" color={counts.running ? "var(--warn)" : "var(--text)"} />;
    case "jobs-by-status":
      return (
        <StatCard title="Jobs by status">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 4 }}>
            {([["ok", "var(--ok)", counts.ok], ["fail", "var(--fail)", counts.fail], ["running", "var(--warn)", counts.running], ["stale", "var(--warn)", counts.stale], ["never", "var(--idle)", counts.never]] as const)
              .map(([label, col, n]) => (
                <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                  <StatusDot s={label} size={7} /><span className="mono" style={{ color: "var(--text)", fontWeight: 600 }}>{n}</span>
                  <span style={{ color: "var(--text-faint)" }}>{label}</span>
                </span>
              ))}
          </div>
        </StatCard>
      );
    case "next-run": {
      const j = upcoming[0];
      return (
        <StatCard title="Next run" value={j ? relTime(j.nextRun).replace("in ", "") : "—"}
          sub={j ? <button onClick={() => nav("job", { name: j.name })} style={{ background: "none", border: "none", padding: 0, color: "var(--text-2)", cursor: "pointer", fontSize: 11.5 }}>{j.name}</button> : "no scheduled runs"} />
      );
    }
    case "recent-activity": {
      const items = data.activity.slice(0, 7);
      return (
        <Card pad={false} style={{ height: "100%" }}>
          <div style={{ padding: "13px 16px 10px", display: "flex", alignItems: "center", gap: 9 }}>
            <Icons.activity size={15} style={{ color: "var(--text-3)" }} />
            <span style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>Recent activity</span>
          </div>
          <div style={{ borderTop: "1px solid var(--line-soft)", padding: "6px 12px 12px" }}>
            {items.length ? items.map((a, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", padding: "7px 4px" }}>
                <StatusDot s={a.status} size={7} />
                <span style={{ fontSize: "var(--fs-sm)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.job}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>{relTime(a.at)}</span>
              </div>
            )) : <div style={{ padding: "14px 4px", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>No recent runs.</div>}
          </div>
        </Card>
      );
    }
    default:
      return <StatCard title={metric} value="—" sub="unknown metric" />;
  }
}

/* ──────────────────────────── widget registry ─────────────────────────── */
// Maps a committed widget type → render fn. Unknown types are skipped, so a bad
// commit can't crash Overview (and backend/frontend don't duplicate the list).
const REGISTRY: Record<string, (w: WidgetItem, ctx: Ctx) => React.ReactNode> = {
  "verdict": (_w, c) => <Verdict jobs={c.jobs} nav={c.nav} />,
  "metrics-summary": (_w, c) => <MetricsSummary c={c.counts} nav={c.nav} />,
  "needs-attention": (_w, c) => <NeedsAttention failures={c.failures} nav={c.nav} />,
  "fleet-at-a-glance": (_w, c) => <FleetGlance ctx={c} />,
  "server-resources": () => <ServerResources />,
  "reconcile": (_w, c) => <ReconcileCard reconcile={c.reconcile} />,
  "connected-repos": (_w, c) => <ConnectedRepos repos={c.repos} nav={c.nav} />,
  "upcoming-runs": (_w, c) => <UpcomingRuns upcoming={c.upcoming} nav={c.nav} />,
  "metric": (w, c) => <MetricWidget metric={w.metric || ""} ctx={c} />,
};
const known = (w: WidgetItem) => REGISTRY[w.type] !== undefined;

/* ──────────────────────────── edit-mode chrome ────────────────────────── */
const GRID_CSS = `
.rdash .react-grid-item.react-grid-placeholder { background: var(--accent); opacity: .18; border-radius: var(--r-lg); }
.rdash .react-grid-item.resizing, .rdash .react-grid-item.react-draggable-dragging { z-index: 6; transition: none; }
.rdash-cell { height: 100%; }
/* Scroll INSIDE each card (not the cell body) so the card's rounded border
   stays pinned to the cell edge and can't float into the middle mid-scroll. */
.rdash-body { height: 100%; overflow: hidden; }
.rdash-body > * { height: 100%; box-sizing: border-box; overflow: auto; }
/* In edit mode clip overflow so a card scrollbar can't sit on top of the
   bottom-right resize handle and steal the grab. */
.rdash--edit .rdash-body > * { overflow: hidden; }
.rdash-handle { position: absolute; inset: 0 0 auto 0; height: 26px; display: flex; align-items: center; gap: 7px;
  padding: 0 8px; background: var(--accent-soft); border-bottom: 1px solid var(--line-soft);
  border-radius: var(--r-lg) var(--r-lg) 0 0; cursor: move; z-index: 3; font-size: 11px; color: var(--accent-text); }
.rdash--edit .react-grid-item { outline: 1px dashed var(--line); outline-offset: -1px; border-radius: var(--r-lg); }
/* Bigger, clearly visible resize grip on top of everything while editing. */
.rdash--edit .react-resizable-handle { width: 26px; height: 26px; z-index: 5; padding: 0; }
.rdash--edit .react-resizable-handle::after { width: 9px; height: 9px; right: 5px; bottom: 5px;
  border-right: 2px solid var(--accent-text); border-bottom: 2px solid var(--accent-text); }
`;

function AddPicker({ onPick, onClose }: { onPick: (c: CatalogEntry) => void; onClose: () => void }) {
  const groups = ["Cards", "Metrics"] as const;
  return (
    <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, width: 320, maxHeight: 420, overflow: "auto",
      background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-2)", padding: 8 }}
      onMouseLeave={onClose}>
      {groups.map((g) => (
        <div key={g}>
          <div style={{ fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-faint)", padding: "8px 8px 4px" }}>{g}</div>
          {CATALOG.filter((c) => c.group === g).map((c) => (
            <button key={c.key} onClick={() => onPick(c)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 9px", background: "transparent", border: "none",
                borderRadius: "var(--r-md)", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <div style={{ fontSize: "var(--fs-sm)", color: "var(--text)", fontWeight: 550 }}>{c.label}</div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{c.desc}</div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────── the screen ──────────────────────────────── */
export function OverviewScreen({ nav }: { nav: NavFn }) {
  const data = useData();
  const { repos, jobs, reconcile, hosts, groups } = data;
  const repoId = repos[0]?.id || "default";

  const [items, setItems] = React.useState<WidgetItem[]>(() => withIds(DEFAULT_WIDGETS));
  const [git, setGit] = React.useState<{ cols: number; widgets: typeof DEFAULT_WIDGETS | null } | null>(null);
  const [edit, setEdit] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [yamlOpen, setYamlOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  // Load committed layout (Git) + any local draft. Draft wins until committed.
  React.useEffect(() => {
    let on = true;
    const apply = (g: { cols: number; widgets: typeof DEFAULT_WIDGETS | null } | null) => {
      if (!on) return;
      setGit(g);
      const base = g?.widgets && g.widgets.length ? g.widgets : DEFAULT_WIDGETS;
      const draft = loadDraft(repoId);
      setItems(draft ?? withIds(base));
    };
    api.dashboard().then((g) => apply({ cols: g.cols, widgets: g.widgets })).catch(() => apply(null));
    return () => { on = false; };
  }, [repoId]);

  const baseline = git?.widgets && git.widgets.length ? git.widgets : DEFAULT_WIDGETS;
  const cols = git?.cols || GRID_COLS;
  const dirty = items.length > 0 && !sameLayout(items, baseline);

  const onLayoutChange = (l: Layout[]) => {
    if (!edit) return;                              // ignore RGL's initial/mount calls
    setItems((prev) => {
      const m = new Map(l.map((x) => [x.i, x]));
      const next = prev.map((it) => {
        const g = m.get(it.id);
        return g ? { ...it, x: g.x, y: g.y, w: g.w, h: g.h } : it;
      });
      sameLayout(next, baseline) ? clearDraft(repoId) : saveDraft(repoId, next);
      return next;
    });
  };

  const add = (c: CatalogEntry) => {
    setItems((prev) => { const next = addFromCatalog(prev, c); saveDraft(repoId, next); return next; });
    setPicking(false);
  };
  const remove = (id: string) =>
    setItems((prev) => { const next = prev.filter((it) => it.id !== id); sameLayout(next, baseline) ? clearDraft(repoId) : saveDraft(repoId, next); return next; });
  const reset = () => { clearDraft(repoId); setItems(withIds(baseline)); };
  // Copy works in a secure context (clipboard API) and falls back to selecting
  // the textarea + execCommand for plain-HTTP self-hosted installs. The modal
  // always shows the YAML, so worst case you select it by hand.
  const doCopy = async () => {
    const text = layoutToYaml(items, cols);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopied(true); setTimeout(() => setCopied(false), 1800); return;
      }
    } catch { /* fall through */ }
    const ta = taRef.current;
    if (ta) {
      ta.focus(); ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* manual select */ }
    }
  };

  if (data.loading && repos.length === 0 && jobs.length === 0) {
    return <EmptyState icon={Icons.refresh} title="Loading…" body="Fetching state from the control-plane." />;
  }
  if (repos.length === 0) {
    return (
      <EmptyState icon={Icons.git} title="Connect your first repository"
        body={<>Rudder reads your job manifest from a Git repo (GitHub or Azure DevOps) and runs it on a schedule. Connect a repo to get started.{data.info?.bundledRepoUrl ? <> The bundled demo repo is <span className="mono" style={{ color: "var(--text-2)" }}>{data.info.bundledRepoUrl}</span>.</> : null}</>}
        actionLabel="Connect a repository" onAction={() => nav("connect")} />
    );
  }

  const counts = {
    ok: jobs.filter((j) => j.status === "ok").length,
    fail: jobs.filter((j) => j.status === "fail").length,
    running: jobs.filter((j) => j.status === "running").length,
    stale: jobs.filter((j) => j.status === "stale").length,
    never: jobs.filter((j) => j.status === "never").length,
  };
  const ctx: Ctx = {
    nav, jobs, repos, hosts, groups, reconcile, counts,
    failures: jobs.filter((j) => j.status === "fail" || j.status === "stale"),
    upcoming: jobs.filter((j) => j.nextRun).sort((a, b) => (a.nextRun || 0) - (b.nextRun || 0)).slice(0, 6),
    hostsUp: hosts.filter((h) => h.up).length,
  };

  const visible = items.filter(known);
  const layout: Layout[] = visible.map((it) => ({ i: it.id, x: it.x, y: it.y, w: it.w, h: it.h }));

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "20px 30px 60px", animation: "screen-in .35s cubic-bezier(.2,.7,.2,1) both" }}>
      <style>{GRID_CSS}</style>

      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, position: "relative" }}>
        {dirty && !edit && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "var(--fs-xs)", color: "var(--warn)" }}>
            <Icons.drift size={14} /> Local draft — not committed
            <Btn size="sm" kind="bare" icon={Icons.copy} onClick={() => { setYamlOpen(true); setCopied(false); }}>Copy YAML</Btn>
            <Btn size="sm" kind="bare" onClick={reset} title="Discard local changes and revert to the committed layout">Discard</Btn>
          </span>
        )}
        <span style={{ flex: 1 }} />
        {edit ? (
          <>
            <div style={{ position: "relative" }}>
              <Btn size="sm" kind="ghost" icon={Icons.plus} onClick={() => setPicking((p) => !p)}>Add widget</Btn>
              {picking && <AddPicker onPick={add} onClose={() => setPicking(false)} />}
            </div>
            <Btn size="sm" kind="ghost" icon={Icons.copy} onClick={() => { setYamlOpen(true); setCopied(false); }}>Copy dashboard YAML</Btn>
            <Btn size="sm" kind="bare" onClick={reset} disabled={!dirty} title="Discard local changes">Reset</Btn>
            <Btn size="sm" kind="primary" icon={Icons.check} onClick={() => { setEdit(false); setPicking(false); }}>Done</Btn>
          </>
        ) : (
          <Btn size="sm" kind="ghost" icon={Icons.grid} onClick={() => setEdit(true)}>Edit dashboard</Btn>
        )}
      </div>

      <Grid className={`rdash${edit ? " rdash--edit" : ""}`} layout={layout} cols={cols} rowHeight={26}
        margin={[16, 16]} containerPadding={[0, 0]} isDraggable={edit} isResizable={edit}
        draggableHandle=".rdash-handle" draggableCancel=".rdash-no-drag" compactType="vertical" onLayoutChange={onLayoutChange}>
        {visible.map((it) => (
          <div key={it.id} className="rdash-cell">
            {edit && (
              <div className="rdash-handle">
                <Icons.grid size={12} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(CATALOG.find((c) => c.type === it.type && c.metric === it.metric)?.label) || it.metric || it.type}
                </span>
                <button className="rdash-no-drag" title="Remove widget" aria-label="Remove widget"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); remove(it.id); }}
                  style={{ display: "grid", placeItems: "center", width: 24, height: 24, border: "none", borderRadius: 6,
                    background: "transparent", color: "var(--text-2)", cursor: "pointer", marginRight: -2, flexShrink: 0 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--fail-dim)"; e.currentTarget.style.color = "var(--fail)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-2)"; }}>
                  <Icons.x size={15} sw={2.2} />
                </button>
              </div>
            )}
            <div className="rdash-body" style={{ pointerEvents: edit ? "none" : "auto", paddingTop: edit ? 26 : 0 }}>
              {REGISTRY[it.type](it, ctx)}
            </div>
          </div>
        ))}
      </Grid>

      {yamlOpen && (
        <div onClick={() => setYamlOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.55)", display: "grid", placeItems: "center", padding: 24 }}>
          <Card onClick={() => {}} style={{ width: 560, maxWidth: "100%" }}>
            <div onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
                <Icons.doc size={16} style={{ color: "var(--text-3)" }} />
                <span style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>Commit this to <span className="mono">rudder.yml</span></span>
                <span style={{ flex: 1 }} />
                <button onClick={() => setYamlOpen(false)} aria-label="Close dialog" style={{ display: "grid", placeItems: "center", width: 24, height: 24, border: "none", borderRadius: 6, background: "transparent", color: "var(--text-3)", cursor: "pointer" }}><Icons.x size={15} /></button>
              </div>
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)", marginBottom: 10 }}>
                Paste this <span className="mono">dashboard:</span> block into your repo's <span className="mono">rudder.yml</span> and commit — reconcile reads it, so your layout survives any rebuild.
              </div>
              <textarea ref={taRef} readOnly value={layoutToYaml(items, cols)}
                onFocus={(e) => e.currentTarget.select()}
                style={{ width: "100%", height: 240, resize: "vertical", boxSizing: "border-box", padding: "10px 12px",
                  background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: "var(--r-md)",
                  fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12, lineHeight: 1.5 }} />
              <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                <Btn size="sm" kind="bare" onClick={() => setYamlOpen(false)}>Close</Btn>
                <Btn size="sm" kind="primary" icon={Icons.copy} onClick={doCopy}>{copied ? "Copied!" : "Copy to clipboard"}</Btn>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
