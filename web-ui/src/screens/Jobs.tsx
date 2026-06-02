/* Rudder — Jobs list (filterable table) */
import React from "react";
import { Card, Btn, IconBtn, StatusDot, Sparkline, Ring, KindTag } from "../components/ui";
import { Icons } from "../components/icons";
import { EmptyState } from "../components/EmptyState";
import { relTime, dur, cronHuman } from "../lib/format";
import { useData } from "../lib/data";
import type { Job, NavFn } from "../data/types";

const FILTERS = [
  { k: "all", label: "All" },
  { k: "fail", label: "Failing" },
  { k: "ok", label: "Passing" },
  { k: "running", label: "Running" },
  { k: "stale", label: "Stale" },
  { k: "never", label: "No data" },
];

function Seg({ value, onChange, options, counts }:
  { value: string; onChange: (k: string) => void; options: { k: string; label: string }[]; counts: Record<string, number> }) {
  return (
    <div style={{ display: "inline-flex", padding: 3, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", gap: 2 }}>
      {options.map((o) => {
        const active = value === o.k;
        return (
          <button key={o.k} onClick={() => onChange(o.k)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 6, border: "none",
              background: active ? "var(--surface-3)" : "transparent", color: active ? "var(--text)" : "var(--text-3)",
              fontSize: "var(--fs-xs)", fontWeight: active ? 600 : 500, transition: "all .12s" }}>
            {o.label}
            {counts[o.k] != null && <span className="mono" style={{ fontSize: 10.5, color: active ? "var(--text-2)" : "var(--text-faint)" }}>{counts[o.k]}</span>}
          </button>
        );
      })}
    </div>
  );
}

function JobRow({ j, nav, onRun }: { j: Job; nav: NavFn; onRun: (name: string) => void }) {
  const [h, setH] = React.useState(false);
  return (
    <div onClick={() => nav("job", { name: j.name })}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "grid", gridTemplateColumns: "20px 2.4fr 1.6fr 1fr 0.9fr 132px 88px", gap: 16, alignItems: "center",
        padding: "0 18px", height: "var(--row-h)", background: h ? "var(--surface-2)" : "transparent", cursor: "pointer",
        borderBottom: "1px solid var(--line-soft)", transition: "background .1s" }}>
      <StatusDot s={j.status} size={9} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.name}</span>
          <KindTag kind={j.kind} />
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.playbook}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>{cronHuman(j.cron)}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{j.cron}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {j.provider === "ado" ? <Icons.azure size={13} style={{ color: "var(--text-faint)", flexShrink: 0 }} /> : <Icons.github size={13} style={{ color: "var(--text-faint)", flexShrink: 0 }} />}
        <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.limit}</span>
      </div>
      <div>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>{relTime(j.lastRun)}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{dur(j.duration)}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Sparkline data={j.spark} w={92} h={26} />
        <Ring pct={j.successRate} size={30} sw={3.5} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }} onClick={(e) => e.stopPropagation()}>
        {h && j.status !== "running" && <IconBtn icon={Icons.play} size={28} title="Run now" onClick={() => onRun(j.name)} />}
        <IconBtn icon={Icons.chevR} size={28} title="Open" onClick={() => nav("job", { name: j.name })} />
      </div>
    </div>
  );
}

export function JobsScreen({ nav, initialFilter }: { nav: NavFn; initialFilter?: string }) {
  const { jobs, repos, runJob, loading } = useData();
  const [filter, setFilter] = React.useState(initialFilter || "all");
  const [q, setQ] = React.useState("");
  const [prov, setProv] = React.useState("all");

  if (!loading && repos.length === 0) {
    return <EmptyState icon={Icons.jobs} title="No jobs yet"
      body="Jobs are rendered from a connected repository's manifest. Connect one to get started."
      actionLabel="Connect a repository" onAction={() => nav("connect")} />;
  }

  const counts: Record<string, number> = { all: jobs.length };
  FILTERS.forEach((f) => { if (f.k !== "all") counts[f.k] = jobs.filter((j) => j.status === f.k).length; });

  const rows = jobs.filter((j) => {
    if (filter !== "all" && j.status !== filter) return false;
    if (prov !== "all" && j.provider !== prov) return false;
    if (q && !(`${j.name} ${j.playbook} ${j.limit}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "22px 30px 60px", animation: "screen-in .35s cubic-bezier(.2,.7,.2,1) both" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--fs-xl)", fontWeight: 660, letterSpacing: "-.01em" }}>Jobs</h1>
          <p style={{ margin: "4px 0 0", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>{jobs.length} scheduled jobs across {repos.length} repo{repos.length === 1 ? "" : "s"} · rendered from the manifest</p>
        </div>
        <Btn kind="solid" icon={Icons.doc} onClick={() => nav("manifest")}>View manifest</Btn>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
        <Seg value={filter} onChange={setFilter} options={FILTERS} counts={counts} />
        <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
          <div style={{ position: "relative" }}>
            <Icons.search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter jobs…" className="focusable"
              style={{ height: 34, width: 220, padding: "0 12px 0 32px", borderRadius: "var(--r-md)", background: "var(--surface)",
                border: "1px solid var(--line)", color: "var(--text)", fontSize: "var(--fs-sm)" }} />
          </div>
          <div style={{ display: "inline-flex", padding: 3, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", gap: 2 }}>
            {([["all", null], ["github", Icons.github], ["ado", Icons.azure]] as const).map(([k, I]) => (
              <button key={k} onClick={() => setProv(k)} title={k}
                style={{ display: "grid", placeItems: "center", width: 30, height: 26, borderRadius: 6, border: "none",
                  background: prov === k ? "var(--surface-3)" : "transparent", color: prov === k ? "var(--text)" : "var(--text-faint)",
                  fontSize: 11, fontWeight: 600 }}>
                {I ? <I size={14} /> : "All"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Card pad={false}>
        <div style={{ display: "grid", gridTemplateColumns: "20px 2.4fr 1.6fr 1fr 0.9fr 132px 88px", gap: 16, alignItems: "center",
          padding: "10px 18px", borderBottom: "1px solid var(--line)", color: "var(--text-faint)", fontSize: "var(--fs-micro)",
          fontWeight: 650, letterSpacing: ".06em", textTransform: "uppercase" }}>
          <span></span><span>Job</span><span>Schedule</span><span>Target</span><span>Last run</span><span>Trend · success</span><span style={{ textAlign: "right" }}></span>
        </div>
        {rows.length ? rows.map((j) => <JobRow key={j.name} j={j} nav={nav} onRun={runJob} />)
          : <div style={{ padding: "48px", textAlign: "center", color: "var(--text-3)" }}>
              <Icons.search size={22} style={{ color: "var(--text-faint)", marginBottom: 10 }} />
              <div style={{ fontSize: "var(--fs-sm)" }}>No jobs match these filters.</div>
            </div>}
      </Card>
    </div>
  );
}
