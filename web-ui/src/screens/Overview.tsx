/* Rudder — Overview dashboard (hero screen). "Is everything OK?" in 2 seconds. */
import React from "react";
import { Card, Btn, StatusDot, StatusPill, KindTag } from "../components/ui";
import { Icons } from "../components/icons";
import { EmptyState } from "../components/EmptyState";
import { relTime, cronHuman, bytes } from "../lib/format";
import { useData } from "../lib/data";
import { api, type HostStats } from "../lib/api";
import type { ConnectedRepo, Job, NavFn } from "../data/types";

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
    const load = () => api.hostStats().then((d) => { if (on) setS(d); }).catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => { on = false; clearInterval(id); };
  }, []);
  return (
    <Card pad={false}>
      <div style={{ padding: "14px 16px 12px", display: "flex", alignItems: "center", gap: 9 }}>
        <Icons.server size={15} style={{ color: "var(--text-3)" }} />
        <span style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>Server resources</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>host20</span>
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
        position: "relative", overflow: "hidden" }}>
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
    <Card style={{ padding: 0, overflow: "hidden", borderColor: !noJobs && !allGood ? "var(--fail)" : "var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "20px 22px", position: "relative" }}>
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

export function OverviewScreen({ nav }: { nav: NavFn }) {
  const data = useData();
  const { repos, jobs, reconcile, hosts, groups } = data;

  if (data.loading && repos.length === 0 && jobs.length === 0) {
    return <EmptyState icon={Icons.refresh} title="Loading…" body="Fetching state from the control-plane." />;
  }
  if (repos.length === 0) {
    return (
      <EmptyState
        icon={Icons.git}
        title="Connect your first repository"
        body={<>Rudder reads your job manifest from a Git repo (GitHub or Azure DevOps) and runs it on a schedule. Connect a repo to get started.{data.info?.bundledRepoUrl ? <> The bundled demo repo is <span className="mono" style={{ color: "var(--text-2)" }}>{data.info.bundledRepoUrl}</span>.</> : null}</>}
        actionLabel="Connect a repository"
        onAction={() => nav("connect")}
      />
    );
  }

  const counts = {
    ok: jobs.filter((j) => j.status === "ok").length,
    fail: jobs.filter((j) => j.status === "fail").length,
    running: jobs.filter((j) => j.status === "running").length,
    stale: jobs.filter((j) => j.status === "stale").length,
    never: jobs.filter((j) => j.status === "never").length,
  };
  const failures = jobs.filter((j) => j.status === "fail" || j.status === "stale");
  const upcoming = jobs.filter((j) => j.nextRun).sort((a, b) => (a.nextRun || 0) - (b.nextRun || 0)).slice(0, 6);
  const hostsUp = hosts.filter((h) => h.up).length;

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 30px 60px", animation: "screen-in .35s cubic-bezier(.2,.7,.2,1) both" }}>
      <Verdict jobs={jobs} nav={nav} />

      <div style={{ display: "flex", gap: "var(--gap)", marginTop: "var(--gap)" }}>
        <Metric k={counts.ok} label="Passing" color="var(--ok)" />
        <Metric k={counts.fail} label="Failing" color="var(--fail)" onClick={() => nav("jobs", { f: "fail" })} />
        <Metric k={counts.running} label="Running now" color="var(--warn)" />
        <Metric k={counts.stale} label="Stale" color="var(--warn)" />
        <Metric k={`${counts.never}`} label="Never run" color="var(--idle)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: "var(--gap)", marginTop: "var(--gap)", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
          <Card pad={false}>
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

          <Card pad={false}>
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
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
          <ServerResources />
          <Card pad={false}>
            <div style={{ padding: "14px 16px 12px", display: "flex", alignItems: "center", gap: 9 }}>
              <Icons.refresh size={15} style={{ color: "var(--accent-text)" }} />
              <span style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>Reconcile</span>
              <span style={{ flex: 1 }} />
              <StatusPill s="ok" size="sm">In sync</StatusPill>
            </div>
            <div style={{ borderTop: "1px solid var(--line-soft)", padding: "13px 16px", display: "grid", gap: 9 }}>
              <Row k="Last reconcile" v={relTime(reconcile?.lastAt)} mono />
              <Row k="Next reconcile" v={relTime(reconcile?.nextAt)} mono />
              <Row k="Interval" v={`every ${reconcile?.intervalMin ?? "—"}m`} mono />
              <Row k="Config drift" v={<span style={{ color: "var(--ok)" }}>none</span>} />
            </div>
          </Card>

          <Card pad={false}>
            <div style={{ padding: "14px 16px 12px", fontSize: "var(--fs-md)", fontWeight: 600 }}>Connected repos</div>
            <div style={{ borderTop: "1px solid var(--line-soft)", padding: "12px 14px", display: "grid", gap: 9 }}>
              {repos.map((r) => <RepoCard key={r.id} repo={r} />)}
              <Btn size="sm" kind="ghost" icon={Icons.settings} full onClick={() => nav("settings")}>Manage connections</Btn>
            </div>
          </Card>

          <Card pad={false}>
            <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: 9 }}>
              <Icons.clock size={15} style={{ color: "var(--text-3)" }} />
              <span style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>Upcoming runs</span>
            </div>
            <div style={{ borderTop: "1px solid var(--line-soft)", padding: "6px 12px 12px" }}>
              {upcoming.length ? upcoming.map((j) => <NextRunRow key={j.name} j={j} nav={nav} />)
                : <div style={{ padding: "14px 4px", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>No upcoming runs.</div>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
