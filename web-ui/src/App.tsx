/* Rudder — app shell: sidebar, routing, run-now sim, theme */
import React from "react";
import { Logo, Btn, IconBtn, StatusDot } from "./components/ui";
import { Toast, type ToastData } from "./components/composite";
import { Icons, type IconFn } from "./components/icons";
import { relTime } from "./lib/format";
import { RUDDER } from "./data/mock";
import type { Job, NavFn, RouteParams, Run } from "./data/types";
import { OverviewScreen } from "./screens/Overview";
import { JobsScreen } from "./screens/Jobs";
import { JobDetailScreen } from "./screens/JobDetail";
import { ManifestScreen } from "./screens/Manifest";
import { ActivityScreen, InventoryScreen } from "./screens/Activity";
import { SettingsScreen, ConnectScreen } from "./screens/Settings";

type Theme = "dark" | "light";
type NavItem = { k: string; label: string; icon: IconFn };

const NAV: NavItem[] = [
  { k: "overview", label: "Overview", icon: Icons.grid },
  { k: "jobs", label: "Jobs", icon: Icons.jobs },
  { k: "manifest", label: "Manifest", icon: Icons.doc },
  { k: "activity", label: "Activity", icon: Icons.activity },
  { k: "inventory", label: "Inventory", icon: Icons.server },
  { k: "settings", label: "Settings", icon: Icons.settings },
];

export function App() {
  const [theme, setTheme] = React.useState<Theme>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("rudder-theme") : null;
    return saved === "light" || saved === "dark" ? saved : "dark";
  });
  const [route, setRoute] = React.useState<{ name: string; params: RouteParams }>({ name: "overview", params: {} });
  const [runningRuns, setRunningRuns] = React.useState<Record<string, Run>>({});
  const [toast, setToast] = React.useState<ToastData | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const D = RUDDER;

  // apply theme + density to <html>; persist the theme choice
  React.useEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", theme);
    r.setAttribute("data-density", "regular");
    try { localStorage.setItem("rudder-theme", theme); } catch { /* ignore */ }
  }, [theme]);

  const nav: NavFn = (name, params = {}) => {
    setRoute({ name, params });
    const main = document.getElementById("rudder-main");
    if (main) main.scrollTop = 0;
  };
  function flash(msg: string, kind = "ok", sub?: string) {
    setToast({ msg, kind, sub });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  function runNow(job: Job) {
    if (runningRuns[job.name]) return;
    const live: Run = {
      id: `${job.name}-live-${Date.now()}`, at: D.NOW, status: "running", duration: null, exit: null,
      host: job.limit === "all" ? "ubu-app-01" : (D.hosts.find((h) => h.group === job.limit)?.name || job.limit),
      streaming: true,
      log: [
        { t: "play", text: `PLAY [${job.limit}] ${"*".repeat(38)}` },
        { t: "task", text: "TASK [Gathering Facts] " + "*".repeat(34) },
        { t: "ok", text: `ok: [${job.limit}]` },
        { t: "task", text: `TASK [${job.name} : apply configuration] ` + "*".repeat(14) },
      ],
    };
    setRunningRuns((m) => ({ ...m, [job.name]: live }));
    flash(`Triggered ${job.name}`, "running", "manual run · streaming");
    setTimeout(() => {
      const ok = job.status !== "fail";
      const done: Run = {
        ...live, status: ok ? "success" : "failed", streaming: false,
        duration: job.baseDur || 20, exit: ok ? 0 : 1,
        log: [...(live.log || []),
          { t: "chg", text: `changed: [${live.host}]` },
          { t: "task", text: `TASK [${job.name} : verify] ` + "*".repeat(20) },
          { t: ok ? "ok" : "err", text: ok ? `ok: [${live.host}] => {"msg": "healthy"}` : `fatal: [${live.host}]: FAILED! => non-zero exit` },
          { t: "recap", text: "PLAY RECAP " + "*".repeat(58) },
          { t: ok ? "ok" : "err", text: `${live.host.padEnd(16)} : ok=${ok ? 5 : 3}    changed=1    failed=${ok ? 0 : 1}` },
        ],
      };
      setRunningRuns((m) => ({ ...m, [job.name]: done }));
      flash(ok ? `${job.name} completed` : `${job.name} failed`, ok ? "ok" : "fail", ok ? "exit 0" : "exit 1");
      setTimeout(() => setRunningRuns((m) => { const n = { ...m }; delete n[job.name]; return n; }), 600);
    }, 5200);
  }

  const reconcileNow = () => {
    flash("Reconciling from Git…", "running", "pull + reschedule");
    setTimeout(() => flash("Reconcile complete · config in sync", "ok"), 2200);
  };

  const failing = D.jobs.filter((j) => j.status === "fail").length;
  const running = Object.keys(runningRuns).length || D.jobs.filter((j) => j.status === "running").length;

  let screen: React.ReactNode;
  const p = route.params;
  switch (route.name) {
    case "overview": screen = <OverviewScreen nav={nav} />; break;
    case "jobs": screen = <JobsScreen nav={nav} onRun={runNow} initialFilter={p.f} />; break;
    case "job": screen = <JobDetailScreen name={p.name} nav={nav} onRun={runNow} runningRuns={runningRuns} />; break;
    case "manifest": screen = <ManifestScreen nav={nav} onReconcile={reconcileNow} />; break;
    case "activity": screen = <ActivityScreen nav={nav} params={p} />; break;
    case "inventory": screen = <InventoryScreen nav={nav} />; break;
    case "settings": screen = <SettingsScreen nav={nav} />; break;
    case "connect": screen = <ConnectScreen nav={nav} />; break;
    default: screen = <OverviewScreen nav={nav} />;
  }
  const activeNav = route.name === "job" ? "jobs" : route.name === "connect" ? "settings" : route.name;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
      {/* SIDEBAR */}
      <aside style={{ width: 228, flexShrink: 0, borderRight: "1px solid var(--line)", background: "var(--surface)",
        display: "flex", flexDirection: "column", padding: "16px 12px" }}>
        <div style={{ padding: "6px 8px 18px" }}><Logo size={26} sub /></div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV.map((n) => {
            const active = activeNav === n.k;
            const badge = n.k === "jobs" && failing ? failing : null;
            return (
              <button key={n.k} onClick={() => nav(n.k)}
                style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 10px", borderRadius: "var(--r-md)", border: "none",
                  background: active ? "var(--surface-3)" : "transparent", color: active ? "var(--text)" : "var(--text-3)",
                  fontSize: "var(--fs-sm)", fontWeight: active ? 600 : 500, textAlign: "left", transition: "background .12s, color .12s", position: "relative" }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--surface-2)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                {active && <span style={{ position: "absolute", left: -12, top: "50%", transform: "translateY(-50%)", width: 3, height: 18, borderRadius: 99, background: "var(--accent)" }} />}
                <n.icon size={17} style={{ color: active ? "var(--accent-text)" : "inherit" }} />
                <span style={{ flex: 1 }}>{n.label}</span>
                {badge && <span className="mono" style={{ fontSize: 10.5, fontWeight: 600, color: "var(--fail)", background: "var(--fail-dim)", borderRadius: 99, padding: "1px 7px" }}>{badge}</span>}
              </button>
            );
          })}
        </nav>

        <div style={{ flex: 1 }} />

        {/* reconcile chip */}
        <button onClick={() => nav("overview")} style={{ textAlign: "left", padding: "11px 12px", borderRadius: "var(--r-md)", border: "1px solid var(--line)", background: "var(--surface-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icons.refresh size={14} style={{ color: "var(--accent-text)" }} />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-2)" }}>Reconcile loop</span>
            <span style={{ flex: 1 }} />
            <StatusDot s="ok" size={7} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>In sync · pulled {relTime(D.reconcile.lastAt)}</div>
        </button>
      </aside>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* TOPBAR */}
        <header style={{ height: 54, flexShrink: 0, borderBottom: "1px solid var(--line)", background: "color-mix(in oklab, var(--surface), transparent 12%)",
          backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 14, padding: "0 22px 0 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            {route.name === "job"
              ? <span className="mono" style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>{route.params.name}</span>
              : <span style={{ fontSize: "var(--fs-md)", fontWeight: 640, color: "var(--text)", textTransform: "capitalize", whiteSpace: "nowrap" }}>
                  {route.name === "connect" ? "Connect repository" : route.name}
                </span>}
          </div>
          <span style={{ flex: 1 }} />
          {running > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "var(--fs-xs)", color: "var(--warn)", padding: "5px 11px", borderRadius: 99, background: "var(--warn-dim)" }}>
              <StatusDot s="running" size={6} /> {running} running
            </span>
          )}
          <button style={{ display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 11px", borderRadius: "var(--r-md)", border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--text-faint)", fontSize: "var(--fs-xs)" }}>
            <Icons.search size={14} /> Search<span style={{ flex: 1 }} /><kbd className="mono" style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "var(--surface-3)", color: "var(--text-3)" }}>⌘K</kbd>
          </button>
          <IconBtn icon={theme === "dark" ? Icons.sun : Icons.moon} title="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} />
          <Btn kind="solid" size="sm" icon={Icons.refresh} onClick={reconcileNow}>Reconcile now</Btn>
        </header>

        <main id="rudder-main" style={{ flex: 1, overflow: "auto" }}>{screen}</main>
      </div>

      <Toast toast={toast} />
    </div>
  );
}
