/* ============================================================
   Rudder — mock data layer
   A deterministic, believable snapshot of a GitOps control plane.
   Everything is anchored to a fixed NOW so relative times,
   sparklines and timelines stay stable across reloads.
   ============================================================ */

import type {
  ActivityItem, Channel, Group, Host, Job, JobKind, JobState, LogLine,
  Reconcile, Repo, RepoKey, RudderData, Run, RunStatus, SecretRef, SparkPoint,
} from "./types";

// Virtual "now" — 2026-06-01 09:42:11 UTC
export const NOW = new Date("2026-06-01T09:42:11Z").getTime();
export const MIN = 60e3, HR = 60 * MIN, DAY = 24 * HR;

// tiny seeded PRNG (mulberry32) for stable run histories
function rng(seed: number): () => number {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Git connections ----
const repos: Record<RepoKey, Repo> = {
  github: {
    provider: "github",
    label: "GitHub",
    org: "northwind-infra",
    name: "fleet-automation",
    slug: "northwind-infra/fleet-automation",
    branch: "main",
    url: "https://github.com/northwind-infra/fleet-automation",
    lastCommit: { sha: "a3f91c2", msg: "patching: move ubuntuservers to 03:00 Sun", author: "p.okafor", at: NOW - 38 * MIN },
    sync: "synced",
  },
  ado: {
    provider: "ado",
    label: "Azure DevOps",
    org: "northwind",
    project: "Platform",
    name: "identity-automation",
    slug: "northwind/Platform/identity-automation",
    branch: "main",
    url: "https://dev.azure.com/northwind/Platform/_git/identity-automation",
    lastCommit: { sha: "7be0d14", msg: "ad-user-sync: widen OU filter", author: "m.haas", at: NOW - 5 * HR },
    sync: "synced",
  },
};

// ---- Inventory ----
const groups: Group[] = [
  { name: "ubuntuservers", hosts: 18, up: 18, desc: "Ubuntu 22.04 LTS general fleet" },
  { name: "edge", hosts: 6, up: 5, desc: "Edge container hosts (DMZ)" },
  { name: "dbservers", hosts: 4, up: 4, desc: "Postgres primaries + replicas" },
  { name: "dmz", hosts: 3, up: 3, desc: "Reverse-proxy / ingress" },
  { name: "win-dc", hosts: 2, up: 2, desc: "Windows domain controllers" },
];
const hosts: Host[] = [
  { name: "ubu-app-01", group: "ubuntuservers", ip: "10.20.1.11", os: "Ubuntu 22.04", up: true, jobs: 6, lastSeen: NOW - 2 * MIN },
  { name: "ubu-app-02", group: "ubuntuservers", ip: "10.20.1.12", os: "Ubuntu 22.04", up: true, jobs: 6, lastSeen: NOW - 2 * MIN },
  { name: "ubu-app-03", group: "ubuntuservers", ip: "10.20.1.13", os: "Ubuntu 22.04", up: true, jobs: 6, lastSeen: NOW - 3 * MIN },
  { name: "edge-01", group: "edge", ip: "10.40.0.4", os: "Debian 12", up: true, jobs: 3, lastSeen: NOW - 1 * MIN },
  { name: "edge-02", group: "edge", ip: "10.40.0.5", os: "Debian 12", up: true, jobs: 3, lastSeen: NOW - 1 * MIN },
  { name: "edge-04", group: "edge", ip: "10.40.0.7", os: "Debian 12", up: false, jobs: 3, lastSeen: NOW - 4 * HR },
  { name: "pg-primary", group: "dbservers", ip: "10.30.2.10", os: "Ubuntu 22.04", up: true, jobs: 2, lastSeen: NOW - 1 * MIN },
  { name: "pg-replica-1", group: "dbservers", ip: "10.30.2.11", os: "Ubuntu 22.04", up: true, jobs: 2, lastSeen: NOW - 1 * MIN },
  { name: "ingress-01", group: "dmz", ip: "10.40.0.2", os: "Alpine 3.19", up: true, jobs: 2, lastSeen: NOW - 1 * MIN },
  { name: "dc-01", group: "win-dc", ip: "10.10.0.2", os: "Win Server 2022", up: true, jobs: 1, lastSeen: NOW - 6 * MIN },
];

// ---- Log fixtures ----
const okTail = (jobName: string, host: string): LogLine[] => [
  { t: "play", text: `PLAY [${host}] ${"*".repeat(40)}` },
  { t: "task", text: "TASK [Gathering Facts] " + "*".repeat(34) },
  { t: "ok", text: `ok: [${host}]` },
  { t: "task", text: `TASK [${jobName} : ensure packages present] ` + "*".repeat(12) },
  { t: "ok", text: `ok: [${host}]` },
  { t: "task", text: `TASK [${jobName} : apply configuration] ` + "*".repeat(16) },
  { t: "chg", text: `changed: [${host}]` },
  { t: "task", text: `TASK [${jobName} : verify service healthy] ` + "*".repeat(12) },
  { t: "ok", text: `ok: [${host}] => {"msg": "service active (running)"}` },
  { t: "recap", text: "PLAY RECAP " + "*".repeat(58) },
  { t: "ok", text: `${host.padEnd(16)} : ok=5    changed=1    unreachable=0    failed=0    skipped=1` },
];
const failTail = (jobName: string, host: string): LogLine[] => [
  { t: "play", text: `PLAY [${host}] ${"*".repeat(40)}` },
  { t: "task", text: "TASK [Gathering Facts] " + "*".repeat(34) },
  { t: "ok", text: `ok: [${host}]` },
  { t: "task", text: `TASK [${jobName} : pull desired manifest] ` + "*".repeat(12) },
  { t: "ok", text: `ok: [${host}]` },
  { t: "task", text: `TASK [${jobName} : apply configuration] ` + "*".repeat(16) },
  { t: "err", text: `fatal: [${host}]: FAILED! => {"changed": false, "cmd": "docker compose up -d",` },
  { t: "err", text: `  "rc": 1, "stderr": "Error response from daemon: pull access denied for` },
  { t: "err", text: `  registry.internal/edge-gw:2.7.1, repository does not exist or may require login"}` },
  { t: "recap", text: "PLAY RECAP " + "*".repeat(58) },
  { t: "err", text: `${host.padEnd(16)} : ok=3    changed=0    unreachable=0    failed=1    skipped=0` },
];
const unreachTail = (jobName: string, host: string): LogLine[] => [
  { t: "play", text: `PLAY [${host}] ${"*".repeat(40)}` },
  { t: "task", text: "TASK [Gathering Facts] " + "*".repeat(34) },
  { t: "err", text: `fatal: [${host}]: UNREACHABLE! => {"changed": false,` },
  { t: "err", text: `  "msg": "Failed to connect to the host via ssh: ssh: connect to host ${host} port 22:` },
  { t: "err", text: `  Connection timed out", "unreachable": true}` },
  { t: "recap", text: "PLAY RECAP " + "*".repeat(58) },
  { t: "err", text: `${host.padEnd(16)} : ok=0    changed=0    unreachable=1    failed=0    skipped=0` },
];

// ---- Job definitions (the manifest, §5.1) ----
interface Def {
  name: string; cron: string; playbook: string; limit: string; repo: RepoKey;
  kind: JobKind; desc: string; state: JobState; seed: number; dur: number; baseDur: number;
  args?: string;
}

// status derived from latest run; "running" / "never" set explicitly.
const defs: Def[] = [
  { name: "weekly-ubuntu-patching", cron: "0 3 * * 0", playbook: "playbooks/patching/ubuntu.yml", limit: "ubuntuservers", repo: "github", kind: "task", desc: "apt full-upgrade + reboot-if-needed across the Ubuntu fleet.", state: "ok", seed: 11, dur: 412, baseDur: 380 },
  { name: "reconcile-edge-stack", cron: "*/15 * * * *", playbook: "playbooks/edge/compose-reconcile.yml", limit: "edge", repo: "github", kind: "dsc", desc: "Re-apply desired container stack on edge hosts; heals drift.", state: "fail", seed: 23, dur: 38, baseDur: 31, args: "-e prune=true" },
  { name: "nightly-pg-basebackup", cron: "0 1 * * *", playbook: "playbooks/db/basebackup.yml", limit: "dbservers", repo: "github", kind: "task", desc: "pg_basebackup to object storage + retention prune.", state: "ok", seed: 7, dur: 196, baseDur: 205 },
  { name: "rotate-tls-certs", cron: "0 4 * * 1", playbook: "playbooks/security/acme-renew.yml", limit: "dmz", repo: "github", kind: "task", desc: "ACME renewal for ingress certs; reload proxies.", state: "ok", seed: 31, dur: 24, baseDur: 22 },
  { name: "prune-docker-images", cron: "30 2 * * *", playbook: "playbooks/maint/docker-prune.yml", limit: "edge", repo: "github", kind: "task", desc: "Reclaim disk: dangling images + stopped containers.", state: "ok", seed: 5, dur: 12, baseDur: 14 },
  { name: "sync-dns-records", cron: "*/30 * * * *", playbook: "playbooks/net/dns-reconcile.yml", limit: "dmz", repo: "github", kind: "dsc", desc: "Reconcile internal DNS zone from declared records.", state: "running", seed: 19, dur: 9, baseDur: 8 },
  { name: "check-disk-usage", cron: "0 * * * *", playbook: "playbooks/maint/disk-watch.yml", limit: "all", repo: "github", kind: "task", desc: "Alert if any mount > 85% used.", state: "ok", seed: 41, dur: 6, baseDur: 6 },
  { name: "apply-firewall-rules", cron: "0 5 * * *", playbook: "playbooks/security/nftables.yml", limit: "dmz", repo: "github", kind: "dsc", desc: "Enforce declared nftables ruleset on perimeter.", state: "ok", seed: 13, dur: 18, baseDur: 17 },
  { name: "ad-user-sync", cron: "*/20 * * * *", playbook: "pipelines/identity/ad-sync.yml", limit: "win-dc", repo: "ado", kind: "dsc", desc: "Reconcile AD users/groups from HR source of truth.", state: "fail", seed: 29, dur: 47, baseDur: 40 },
  { name: "rotate-app-secrets", cron: "0 6 1 * *", playbook: "pipelines/identity/secret-rotate.yml", limit: "ubuntuservers", repo: "ado", kind: "task", desc: "Rotate application service-account secrets in vault.", state: "ok", seed: 37, dur: 28, baseDur: 26 },
  { name: "bootstrap-monitoring", cron: "0 7 * * *", playbook: "playbooks/obs/node-exporter.yml", limit: "all", repo: "github", kind: "dsc", desc: "Ensure node-exporter + promtail present on every host.", state: "stale", seed: 3, dur: 71, baseDur: 68 },
  { name: "audit-ssh-keys", cron: "0 8 * * *", playbook: "playbooks/security/ssh-audit.yml", limit: "all", repo: "github", kind: "task", desc: "Report authorized_keys drift vs declared key set.", state: "never", seed: 2, dur: 0, baseDur: 15 },
];

// Build run histories + derive top-level status fields
const jobs: Job[] = defs.map((d): Job => {
  const r = rng(d.seed);
  const interval = cronIntervalMs(d.cron);
  const runs: Run[] = [];
  const N = d.state === "never" ? 0 : 26;
  for (let i = N - 1; i >= 0; i--) {
    // most recent run index 0
    const at = NOW - (d.state === "running" ? 0 : (i === 0 ? lastRunOffset(d) : i * interval));
    let status: RunStatus = "success";
    // inject occasional failures, deterministic
    const roll = r();
    if (roll > 0.86) status = "failed";
    const isLatest = i === 0;
    if (isLatest) {
      if (d.state === "fail") status = "failed";
      else if (d.state === "ok") status = "success";
      else if (d.state === "stale") status = "success";
      else if (d.state === "running") status = "running";
    }
    const jitter = (r() - 0.5) * 0.28;
    const d2 = Math.max(3, Math.round(d.baseDur * (1 + jitter)));
    runs.push({
      id: `${d.name}-${i}`,
      at,
      status,
      duration: status === "running" ? null : d2,
      exit: status === "success" ? 0 : status === "running" ? null : (r() > 0.5 ? 2 : 1),
      host: pickHost(d.limit, r),
    });
  }
  runs.reverse(); // index 0 = most recent
  const latest = runs[0] || null;
  const succ = runs.filter((x) => x.status === "success").length;
  const total = runs.filter((x) => x.status !== "running").length || 1;
  return {
    ...d,
    provider: repos[d.repo].provider,
    repoSlug: repos[d.repo].slug,
    branch: repos[d.repo].branch,
    enabled: true,
    status: d.state, // ok | fail | running | stale | never
    lastRun: latest ? latest.at : null,
    duration: d.state === "never" ? null : d.dur,
    exit: latest ? latest.exit : null,
    successRate: d.state === "never" ? null : Math.round((succ / total) * 100),
    spark: runs.slice(0, 24).reverse().map((x): SparkPoint => ({ d: x.duration || 0, ok: x.status === "success" })),
    runs,
    nextRun: d.state === "never" ? null : NOW + nextRunOffset(d.cron),
  };
});

function lastRunOffset(d: Def): number {
  // how long ago the latest run was, for headline freshness
  const map: Record<string, number | null> = {
    "weekly-ubuntu-patching": 4 * DAY + 6 * HR,
    "reconcile-edge-stack": 4 * MIN,
    "nightly-pg-basebackup": 8 * HR + 42 * MIN,
    "rotate-tls-certs": 2 * DAY,
    "prune-docker-images": 7 * HR + 12 * MIN,
    "sync-dns-records": 0,
    "check-disk-usage": 42 * MIN,
    "apply-firewall-rules": 4 * HR + 42 * MIN,
    "ad-user-sync": 12 * MIN,
    "rotate-app-secrets": 6 * DAY,
    "bootstrap-monitoring": 31 * HR,
    "audit-ssh-keys": null,
  };
  return map[d.name] ?? 1 * HR;
}

function pickHost(limit: string, r: () => number): string {
  const pool = hosts.filter((h) => limit === "all" || h.group === limit);
  if (!pool.length) return "localhost";
  return pool[Math.floor(r() * pool.length)].name;
}

function cronIntervalMs(cron: string): number {
  if (cron.startsWith("*/15")) return 15 * MIN;
  if (cron.startsWith("*/20")) return 20 * MIN;
  if (cron.startsWith("*/30")) return 30 * MIN;
  if (cron === "0 * * * *") return HR;
  if (cron.includes("* * 0")) return 7 * DAY;
  if (cron.includes("* * 1")) return 7 * DAY;
  if (cron.includes("1 * *")) return 30 * DAY;
  return DAY;
}
function nextRunOffset(cron: string): number {
  if (cron.startsWith("*/15")) return 11 * MIN;
  if (cron.startsWith("*/20")) return 8 * MIN;
  if (cron.startsWith("*/30")) return 18 * MIN;
  if (cron === "0 * * * *") return 18 * MIN;
  if (cron.includes("* * 0")) return 2 * DAY + 17 * HR;
  if (cron.includes("* * 1")) return 17 * HR;
  if (cron.includes("1 * *")) return 24 * DAY;
  return 15 * HR;
}

// attach a full log tail to each run (lazily-ish; small dataset)
jobs.forEach((j) => {
  j.runs.forEach((run) => {
    if (run.status === "running") {
      run.log = okTail(j.name, run.host).slice(0, 7);
      run.log.push({ t: "task", text: `TASK [${j.name} : reconcile records] ` + "*".repeat(14) });
      run.streaming = true;
    } else if (run.status === "failed") {
      run.log = j.name === "ad-user-sync" ? unreachTail(j.name, "dc-01") : failTail(j.name, run.host);
    } else {
      run.log = okTail(j.name, run.host);
    }
  });
});

// ---- Manifest YAML (jobs.yml — read-only view of the job source of truth) ----
const manifestYaml = jobs
  .filter((j) => j.repo === "github")
  .map((j) => {
    let s = `- name: ${j.name}\n  cron: "${j.cron}"\n  playbook: ${j.playbook}`;
    if (j.limit && j.limit !== "all") s += `\n  limit: ${j.limit}`;
    if (j.args) s += `\n  extra_args: "${j.args}"`;
    return s;
  })
  .join("\n\n");

// ---- Operational config (rudder.yml — the rest of the source of truth) ----
function secretsRefList(): string[] {
  return [
    "    - vault/ssh-deploy-key   # ssh-key — Ansible SSH auth",
    "    - vault/ado-pat          # token",
    "    - vault/github-app       # app-creds",
    "    - vault/registry-pull    # token",
    "    - vault/acme-account     # key",
  ];
}
const rudderYaml = [
  "# rudder.yml — operational configuration.",
  "# Source of truth lives here, in Git. The UI is read-only; edit this file",
  "# and open a PR to change anything. The control-plane reconciles on merge.",
  "",
  "git:",
  "  - provider: github",
  "    repo: northwind-infra/fleet-automation",
  "    branch: main",
  "  - provider: azure-devops",
  "    repo: northwind/Platform/identity-automation",
  "    branch: main",
  "",
  "reconcile:",
  "  interval: 15m",
  "",
  "observability:",
  "  prometheus: http://prometheus:9090   # metrics",
  "  loki:       http://loki:3100         # run logs",
  "",
  "vault:",
  "  address: http://vault:8200",
  "  secrets:                              # references only — values stay in Vault",
  ...secretsRefList(),
  "",
  "alerts:",
  "  - type: slack",
  '    target: "#ops-alerts"',
  "    on: [failed]",
  "  - type: email",
  "    target: oncall@northwind.io",
  "    on: [failed, stale]",
].join("\n");

// ---- Activity feed (flatten recent runs) ----
const activity: ActivityItem[] = [];
jobs.forEach((j) => {
  j.runs.slice(0, 6).forEach((run) => {
    if (run.status === "running" && run.at !== NOW) return;
    activity.push({
      job: j.name, provider: j.provider, status: run.status,
      at: run.at, duration: run.duration, host: run.host, exit: run.exit,
      kind: j.kind, runId: run.id,
    });
  });
});
activity.sort((a, b) => b.at - a.at);

// ---- Reconcile state (§3) ----
const reconcile: Reconcile = {
  lastAt: NOW - 3 * MIN,
  intervalMin: 15,
  inSync: true,
  pendingCommit: null,
  nextAt: NOW + 12 * MIN,
};

// ---- Notification channels (settings) ----
const channels: Channel[] = [
  { type: "slack", label: "#ops-alerts", target: "northwind.slack.com", on: ["failed"], enabled: true },
  { type: "email", label: "oncall@northwind.io", target: "SMTP relay", on: ["failed", "stale"], enabled: true },
  { type: "webhook", label: "PagerDuty", target: "events.pagerduty.com/v2", on: ["failed"], enabled: false },
  { type: "telegram", label: "@northwind_ops_bot", target: "Telegram", on: ["failed"], enabled: false },
];

// ---- Secret references (never values, §8) ----
const secrets: SecretRef[] = [
  { ref: "vault/ssh-deploy-key", used: 11, rotated: NOW - 9 * DAY, kind: "ssh-key" },
  { ref: "vault/ado-pat", used: 2, rotated: NOW - 40 * DAY, kind: "token", warn: true },
  { ref: "vault/github-app", used: 10, rotated: NOW - 6 * DAY, kind: "app-creds" },
  { ref: "vault/registry-pull", used: 3, rotated: NOW - 2 * DAY, kind: "token" },
  { ref: "vault/acme-account", used: 1, rotated: NOW - 18 * DAY, kind: "key" },
];

export const RUDDER: RudderData = {
  NOW, MIN, HR, DAY,
  repos, groups, hosts, jobs, activity, reconcile, channels, secrets, manifestYaml, rudderYaml,
};
