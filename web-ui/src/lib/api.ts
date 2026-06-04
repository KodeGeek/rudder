/* Typed client for the control-plane REST API.
   The browser always calls the same-origin proxy path (`/api/control-plane/*`);
   nginx forwards it to the control-plane, so endpoints stay server-side. */
import { getConfig } from "./config";
import type {
  ActivityItem, Channel, ConnectedRepo, Group, Host, Job, Reconcile, SecretRef,
} from "../data/types";

const base = () => getConfig().controlPlane.proxy;

// Thrown on HTTP 401 so callers can tell "unauthorized" (→ login) apart from
// "backend down" (→ keep the resilient UI). The token is a shared API key the
// operator pastes once; real SSO is handled by a reverse proxy in front.
export class AuthError extends Error {}

const TOKEN_KEY = "rudder_token";
export const getToken = (): string => {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
};
export const setToken = (t: string): void => {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
};
export const clearToken = (): void => {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
};

function authHeaders(extra?: Record<string, string>): Record<string, string> | undefined {
  const h: Record<string, string> = { ...(extra || {}) };
  const t = getToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  return Object.keys(h).length ? h : undefined;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(base() + path, { cache: "no-store", headers: authHeaders() });
  if (r.status === 401) throw new AuthError(`GET ${path} → 401`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(base() + path, {
    method,
    headers: authHeaders(body !== undefined ? { "Content-Type": "application/json" } : undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) throw new AuthError(`${method} ${path} → 401`);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}`);
  return (r.status === 204 ? undefined : await r.json()) as T;
}

export interface AuthInfo { ok: boolean; role: string; authRequired: boolean }

export interface Info { bundledRepoUrl: string | null; reconcileInterval: string }
export interface ManifestDoc {
  jobsYaml: string; rudderYaml: string; found: boolean; playbooks: string[];
  slug: string; branch: string; provider: string;
}
export interface NewRepo { provider: string; url: string; branch: string; token?: string; authMethod?: string; vaultPass?: string }
export interface DeployKey { rid: string; publicKey: string; sshUrl: string }
export interface ResourceUse { used: number; total: number; pct: number }
export interface HostStats { cpu?: number; mem?: ResourceUse; disk?: ResourceUse; source?: string; error?: string }

export const api = {
  info: () => get<Info>("/info"),
  repos: () => get<ConnectedRepo[]>("/repos"),
  addRepo: (body: NewRepo) => send<ConnectedRepo>("POST", "/repos", body),
  deployKey: (body: { provider: string; url: string }) => send<DeployKey>("POST", "/deploy-key", body),
  setCredentials: (body: { rid: string; hostKey?: string; vaultPass?: string; token?: string }) =>
    send<ConnectedRepo>("POST", "/repos/credentials", body),
  removeRepo: (id: string) => send<void>("DELETE", "/repos/" + id),
  jobs: () => get<Job[]>("/jobs"),
  job: (name: string) => get<Job>("/jobs/" + encodeURIComponent(name)),
  verify: () => get<AuthInfo>("/auth/verify"),
  testChannel: (type: string, target: string) =>
    send<{ sent: boolean }>("POST", "/channels/test", { type, target }),
  playbook: (name: string) => get<{ path: string; content: string; found: boolean }>(
    "/jobs/" + encodeURIComponent(name) + "/playbook"),
  runJob: (name: string) => send<{ started: boolean }>("POST", "/jobs/" + encodeURIComponent(name) + "/run"),
  stopRun: (name: string, runId: string) =>
    send<{ stopped: boolean }>("POST", "/jobs/" + encodeURIComponent(name) + "/runs/" + encodeURIComponent(runId) + "/stop"),
  hostStats: () => get<HostStats>("/host-stats"),
  reconcile: () => get<Reconcile>("/reconcile"),
  reconcileNow: () => send<Reconcile>("POST", "/reconcile"),
  activity: () => get<ActivityItem[]>("/activity"),
  inventory: () => get<{ groups: Group[]; hosts: Host[] }>("/inventory"),
  secrets: () => get<SecretRef[]>("/secrets"),
  channels: () => get<Channel[]>("/channels"),
  manifest: () => get<ManifestDoc>("/manifest"),
};
