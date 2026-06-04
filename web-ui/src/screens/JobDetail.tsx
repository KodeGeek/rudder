/* Rudder — Job detail + log drill-down (the workhorse). Live-fetched. */
import React from "react";
import { Card, Btn, StatusDot, StatusPill, Sparkline, KindTag, st } from "../components/ui";
import { LogViewer, PlaybookViewer, RunTimeline } from "../components/composite";
import { Icons } from "../components/icons";
import { EmptyState } from "../components/EmptyState";
import { relTime, clockTime, fullStamp, dur, cronHuman } from "../lib/format";
import { useData } from "../lib/data";
import { api } from "../lib/api";
import type { Job, NavFn } from "../data/types";

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

function Toggle({ value, onChange }: { value: "run" | "playbook"; onChange: (v: "run" | "playbook") => void }) {
  const opts: { k: "run" | "playbook"; label: string; icon: typeof Icons.terminal }[] = [
    { k: "run", label: "Live run", icon: Icons.terminal },
    { k: "playbook", label: "Playbook", icon: Icons.doc },
  ];
  return (
    <div style={{ display: "inline-flex", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: 2 }}>
      {opts.map((o) => {
        const active = value === o.k;
        return (
          <button key={o.k} onClick={() => onChange(o.k)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: "calc(var(--r-md) - 2px)", border: "none",
              background: active ? "var(--surface)" : "transparent", color: active ? "var(--text)" : "var(--text-3)",
              fontSize: "var(--fs-sm)", fontWeight: active ? 600 : 500, cursor: "pointer" }}>
            <o.icon size={14} style={{ color: active ? "var(--accent-text)" : "inherit" }} /> {o.label}
          </button>
        );
      })}
    </div>
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

export function JobDetailScreen({ name, nav }: { name: string; nav: NavFn }) {
  const { runJob } = useData();
  const [job, setJob] = React.useState<Job | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [sel, setSel] = React.useState<string | undefined>(undefined);
  const [view, setView] = React.useState<"run" | "playbook">("run");
  const [pb, setPb] = React.useState<{ path: string; content: string; found: boolean } | null>(null);
  const [pbLoading, setPbLoading] = React.useState(false);

  React.useEffect(() => {
    if (view !== "playbook" || pb) return;
    setPbLoading(true);
    api.playbook(name).then(setPb).catch(() => setPb({ path: "", content: "", found: false }))
      .finally(() => setPbLoading(false));
  }, [view, pb, name]);

  const load = React.useCallback(async () => {
    try {
      const j = await api.job(name);
      setJob(j);
      setSel((s) => s || j.runs[0]?.id);
    } catch {
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [name]);

  React.useEffect(() => { load(); }, [load]);

  const isRunning = job?.status === "running" || !!job?.runs?.some((r) => r.status === "running");
  React.useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(load, 2500);
    return () => clearInterval(id);
  }, [isRunning, load]);

  if (loading && !job) return <EmptyState icon={Icons.refresh} title="Loading job…" />;
  if (!job) return <div style={{ padding: 40, color: "var(--text-3)" }}>Job not found.</div>;

  const runs = job.runs || [];
  const selected = runs.find((r) => r.id === sel) || runs[0] || null;
  const durRuns = runs.filter((r) => r.duration);
  const avg = durRuns.length ? Math.round(durRuns.reduce((a, r) => a + (r.duration || 0), 0) / durRuns.length) : 0;
  const m = st(job.status);
  const rate = job.successRate ?? 0;

  const onRun = async () => { await runJob(name); setTimeout(load, 1500); };
  const onStop = async () => {
    const r = runs.find((x) => x.status === "running");
    if (!r) return;
    try { await api.stopRun(name, r.id); } catch { /* ignore */ }
    setTimeout(load, 1000);
  };

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "20px 30px 60px", animation: "screen-in .35s cubic-bezier(.2,.7,.2,1) both" }}>
      <button onClick={() => nav("jobs")} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: 0 }}>
        <Icons.chevL size={15} /> Jobs
      </button>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
            <StatusDot s={job.status} size={11} />
            <h1 className="mono" style={{ margin: 0, fontSize: "var(--fs-2xl)", fontWeight: 600, letterSpacing: "-.02em" }}>{job.name}</h1>
            <StatusPill s={job.status} />
            <KindTag kind={job.kind} />
          </div>
          {job.desc && <p style={{ margin: "9px 0 0", fontSize: "var(--fs-md)", color: "var(--text-2)", maxWidth: 620 }}>{job.desc}</p>}
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
          <Btn kind="solid" icon={Icons.doc} onClick={() => nav("manifest")}>Manifest</Btn>
          {isRunning
            ? <Btn kind="solid" icon={Icons.x} onClick={onStop}>Stop</Btn>
            : <Btn kind="primary" icon={Icons.play} onClick={onRun}>Run now</Btn>}
        </div>
      </div>

      <Card pad={false} style={{ marginTop: 18 }}>
        <div style={{ display: "flex" }}>
          <Stat label="Last status" value={isRunning ? "Running" : m.label} color={m.c}
            sub={isRunning ? "in progress" : `exit ${job.exit ?? "—"} · ${relTime(job.lastRun)}`} />
          <Stat label="Last duration" value={dur(job.duration)} sub={`avg ${dur(avg)}`} />
          <Stat label="Success rate" value={`${job.successRate ?? "—"}%`} sub={`last ${durRuns.length || runs.length} runs`}
            color={rate >= 95 ? "var(--ok)" : rate >= 80 ? "var(--warn)" : "var(--fail)"} />
          <Stat label="Next run" value={relTime(job.nextRun).replace("in ", "")} sub={job.nextRun ? clockTime(job.nextRun) + " UTC" : "—"} />
          <div style={{ flex: 1.3, padding: "14px 18px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: "var(--fs-micro)", color: "var(--text-faint)", fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 8 }}>Duration trend</div>
            <Sparkline data={job.spark} w={210} h={32} />
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "var(--gap)", marginTop: 18, alignItems: "start" }}>
        <Card pad={false}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px 11px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "var(--fs-md)", fontWeight: 600 }}>
              <Icons.history size={15} style={{ color: "var(--text-3)" }} /> Run history
            </span>
          </div>
          <div style={{ borderTop: "1px solid var(--line-soft)", maxHeight: 520, overflow: "auto", padding: "4px 0 6px" }}>
            {runs.length ? <RunTimeline runs={runs.slice(0, 24)} selected={sel} onSelect={setSel} />
              : <div style={{ padding: "20px 16px", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>No runs yet — trigger one with “Run now”.</div>}
          </div>
        </Card>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 4px 12px", flexWrap: "wrap" }}>
            <Toggle value={view} onChange={setView} />
            {view === "run" && selected && (
              <>
                <StatusPill s={selected.status} />
                <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>{selected.streaming ? "Live run" : fullStamp(selected.at)}</span>
              </>
            )}
            <span style={{ flex: 1 }} />
            {view === "run" && selected && (
              <>
                <Meta k="host" v={selected.host} />
                <Meta k="duration" v={dur(selected.duration)} />
                <Meta k="exit" v={selected.exit ?? "—"} color={selected.exit ? "var(--fail)" : selected.exit === 0 ? "var(--ok)" : undefined} />
              </>
            )}
          </div>
          {view === "run"
            ? <LogViewer run={selected} job={job} height={448} />
            : <PlaybookViewer path={pb?.path || job.playbook} content={pb?.content || ""} found={!!pb?.found} loading={pbLoading} height={448} />}
        </div>
      </div>
    </div>
  );
}
