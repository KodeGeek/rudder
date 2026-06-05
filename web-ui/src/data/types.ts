/* Data contracts for the Rudder UI. These mirror the §5 contracts from the
   design brief so the Phase 2 control-plane can bind real data to the same
   shapes with no UI redesign. */

export type JobState = "ok" | "fail" | "running" | "stale" | "never";
export type RunStatus = "success" | "failed" | "running";
export type Provider = "github" | "ado";
export type RepoKey = "github" | "ado";
export type JobKind = "task" | "dsc";

export type LogKind = "play" | "task" | "ok" | "chg" | "err" | "recap";
export interface LogLine {
  t: LogKind;
  text: string;
}

export interface Run {
  id: string;
  at: number;
  status: RunStatus;
  duration: number | null;
  exit: number | null;
  host: string;
  log?: LogLine[];
  streaming?: boolean;
}

export interface Commit {
  sha: string;
  msg: string;
  author: string;
  at: number;
}

export interface Repo {
  provider: Provider;
  label: string;
  org: string;
  name: string;
  slug: string;
  branch: string;
  url: string;
  lastCommit: Commit;
  sync: string;
  project?: string;
}

export interface SparkPoint {
  d: number;
  ok: boolean;
}

export interface Job {
  name: string;
  cron: string;
  playbook: string;
  limit: string;
  repo?: RepoKey;
  kind: JobKind;
  desc: string;
  state: JobState;
  seed: number;
  dur: number;
  baseDur: number;
  args?: string;
  /* derived */
  provider: Provider;
  repoSlug: string;
  branch: string;
  enabled: boolean;
  status: JobState;
  lastRun: number | null;
  duration: number | null;
  exit: number | null;
  successRate: number | null;
  spark: SparkPoint[];
  runs: Run[];
  nextRun: number | null;
}

export interface Group {
  name: string;
  hosts: number;
  up: number;
  desc: string;
}

export interface Host {
  name: string;
  group: string;
  ip: string;
  os: string;
  up: boolean;
  jobs: number;
  lastSeen: number;
}

export interface ActivityItem {
  job: string;
  provider: Provider;
  status: RunStatus;
  at: number;
  duration: number | null;
  host: string;
  exit: number | null;
  kind: JobKind;
  runId: string;
}

export interface Reconcile {
  lastAt: number | null;
  intervalMin: number;
  inSync: boolean;
  pendingCommit: null;
  nextAt: number | null;
}

/** A repository the operator has connected through the UI (persisted locally).
 *  Phase 1 stores only the reference; the Phase 2 control-plane pulls from it. */
export interface ConnectedRepo {
  id: string;
  provider: Provider;
  slug: string;
  branch: string;
  url: string;
  addedAt: number;
  auth?: boolean;
  authMethod?: string;
  /** write-only secret "configured" flags (the values are never returned) */
  hostKey?: boolean;
  vaultPass?: boolean;
  /** transient: set when the last clone/fetch failed (e.g. auth) */
  error?: string;
}

export interface Channel {
  type: string;
  label: string;
  target: string;
  on: string[];
  enabled: boolean;
}

export interface SecretRef {
  ref: string;
  used: number;
  rotated: number;
  kind: string;
  rotatable?: boolean;
  warn?: boolean;
}

export interface RudderData {
  NOW: number;
  MIN: number;
  HR: number;
  DAY: number;
  groups: Group[];
  hosts: Host[];
  jobs: Job[];
  activity: ActivityItem[];
  reconcile: Reconcile;
  channels: Channel[];
  secrets: SecretRef[];
  manifestYaml: string;
  rudderYaml: string;
}

/* shared callback shapes used across screens */
export type RouteParams = Record<string, any>;
export type NavFn = (name: string, params?: RouteParams) => void;
export type RunFn = (job: Job) => void;
