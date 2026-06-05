/* Rudder — app shell: sidebar, routing, theme. Data + actions come from useData(). */
import React from "react";
import { Logo, Btn, IconBtn, StatusDot } from "./components/ui";
import { Toast } from "./components/composite";
import { Icons, type IconFn } from "./components/icons";
import { relTime } from "./lib/format";
import { useData } from "./lib/data";
import type { NavFn, RouteParams } from "./data/types";
import { OverviewScreen } from "./screens/Overview";
import { JobsScreen } from "./screens/Jobs";
import { JobDetailScreen } from "./screens/JobDetail";
import { ManifestScreen } from "./screens/Manifest";
import { ActivityScreen, InventoryScreen } from "./screens/Activity";
import { SettingsScreen, ConnectScreen, CredentialsScreen } from "./screens/Settings";
import { LoginScreen } from "./screens/Login";
import { getToken } from "./lib/api";

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

// Route is mirrored to the URL hash so a refresh / back-forward keeps the screen.
function parseHash(): { name: string; params: RouteParams } {
  const h = (typeof location !== "undefined" ? location.hash : "").replace(/^#\/?/, "");
  if (!h) return { name: "overview", params: {} };
  const [path, query = ""] = h.split("?");
  const seg = path.split("/");
  const name = seg[0] || "overview";
  const params: RouteParams = {};
  new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
  if (name === "job" && seg[1]) params.name = decodeURIComponent(seg[1]);
  return { name, params };
}

function routeToHash(r: { name: string; params: RouteParams }): string {
  if (r.name === "job" && r.params.name) return `#/job/${encodeURIComponent(r.params.name)}`;
  const qs = new URLSearchParams();
  if (r.name === "jobs" && r.params.f) qs.set("f", String(r.params.f));
  if (r.name === "activity" && r.params.filter) qs.set("filter", String(r.params.filter));
  const q = qs.toString();
  return `#/${r.name}${q ? "?" + q : ""}`;
}

export function App() {
  const data = useData();
  const [theme, setTheme] = React.useState<Theme>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("rudder-theme") : null;
    return saved === "light" || saved === "dark" ? saved : "dark";
  });
  const [route, setRoute] = React.useState<{ name: string; params: RouteParams }>(() => parseHash());

  React.useEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", theme);
    r.setAttribute("data-density", "regular");
    try { localStorage.setItem("rudder-theme", theme); } catch { /* ignore */ }
  }, [theme]);

  // back/forward (and manual hash edits) re-read the route from the URL
  React.useEffect(() => {
    const onPop = () => setRoute(parseHash());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const nav: NavFn = (name, params = {}) => {
    setRoute({ name, params });
    try { history.pushState({}, "", routeToHash({ name, params })); } catch { /* ignore */ }
    const main = document.getElementById("rudder-main");
    if (main) main.scrollTop = 0;
  };

  // Mid-session 401 (e.g. key rotated): drop back to the login screen.
  if (data.unauthorized) return <LoginScreen onSuccess={data.refresh} />;

  const failing = data.jobs.filter((j) => j.status === "fail").length;
  const running = data.jobs.filter((j) => j.status === "running").length;
  const signedIn = !!getToken();

  let screen: React.ReactNode;
  const p = route.params;
  switch (route.name) {
    case "overview": screen = <OverviewScreen nav={nav} />; break;
    case "jobs": screen = <JobsScreen nav={nav} initialFilter={p.f} />; break;
    case "job": screen = <JobDetailScreen name={p.name} nav={nav} />; break;
    case "manifest": screen = <ManifestScreen nav={nav} />; break;
    case "activity": screen = <ActivityScreen nav={nav} params={p} />; break;
    case "inventory": screen = <InventoryScreen nav={nav} />; break;
    case "settings": screen = <SettingsScreen nav={nav} />; break;
    case "connect": screen = <ConnectScreen nav={nav} params={p} />; break;
    case "credentials": screen = <CredentialsScreen nav={nav} params={p} />; break;
    default: screen = <OverviewScreen nav={nav} />;
  }
  const activeNav = route.name === "job" ? "jobs"
    : (route.name === "connect" || route.name === "credentials") ? "settings" : route.name;

  const reconcileLabel = data.repos.length === 0
    ? "No repositories connected"
    : data.reconcile?.lastAt
      ? `In sync · pulled ${relTime(data.reconcile.lastAt)}`
      : "Awaiting first reconcile";

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

        <button onClick={() => nav("overview")} style={{ textAlign: "left", padding: "11px 12px", borderRadius: "var(--r-md)", border: "1px solid var(--line)", background: "var(--surface-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icons.refresh size={14} style={{ color: "var(--accent-text)" }} />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-2)" }}>Reconcile loop</span>
            <span style={{ flex: 1 }} />
            <StatusDot s={data.repos.length ? "ok" : "never"} size={7} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>{reconcileLabel}</div>
        </button>
      </aside>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
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
          {data.error && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "var(--fs-xs)", color: "var(--fail)", padding: "5px 11px", borderRadius: 99, background: "var(--fail-dim)" }}>
              <StatusDot s="fail" size={6} /> control-plane unreachable
            </span>
          )}
          {running > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "var(--fs-xs)", color: "var(--warn)", padding: "5px 11px", borderRadius: 99, background: "var(--warn-dim)" }}>
              <StatusDot s="running" size={6} /> {running} running
            </span>
          )}
          {data.role === "viewer" && (
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)", padding: "4px 9px", borderRadius: 99, background: "var(--surface-3)" }}>read-only</span>
          )}
          <IconBtn icon={theme === "dark" ? Icons.sun : Icons.moon} title="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} />
          {signedIn && <IconBtn icon={Icons.key} title="Sign out" onClick={() => data.signOut()} />}
          {data.canWrite && <Btn kind="solid" size="sm" icon={Icons.refresh} onClick={() => data.reconcileNow()}>Reconcile now</Btn>}
        </header>

        <main id="rudder-main" style={{ flex: 1, overflow: "auto" }}>{screen}</main>
      </div>

      <Toast toast={data.toast} />
    </div>
  );
}
