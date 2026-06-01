/* Rudder — Overview dashboard (hero screen). "Is everything OK?" in 2 seconds. */
import React from "react";
import { Card, Btn, StatusDot, StatusPill, KindTag } from "../components/ui";
import { Icons } from "../components/icons";
import { relTime, cronHuman } from "../lib/format";
import { RUDDER } from "../data/mock";
import type { Job, NavFn, Reconcile, Repo } from "../data/types";

function Metric({ k, label, color, onClick, active }:
  { k: React.ReactNode; label: string; color: string; onClick?: () => void; active?: boolean }) {
  return (
    <button onClick={onClick}
      style={{ flex: 1, textAlign: "left", background: active ? "var(--surface-2)" : "var(--surface)", border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)", padding: "15px 16px", cursor: onClick ? "pointer" : "default", transition: "border-color .14s, background .14s",
        position: "relative", overflow: "hidden" }}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color }} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="mono" style={{ fontSize: 30, fontWeight: 600, color: "var(--text)", letterSpacing: "-.02em", lineHeight: 1 }}>{k}</span>
      </div>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)", marginTop: 7, fontWeight: 500 }}>{label}</div>
    </button>
  );
}

function Verdict({ jobs, nav }: { jobs: Job[]; nav: NavFn }) {
  const failing = jobs.filter((j) => j.status === "fail");
  const stale = jobs.filter((j) => j.status === "stale");
  const allGood = failing.length === 0 && stale.length === 0;
  const c = allGood ? "var(--ok)" : "var(--fail)";
  const dimc = allGood ? "var(--ok-dim)" : "var(--fail-dim)";
  return (
    <Card style={{ padding: 0, overflow: "hidden", borderColor: allGood ? "var(--line)" : "var(--fail)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "20px 22px", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(100deg, ${dimc}, transparent 55%)`, opacity: 0.8, pointerEvents: "none" }} />
        <div style={{ position: "relative", width: 46, height: 46, borderRadius: 13, background: dimc, display: "grid", placeItems: "center", color: c, flexShrink: 0 }}>
          {allGood ? <Icons.check size={26} sw={2.2} /> : <Icons.alert size={24} sw={2} />}
        </div>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 660, letterSpacing: "-.02em", color: "var(--text)", lineHeight: 1.1 }}>
            {allGood ? "All systems nominal" : `${failing.length} job${failing.length > 1 ? "s" : ""} failing`}
          </div>
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)", marginTop: 5 }}>
            {allGood
              ? `${jobs.length} scheduled jobs · last full reconcile passed`
              : <>Needs attention: {failing.map((f) => f.name).join(", ")}{stale.length ? ` · ${stale.length} stale` : ""}</>}
          </div>
        </div>
        {!allGood && <Btn kind="primary" iconR={Icons.chevR} onClick={() => nav("activity", { filter: "failed" })}>What broke</Btn>}
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
          {last?.host} · exit {last?.exit} · {j.limit}
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

function RepoCard({ repo }: { repo: Repo; reconcile?: Reconcile; nav?: NavFn }) {
  return (
    <div style={{ padding: "13px 14px", borderRadius: "var(--r-md)", border: "1px solid var(--line-soft)", background: "var(--surface-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {repo.provider === "ado" ? <Icons.azure size={15} style={{ color: "var(--text-2)" }} /> : <Icons.github size={15} style={{ color: "var(--text-2)" }} />}
        <span className="mono" style={{ fontSize: 12, color: "var(--text)", fontWeight: 550, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{repo.slug}</span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--ok)" }}>
          <StatusDot s="ok" size={6} /> synced
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9, color: "var(--text-3)" }}>
        <Icons.branch size={13} /><span className="mono" style={{ fontSize: 11.5 }}>{repo.branch}</span>
        <Icons.commit size={13} style={{ marginLeft: 4 }} /><span className="mono" style={{ fontSize: 11.5 }}>{repo.lastCommit.sha}</span>
        <span style={{ fontSize: 11, color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{repo.lastCommit.msg}</span>
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
  const D = RUDDER;
  const jobs = D.jobs;
  const counts = {
    ok: jobs.filter((j) => j.status === "ok").length,
    fail: jobs.filter((j) => j.status === "fail").length,
    running: jobs.filter((j) => j.status === "running").length,
    stale: jobs.filter((j) => j.status === "stale").length,
    never: jobs.filter((j) => j.status === "never").length,
  };
  const failures = jobs.filter((j) => j.status === "fail" || j.status === "stale");
  const upcoming = jobs.filter((j) => j.nextRun).sort((a, b) => (a.nextRun || 0) - (b.nextRun || 0)).slice(0, 6);
  const hostsUp = D.hosts.filter((h) => h.up).length;

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
        {/* LEFT */}
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
                { k: hostsUp + "/" + D.hosts.length, l: "hosts reachable", c: hostsUp === D.hosts.length ? "var(--ok)" : "var(--warn)" },
                { k: D.groups.length, l: "inventory groups", c: "var(--text)" },
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

        {/* RIGHT RAIL */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
          <Card pad={false}>
            <div style={{ padding: "14px 16px 12px", display: "flex", alignItems: "center", gap: 9 }}>
              <Icons.refresh size={15} style={{ color: "var(--accent-text)" }} />
              <span style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>Reconcile</span>
              <span style={{ flex: 1 }} />
              <StatusPill s="ok" size="sm">In sync</StatusPill>
            </div>
            <div style={{ borderTop: "1px solid var(--line-soft)", padding: "13px 16px", display: "grid", gap: 9 }}>
              <Row k="Last reconcile" v={relTime(D.reconcile.lastAt)} mono />
              <Row k="Next reconcile" v={relTime(D.reconcile.nextAt)} mono />
              <Row k="Interval" v={`every ${D.reconcile.intervalMin}m`} mono />
              <Row k="Config drift" v={<span style={{ color: "var(--ok)" }}>none</span>} />
            </div>
          </Card>

          <Card pad={false}>
            <div style={{ padding: "14px 16px 12px", fontSize: "var(--fs-md)", fontWeight: 600 }}>Connected repos</div>
            <div style={{ borderTop: "1px solid var(--line-soft)", padding: "12px 14px", display: "grid", gap: 9 }}>
              <RepoCard repo={D.repos.github} reconcile={D.reconcile} nav={nav} />
              <RepoCard repo={D.repos.ado} reconcile={D.reconcile} nav={nav} />
              <Btn size="sm" kind="ghost" icon={Icons.settings} full onClick={() => nav("settings")}>Manage connections</Btn>
            </div>
          </Card>

          <Card pad={false}>
            <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: 9 }}>
              <Icons.clock size={15} style={{ color: "var(--text-3)" }} />
              <span style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>Upcoming runs</span>
            </div>
            <div style={{ borderTop: "1px solid var(--line-soft)", padding: "6px 12px 12px" }}>
              {upcoming.map((j) => <NextRunRow key={j.name} j={j} nav={nav} />)}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
