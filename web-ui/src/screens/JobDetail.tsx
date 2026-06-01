/* Rudder — Job detail + log drill-down (the workhorse, §4.2) */
import React from "react";
import { Card, Btn, StatusDot, StatusPill, Sparkline, KindTag, st } from "../components/ui";
import { LogViewer, RunTimeline } from "../components/composite";
import { Icons } from "../components/icons";
import { relTime, clockTime, fullStamp, dur, cronHuman } from "../lib/format";
import { RUDDER } from "../data/mock";
import type { NavFn, RunFn, Run } from "../data/types";

function Stat({ label, value, sub, color }:
  { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; color?: string }) {
  return (
    <div style={{ flex: 1, padding: "14px 16px", borderRight: "1px solid var(--line-soft)" }}>
      <div style={{ fontSize: "var(--fs-micro)", color: "var(--text-faint)", fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase" }}>{label}</div>
      <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: color || "var(--text)", marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Crumb({ nav }: { nav: NavFn; name?: string }) {
  return (
    <button onClick={() => nav("jobs")} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none",
      color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: 0 }}>
      <Icons.chevL size={15} /> Jobs
    </button>
  );
}

function Meta({ k, v, color }: { k: React.ReactNode; v: React.ReactNode; color?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{k}</span>
      <span className="mono" style={{ fontSize: 12, color: color || "var(--text)", fontWeight: 550 }}>{v}</span>
    </span>
  );
}

export function JobDetailScreen({ name, nav, onRun, runningRuns }:
  { name: string; nav: NavFn; onRun: RunFn; runningRuns: Record<string, Run> }) {
  const D = RUDDER;
  const job = D.jobs.find((j) => j.name === name);
  const liveRun = runningRuns && runningRuns[name];
  const runs = React.useMemo(() => {
    const base = job ? job.runs : [];
    return liveRun ? [liveRun, ...base.filter((r) => !r.streaming)] : base;
  }, [job, liveRun]);
  const [sel, setSel] = React.useState<string | undefined>(runs[0]?.id);
  React.useEffect(() => { setSel(runs[0]?.id); }, [name, liveRun]);
  if (!job) return <div style={{ padding: 40 }}>Job not found.</div>;
  const repo = D.repos[job.repo];
  const selected = runs.find((r) => r.id === sel) || runs[0] || null;
  const durRuns = job.runs.filter((r) => r.duration);
  const avg = Math.round(durRuns.reduce((a, r) => a + (r.duration || 0), 0) / Math.max(1, durRuns.length));
  const m = st(job.status);
  const rate = job.successRate ?? 0;

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "20px 30px 60px", animation: "screen-in .35s cubic-bezier(.2,.7,.2,1) both" }}>
      <Crumb nav={nav} name={name} />
      {/* header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
            <StatusDot s={job.status} size={11} />
            <h1 className="mono" style={{ margin: 0, fontSize: "var(--fs-2xl)", fontWeight: 600, letterSpacing: "-.02em" }}>{job.name}</h1>
            <StatusPill s={job.status} />
            <KindTag kind={job.kind} />
          </div>
          <p style={{ margin: "9px 0 0", fontSize: "var(--fs-md)", color: "var(--text-2)", maxWidth: 620 }}>{job.desc}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12, flexWrap: "wrap", color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icons.clock size={14} />{cronHuman(job.cron)} <span className="mono" style={{ color: "var(--text-faint)" }}>({job.cron})</span></span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icons.server size={14} />{job.limit}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {job.provider === "ado" ? <Icons.azure size={14} /> : <Icons.github size={14} />}
              <span className="mono" style={{ fontSize: 12 }}>{job.repoSlug}</span>
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          <Btn kind="solid" icon={Icons.doc} title="View this job in the manifest" onClick={() => nav("manifest")}>Manifest</Btn>
          <Btn kind="solid" icon={Icons.doc} title="Open the playbook in Git">Playbook<Icons.ext size={13} style={{ marginLeft: -2, opacity: 0.6 }} /></Btn>
          <Btn kind="primary" icon={Icons.play} disabled={!!liveRun} onClick={() => onRun(job)}>{liveRun ? "Running…" : "Run now"}</Btn>
        </div>
      </div>

      {/* stat strip */}
      <Card pad={false} style={{ marginTop: 18 }}>
        <div style={{ display: "flex" }}>
          <Stat label="Last status" value={liveRun ? "Running" : m.label} color={m.c}
            sub={liveRun ? "started just now" : `exit ${job.exit ?? "—"} · ${relTime(job.lastRun)}`} />
          <Stat label="Last duration" value={dur(job.duration)} sub={`avg ${dur(avg)}`} />
          <Stat label="Success rate" value={`${job.successRate ?? "—"}%`} sub="last 26 runs"
            color={rate >= 95 ? "var(--ok)" : rate >= 80 ? "var(--warn)" : "var(--fail)"} />
          <Stat label="Next run" value={relTime(job.nextRun).replace("in ", "")} sub={job.nextRun ? clockTime(job.nextRun) + " UTC" : "—"} />
          <div style={{ flex: 1.3, padding: "14px 18px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: "var(--fs-micro)", color: "var(--text-faint)", fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 8 }}>Duration trend</div>
            <Sparkline data={job.spark} w={210} h={32} />
          </div>
        </div>
      </Card>

      {liveRun && (
        <div style={{ marginTop: 14, padding: "11px 15px", borderRadius: "var(--r-md)", background: "var(--warn-dim)", border: "1px solid var(--warn)",
          borderColor: "color-mix(in oklch, var(--warn) 40%, transparent)", display: "flex", alignItems: "center", gap: 10 }}>
          <StatusDot s="running" size={9} />
          <span style={{ fontSize: "var(--fs-sm)", color: "var(--text)" }}>Manual run in progress on <span className="mono">{job.limit}</span> — streaming below.</span>
        </div>
      )}

      {/* run history + log */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "var(--gap)", marginTop: 18, alignItems: "start" }}>
        <Card pad={false}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px 11px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "var(--fs-md)", fontWeight: 600 }}>
              <Icons.history size={15} style={{ color: "var(--text-3)" }} /> Run history
            </span>
          </div>
          <div style={{ borderTop: "1px solid var(--line-soft)", maxHeight: 520, overflow: "auto", padding: "4px 0 6px" }}>
            <RunTimeline runs={runs.slice(0, 24)} selected={sel} onSelect={setSel} />
          </div>
        </Card>

        <div>
          {/* selected-run meta */}
          {selected ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 4px 12px", flexWrap: "wrap" }}>
              <StatusPill s={selected.status} />
              <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>{selected.streaming ? "Live run" : fullStamp(selected.at)}</span>
              <span style={{ flex: 1 }} />
              <Meta k="host" v={selected.host} />
              <Meta k="duration" v={dur(selected.duration)} />
              <Meta k="exit" v={selected.exit ?? "—"} color={selected.exit ? "var(--fail)" : selected.exit === 0 ? "var(--ok)" : undefined} />
            </div>
          ) : (
            <div style={{ padding: "0 4px 12px", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>No runs yet — this job has not been scheduled to run.</div>
          )}
          <LogViewer run={selected} job={job} height={448} />
        </div>
      </div>
    </div>
  );
}
