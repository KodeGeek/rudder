/* Live data provider. Fetches the dashboard data from the control-plane API,
   polls for updates, and exposes actions (add/remove repo, run job, reconcile).
   In demo mode (dataSource !== "live") it stays empty and the UI shows
   onboarding/empty states. */
import React from "react";
import { api, AuthError, clearToken, type Info, type NewRepo } from "./api";
import { getConfig } from "./config";
import type {
  ActivityItem, Channel, ConnectedRepo, Group, Host, Job, Reconcile, SecretRef,
} from "../data/types";
import type { ToastData } from "../components/composite";

export interface DataCtx {
  loading: boolean;
  error: string | null;
  unauthorized: boolean;
  signOut: () => void;
  live: boolean;
  repos: ConnectedRepo[];
  jobs: Job[];
  activity: ActivityItem[];
  groups: Group[];
  hosts: Host[];
  reconcile: Reconcile | null;
  secrets: SecretRef[];
  channels: Channel[];
  info: Info | null;
  toast: ToastData | null;
  flash: (msg: string, kind?: string, sub?: string) => void;
  refresh: () => void;
  addRepo: (r: NewRepo) => Promise<ConnectedRepo>;
  removeRepo: (id: string) => Promise<void>;
  runJob: (name: string) => Promise<void>;
  reconcileNow: () => Promise<void>;
}

const Ctx = React.createContext<DataCtx | null>(null);

const EMPTY = {
  repos: [] as ConnectedRepo[], jobs: [] as Job[], activity: [] as ActivityItem[],
  groups: [] as Group[], hosts: [] as Host[], reconcile: null as Reconcile | null,
  secrets: [] as SecretRef[], channels: [] as Channel[], info: null as Info | null,
};

export function DataProvider({ children }: { children: React.ReactNode }) {
  const live = getConfig().dataSource === "live";
  const [state, setState] = React.useState(EMPTY);
  const [loading, setLoading] = React.useState(live);
  const [error, setError] = React.useState<string | null>(null);
  const [unauthorized, setUnauthorized] = React.useState(false);
  const [toast, setToast] = React.useState<ToastData | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = React.useCallback((msg: string, kind = "ok", sub?: string) => {
    setToast({ msg, kind, sub });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3400);
  }, []);

  const refresh = React.useCallback(async () => {
    if (!live) { setLoading(false); return; }
    // Resilient: a single failing endpoint must not black out the whole UI.
    const r = await Promise.allSettled([
      api.repos(), api.jobs(), api.activity(), api.inventory(),
      api.reconcile(), api.secrets(), api.channels(), api.info(),
    ]);
    const ok = (i: number) => r[i].status === "fulfilled";
    const v = <T,>(i: number, d: T): T => (r[i].status === "fulfilled" ? (r[i] as PromiseFulfilledResult<T>).value : d);
    // A 401 mid-session (e.g. key rotated) is "needs login", not "backend down".
    const sawAuthError = r.some((x) => x.status === "rejected" && (x as PromiseRejectedResult).reason instanceof AuthError);
    if (sawAuthError) {
      setUnauthorized(true);
      setLoading(false);
      return;
    }
    setUnauthorized(false);
    if (!ok(0) && !ok(1)) {
      setError("control-plane unreachable");
    } else {
      const inv = v(3, { groups: [], hosts: [] });
      setState({
        repos: v(0, []), jobs: v(1, []), activity: v(2, []),
        groups: inv.groups, hosts: inv.hosts,
        reconcile: v(4, null), secrets: v(5, []), channels: v(6, []), info: v(7, null),
      });
      setError(null);
    }
    setLoading(false);
  }, [live]);

  React.useEffect(() => {
    refresh();
    if (!live) return;
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [refresh, live]);

  const addRepo = React.useCallback(async (r: NewRepo) => {
    const rec = await api.addRepo(r);
    if (rec && rec.error) flash(`Connected, but sync failed: ${rec.error}`, "fail");
    else flash(`Connected ${r.url}`, "ok", "cloning + reconciling");
    await refresh();
    return rec;
  }, [flash, refresh]);

  const removeRepo = React.useCallback(async (id: string) => {
    await api.removeRepo(id);
    flash("Repository disconnected", "ok");
    await refresh();
  }, [flash, refresh]);

  const runJob = React.useCallback(async (name: string) => {
    await api.runJob(name);
    flash(`Triggered ${name}`, "running", "manual run");
    setTimeout(refresh, 1200);
  }, [flash, refresh]);

  const reconcileNow = React.useCallback(async () => {
    flash("Reconciling from Git…", "running", "pull + reschedule");
    try {
      await api.reconcileNow();
      flash("Reconcile complete · config in sync", "ok");
    } catch {
      flash("Reconcile failed", "fail");
    }
    await refresh();
  }, [flash, refresh]);

  const signOut = React.useCallback(() => {
    clearToken();
    setUnauthorized(true);
  }, []);

  const value: DataCtx = {
    loading, error, unauthorized, signOut, live, ...state, toast, flash, refresh,
    addRepo, removeRepo, runJob, reconcileNow,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
