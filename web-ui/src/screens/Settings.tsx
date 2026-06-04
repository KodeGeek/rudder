/* Rudder — Settings (Git connections, observability, vault, alerts, reconcile)
   + the Connect-a-repository flow (POSTs to the control-plane). */
import React from "react";
import { Card, Btn, StatusPill } from "../components/ui";
import { EmptyState } from "../components/EmptyState";
import { Icons, type IconFn } from "../components/icons";
import { relTime } from "../lib/format";
import { getConfig } from "../lib/config";
import { useData } from "../lib/data";
import { api } from "../lib/api";
import type { NavFn, RouteParams } from "../data/types";

function SettingsRow({ children, last }: { children?: React.ReactNode; last?: boolean }) {
  return <div style={{ padding: "14px 0", borderBottom: last ? "none" : "1px solid var(--line-soft)", display: "flex", alignItems: "center", gap: 14 }}>{children}</div>;
}
function Block({ title, desc, children, icon: I }:
  { title: React.ReactNode; desc?: React.ReactNode; children?: React.ReactNode; icon?: IconFn }) {
  return (
    <Card style={{ marginBottom: "var(--gap)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
        {I && <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--surface-2)", border: "1px solid var(--line-soft)", display: "grid", placeItems: "center", color: "var(--text-2)", flexShrink: 0 }}><I size={17} /></div>}
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: "var(--fs-md)", fontWeight: 640 }}>{title}</h3>
          {desc && <p style={{ margin: "3px 0 0", fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>{desc}</p>}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </Card>
  );
}

const CHAN_ICON: Record<string, IconFn> = { slack: Icons.bell, email: Icons.bell, webhook: Icons.link, telegram: Icons.bell, log: Icons.terminal };

interface ReachSrc { url?: string; proxy: string; health: string; live: boolean }
function useReach(src: ReachSrc) {
  const [state, setState] = React.useState<string>(src.live ? "checking" : "demo");
  React.useEffect(() => {
    if (!src.live) { setState("demo"); return; }
    let alive = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    setState("checking");
    fetch(src.proxy + src.health, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => { if (alive) setState(r.ok ? "ok" : "fail"); })
      .catch(() => { if (alive) setState("fail"); })
      .finally(() => clearTimeout(timer));
    return () => { alive = false; ctrl.abort(); clearTimeout(timer); };
  }, [src.proxy, src.live]);
  return state;
}
const REACH_PILL: Record<string, { s: string; label: string }> = {
  demo: { s: "never", label: "Demo data" },
  checking: { s: "running", label: "Checking…" },
  ok: { s: "ok", label: "Reachable" },
  fail: { s: "fail", label: "Unreachable" },
};

function SourceRow({ icon: I, name, src, last }: { icon: IconFn; name: React.ReactNode; src: ReachSrc; last?: boolean }) {
  const state = useReach(src);
  const pill = REACH_PILL[state];
  return (
    <SettingsRow last={last}>
      <I size={16} style={{ color: "var(--text-3)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--text)", fontWeight: 550 }}>{name}</div>
        <div className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {src.url ? src.url : "not configured"} <span style={{ color: "var(--line)" }}>·</span> proxied via {src.proxy}
        </div>
      </div>
      <StatusPill s={pill.s} size="sm">{pill.label}</StatusPill>
    </SettingsRow>
  );
}

const SECRET_KIND: Record<string, string> = { "ssh-key": "SSH key", token: "Token", "app-creds": "App creds", key: "Key" };

export function SettingsScreen({ nav }: { nav: NavFn }) {
  const { repos, secrets, channels, reconcile, removeRepo, flash, isAdmin, canWrite } = useData();
  const testChannel = async (type: string, target: string) => {
    try {
      const r = await api.testChannel(type, target);
      flash(r.sent ? "Test notification sent" : "Channel has no usable target", r.sent ? "ok" : "fail");
    } catch {
      flash("Test notification failed", "fail");
    }
  };
  const cfg = getConfig();
  const live = cfg.dataSource === "live";
  const vaultSrc: ReachSrc = { ...cfg.vault, live };
  const vaultState = useReach(vaultSrc);
  const mk = (k: "prometheus" | "loki" | "controlPlane"): ReachSrc => ({ ...cfg[k], live });

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "22px 30px 60px", animation: "screen-in .35s cubic-bezier(.2,.7,.2,1) both" }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: "var(--fs-xl)", fontWeight: 660, letterSpacing: "-.01em" }}>Settings</h1>
        <p style={{ margin: "4px 0 0", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>Connections, secrets, alerts and the reconcile loop.</p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "12px 16px", borderRadius: "var(--r-md)",
        background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
        <Icons.git size={16} style={{ color: "var(--accent-text)", flexShrink: 0 }} />
        <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)", flex: 1 }}>
          Operational settings live in <span className="mono" style={{ color: "var(--text)" }}>rudder.yml</span> in your repo. Connect repositories below; the rest is read-only — edit the file and open a PR to change it.
        </span>
      </div>

      <Block title="Git connections" desc="Repos that drive the schedule. Git is the source of truth." icon={Icons.git}>
        {repos.length ? repos.map((r, i, arr) => (
          <SettingsRow key={r.id} last={i === arr.length - 1}>
            {r.provider === "ado" ? <Icons.azure size={18} style={{ color: "var(--text-2)" }} /> : <Icons.github size={18} style={{ color: "var(--text-2)" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: "var(--fs-sm)", color: "var(--text)", fontWeight: 550 }}>{r.slug}</div>
              <div style={{ fontSize: 11.5, color: r.error ? "var(--fail)" : "var(--text-faint)", marginTop: 2 }}>
                {r.error ? `sync failed: ${r.error}` : `branch ${r.branch} · added ${relTime(r.addedAt)}`}
              </div>
            </div>
            <StatusPill s={r.error ? "fail" : "ok"} size="sm">{r.error ? "Error" : "connected"}</StatusPill>
            {r.error && (
              <Btn size="sm" kind="solid" icon={Icons.git}
                onClick={() => nav("connect", { provider: r.provider, url: r.url, branch: r.branch, prompt: true })}>
                Fix auth
              </Btn>
            )}
            {isAdmin && <Btn size="sm" kind="ghost" icon={Icons.key} onClick={() => nav("credentials", { rid: r.id })}>Credentials</Btn>}
            {isAdmin && <Btn size="sm" kind="ghost" danger icon={Icons.x} onClick={() => removeRepo(r.id)}>Remove</Btn>}
          </SettingsRow>
        )) : (
          <div style={{ padding: "8px 0 4px", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>No repositories connected yet.</div>
        )}
        {isAdmin && (
          <div style={{ marginTop: 12 }}>
            <Btn kind="primary" icon={Icons.plus} onClick={() => nav("connect")}>Connect a repository</Btn>
          </div>
        )}
      </Block>

      <Block title="Observability sources"
        desc={live ? "Live mode — bound to these endpoints (proxied server-side)." : "Demo mode — set DATA_SOURCE=live to bind real endpoints."}
        icon={Icons.activity}>
        <SourceRow icon={Icons.activity} name="Prometheus — metrics" src={mk("prometheus")} />
        <SourceRow icon={Icons.terminal} name="Loki — run logs" src={mk("loki")} />
        <SourceRow icon={Icons.refresh} name="Control plane — API" src={mk("controlPlane")} last />
      </Block>

      <Card style={{ marginBottom: "var(--gap)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--surface-2)", border: "1px solid var(--line-soft)", display: "grid", placeItems: "center", color: "var(--text-2)", flexShrink: 0 }}>
            <Icons.key size={17} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: "var(--fs-md)", fontWeight: 640 }}>Vault</h3>
              <StatusPill s={REACH_PILL[vaultState].s} size="sm">{REACH_PILL[vaultState].label}</StatusPill>
            </div>
            <p style={{ margin: "3px 0 0", fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>
              Encrypted secrets + SSH private keys used to authenticate Ansible runs. Values never leave Vault — Rudder references and rotates them.
            </p>
            <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 5 }}>
              {vaultSrc.url ? vaultSrc.url : "openbao://vault:8200 (bundled)"} <span style={{ color: "var(--line)" }}>·</span> proxied via {vaultSrc.proxy}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          {secrets.length ? secrets.map((s, i, arr) => (
            <SettingsRow key={s.ref} last={i === arr.length - 1}>
              <Icons.key size={16} style={{ color: s.warn ? "var(--warn)" : "var(--text-3)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: "var(--fs-sm)", color: "var(--text)" }}>{s.ref}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", padding: "1px 6px", borderRadius: 4, color: "var(--text-3)", background: "var(--surface-3)", border: "1px solid var(--line-soft)" }}>{SECRET_KIND[s.kind] || s.kind}</span>
                  <span className="mono" style={{ fontSize: 11, letterSpacing: 1, color: "var(--text-faint)" }}>••••••••</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>referenced by jobs · rotated {relTime(s.rotated)}</div>
              </div>
              <Btn size="sm" kind="ghost" icon={Icons.refresh}>Rotate</Btn>
            </SettingsRow>
          )) : <div style={{ padding: "6px 0", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>No secret references yet.</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 12, fontSize: 11.5, color: "var(--text-faint)" }}>
          <Icons.git size={13} />
          <span>Secret references are declared in <span className="mono" style={{ color: "var(--text-3)" }}>rudder.yml</span>; values are written to Vault out-of-band (never via this UI).</span>
        </div>
      </Card>

      <Block title="Alerting" desc="Notify on failure or stale jobs (declared in rudder.yml)." icon={Icons.bell}>
        {channels.length ? channels.map((c, i, arr) => {
          const I = CHAN_ICON[c.type] || Icons.bell;
          return (
            <SettingsRow key={i} last={i === arr.length - 1}>
              <I size={16} style={{ color: "var(--text-3)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--text)", fontWeight: 550 }}>{c.label}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>{c.type} · on {c.on.join(", ") || "—"}</div>
              </div>
              {canWrite && <Btn kind="bare" size="sm" icon={Icons.bell} onClick={() => testChannel(c.type, c.target)}>Test</Btn>}
              <StatusPill s={c.enabled ? "ok" : "never"} size="sm">{c.enabled ? "On" : "Off"}</StatusPill>
            </SettingsRow>
          );
        }) : <div style={{ padding: "6px 0", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>No alert channels declared.</div>}
      </Block>

      <Block title="Reconcile loop" desc="How often Rudder pulls Git and regenerates the schedule." icon={Icons.refresh}>
        <SettingsRow last>
          <Icons.clock size={16} style={{ color: "var(--text-3)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--fs-sm)", color: "var(--text)", fontWeight: 550 }}>Pull interval</div>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>last reconcile {relTime(reconcile?.lastAt)} · next {relTime(reconcile?.nextAt)}</div>
          </div>
          <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text)" }}>{reconcile?.intervalMin ?? "—"}<span style={{ fontSize: "var(--fs-sm)", color: "var(--text-3)", fontWeight: 400 }}> min</span></span>
        </SettingsRow>
      </Block>
    </div>
  );
}

/* ========== ONBOARDING: connect a repo (real — POSTs to the control-plane) ========== */
const AUTH_METHODS = [
  ["none", "Public"],
  ["token", "Access token"],
  ["deploykey", "Deploy key"],
] as const;

export function ConnectScreen({ nav, params }: { nav: NavFn; params?: RouteParams }) {
  const { addRepo, info } = useData();
  const [prov, setProv] = React.useState<string>(params?.provider || "git");
  const [repo, setRepo] = React.useState<string>(params?.url || "");
  const [branch, setBranch] = React.useState<string>(params?.branch || "main");
  // auth: "none" (public) · "token" (PAT — GitHub or Azure DevOps) · "deploykey" (SSH, GitHub)
  const [method, setMethod] = React.useState<string>(
    params?.prompt ? (params?.provider === "ado" ? "token" : "deploykey") : "none"
  );
  const [token, setToken] = React.useState("");
  const [vaultPass, setVaultPass] = React.useState("");
  const [pubKey, setPubKey] = React.useState("");
  const [genBusy, setGenBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const tokenRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (prov === "git" && info?.bundledRepoUrl && !repo && !params?.url) setRepo(info.bundledRepoUrl);
  }, [prov, info, repo, params]);
  React.useEffect(() => { if (method === "token") tokenRef.current?.focus(); }, [method]);

  const isAuthErr = (e: string) =>
    /could not read username|authentication failed|terminal prompts disabled|\b403\b|denied|unauthorized|invalid username or password|permission denied|host key/i.test(e);

  const placeholder = prov === "github" ? "https://github.com/org/repo.git"
    : prov === "ado" ? "https://dev.azure.com/org/project/_git/repo"
    : (info?.bundledRepoUrl || "http://gitea:3000/org/repo.git");

  const genKey = async () => {
    const url = (repo || "").trim();
    if (!url) { setErr("Enter the repository URL first."); return; }
    setGenBusy(true); setErr(null);
    try {
      const r = await api.deployKey({ provider: prov, url });
      setPubKey(r.publicKey);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to generate deploy key");
    } finally {
      setGenBusy(false);
    }
  };

  const copyKey = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(pubKey).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };

  const connect = async () => {
    const url = (repo || "").trim();
    if (!url) { setErr("Enter a repository URL."); return; }
    if (method === "deploykey" && !pubKey) { setErr("Generate the deploy key and add it to your repo first."); return; }
    setBusy(true); setErr(null);
    try {
      const rec = await addRepo({
        provider: prov, url, branch: branch.trim() || "main",
        authMethod: method, token: method === "token" ? (token.trim() || undefined) : undefined,
        vaultPass: vaultPass.trim() || undefined,
      });
      if (rec && rec.error) {
        setBusy(false);
        if (isAuthErr(rec.error)) {
          if (method === "none") setMethod(prov === "ado" ? "token" : "deploykey");
          setErr(method === "deploykey"
            ? "Still can't authenticate — make sure the deploy key above is added to the repo with read access."
            : "This repository is private — add credentials below and retry.");
        } else {
          setErr(rec.error);
        }
        return;
      }
      nav("overview");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to connect repository");
      setBusy(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", height: 40, padding: "0 12px", borderRadius: "var(--r-md)", background: "var(--surface-2)",
    border: "1px solid var(--line)", color: "var(--text)", fontSize: "var(--fs-sm)", marginBottom: 16,
  };
  const connectLabel = busy ? "Connecting…" : method === "deploykey" ? "I've added the key — connect" : "Connect & sync";

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "40px 30px 60px", animation: "screen-in .35s cubic-bezier(.2,.7,.2,1) both" }}>
      <button onClick={() => nav("settings")} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: 0, marginBottom: 20 }}>
        <Icons.chevL size={15} /> Settings
      </button>

      <Card>
        <h2 style={{ margin: "0 0 4px", fontSize: "var(--fs-xl)", fontWeight: 640 }}>Connect a repository</h2>
        <p style={{ margin: "0 0 18px", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>Rudder clones it, reads <span className="mono">ansible/jobs.yml</span>, and renders the schedule.</p>

        <label style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 7 }}>Provider</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {([["git", "Git URL", Icons.git], ["github", "GitHub", Icons.github], ["ado", "Azure DevOps", Icons.azure]] as const).map(([k, t, I]) => (
            <button key={k} onClick={() => { setProv(k); setRepo(""); setPubKey(""); }}
              style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, justifyContent: "center", padding: "10px 8px", borderRadius: "var(--r-md)",
                border: "1px solid", borderColor: prov === k ? "var(--accent-line)" : "var(--line)", background: prov === k ? "var(--accent-soft)" : "transparent",
                color: prov === k ? "var(--accent-text)" : "var(--text-2)", fontSize: "var(--fs-xs)", fontWeight: 600 }}>
              <I size={16} /> {t}
            </button>
          ))}
        </div>

        <label style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 7 }}>Repository URL</label>
        <input value={repo} onChange={(e) => { setRepo(e.target.value); setPubKey(""); }} placeholder={placeholder} spellCheck={false} className="mono focusable" style={inputStyle} />

        <label style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 7 }}>Branch</label>
        <input value={branch} onChange={(e) => setBranch(e.target.value)} spellCheck={false} className="mono focusable" style={inputStyle} />

        {/* ── Authentication ── */}
        <label style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 7 }}>Authentication</label>
        <div style={{ display: "inline-flex", padding: 3, background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", gap: 2, marginBottom: 14 }}>
          {AUTH_METHODS.map(([k, t]) => (
            <button key={k} onClick={() => setMethod(k)}
              style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: method === k ? "var(--surface-3)" : "transparent",
                color: method === k ? "var(--text)" : "var(--text-3)", fontSize: "var(--fs-xs)", fontWeight: method === k ? 600 : 500 }}>
              {t}
            </button>
          ))}
        </div>

        {method === "none" && (
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)", marginBottom: 18 }}>
            For a public repository, no credentials are needed.
          </div>
        )}

        {method === "token" && (
          <>
            <input ref={tokenRef} value={token} onChange={(e) => setToken(e.target.value)} type="password"
              placeholder={prov === "ado" ? "Azure DevOps PAT" : "ghp_… personal access token"} spellCheck={false} className="mono focusable"
              onKeyDown={(e) => { if (e.key === "Enter") connect(); }} style={{ ...inputStyle, marginBottom: 10 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--line-soft)", marginBottom: 18 }}>
              <Icons.key size={15} style={{ color: "var(--text-3)", flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>Stored in Vault, never shown again, never committed. Use a fine-grained, read-only token. Works for GitHub and Azure DevOps.</span>
            </div>
          </>
        )}

        {method === "deploykey" && (
          <div style={{ marginBottom: 18 }}>
            {!pubKey ? (
              <>
                <Btn kind="solid" icon={genBusy ? Icons.refresh : Icons.key} disabled={genBusy || !repo.trim()} onClick={genKey}>
                  {genBusy ? "Generating…" : "Generate deploy key"}
                </Btn>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>Rudder generates an SSH keypair and keeps the private half in Vault.</div>
              </>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>Add this read-only deploy key to your repo</span>
                  <button onClick={copyKey} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: copied ? "var(--ok)" : "var(--text-3)", background: "none", border: "none" }}>
                    {copied ? <Icons.check size={13} /> : <Icons.copy size={13} />}{copied ? "copied" : "copy"}
                  </button>
                </div>
                <textarea readOnly value={pubKey} spellCheck={false} className="mono"
                  style={{ width: "100%", height: 74, padding: "8px 12px", borderRadius: "var(--r-md)", background: "var(--term-bg)", border: "1px solid var(--accent-line)", color: "var(--text-2)", fontSize: 11.5, lineHeight: 1.5, resize: "none", marginBottom: 10 }} />
                <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--line-soft)" }}>
                  <Icons.github size={15} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                    GitHub → your repo → <strong>Settings → Deploy keys → Add deploy key</strong>. Paste this and leave “Allow write access” <strong>unchecked</strong>. Then click connect. (Azure DevOps: add under User settings → SSH public keys, or use a PAT instead.)
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Ansible Vault password (for repos with ansible-vault encrypted vars) ── */}
        <label style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 7 }}>
          Ansible Vault password <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>· optional</span>
        </label>
        <input value={vaultPass} onChange={(e) => setVaultPass(e.target.value)} type="password"
          placeholder="decrypts group_vars/**/vault.yml etc." spellCheck={false} className="mono focusable" style={{ ...inputStyle, marginBottom: 10 }} />
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--line-soft)", marginBottom: 18 }}>
          <Icons.key size={15} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>If your repo uses <span className="mono">ansible-vault</span> (e.g. encrypted <span className="mono">group_vars</span>), enter the vault password. Stored in Vault and passed to runs via <span className="mono">--vault-password-file</span> — never shown or committed.</span>
        </div>

        {err && <div style={{ fontSize: "var(--fs-xs)", color: "var(--fail)", marginBottom: 12 }}>{err}</div>}

        <div style={{ display: "flex", gap: 9 }}>
          <Btn kind="ghost" onClick={() => nav("settings")}>Cancel</Btn>
          <span style={{ flex: 1 }} />
          <Btn kind="primary" icon={busy ? Icons.refresh : undefined} iconR={busy ? undefined : Icons.chevR}
            disabled={busy || (method === "deploykey" && !pubKey)} onClick={connect}>
            {connectLabel}
          </Btn>
        </div>
      </Card>
    </div>
  );
}

/* ========== Per-repo run/decrypt credentials (write-only) ========== */
export function CredentialsScreen({ nav, params }: { nav: NavFn; params?: RouteParams }) {
  const { repos, flash, refresh } = useData();
  const rid = params?.rid || "";
  const repo = repos.find((r) => r.id === rid);
  const [hostKey, setHostKey] = React.useState("");
  const [vaultPass, setVaultPass] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  if (!repo) {
    return <EmptyState icon={Icons.git} title="Repository not found"
      body="It may have been removed." actionLabel="Back to settings" onAction={() => nav("settings")} />;
  }

  const save = async () => {
    if (!hostKey.trim() && !vaultPass.trim()) {
      setErr("Nothing to update — paste a key or password to set or replace it.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      await api.setCredentials({
        rid, hostKey: hostKey.trim() || undefined, vaultPass: vaultPass.trim() || undefined,
      });
      flash("Credentials saved to Vault", "ok");
      await refresh();
      nav("settings");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save credentials");
      setBusy(false);
    }
  };

  const Status = ({ on }: { on?: boolean }) => (
    <StatusPill s={on ? "ok" : "never"} size="sm">{on ? "Configured" : "Not set"}</StatusPill>
  );

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "40px 30px 60px", animation: "screen-in .35s cubic-bezier(.2,.7,.2,1) both" }}>
      <button onClick={() => nav("settings")} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: 0, marginBottom: 20 }}>
        <Icons.chevL size={15} /> Settings
      </button>

      <Card>
        <h2 style={{ margin: "0 0 4px", fontSize: "var(--fs-xl)", fontWeight: 640 }}>Run credentials</h2>
        <p style={{ margin: "0 0 4px", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>
          <span className="mono" style={{ color: "var(--text-2)" }}>{repo.slug}</span>
        </p>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: "var(--r-md)",
          background: "var(--surface-2)", border: "1px solid var(--line-soft)", margin: "12px 0 20px" }}>
          <Icons.key size={15} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
            Write-only. These are stored in Vault and used only by the control-plane at run time — <strong>never shown again or returned to the UI</strong>. Paste a value to set it, or to <strong>replace</strong> the existing one. Leave blank to keep the current value.
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
          <label style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>Fleet SSH private key</label>
          <Status on={repo.hostKey} />
        </div>
        <textarea value={hostKey} onChange={(e) => setHostKey(e.target.value)} spellCheck={false} className="mono focusable"
          placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n…  (paste to " + (repo.hostKey ? "replace" : "set") + ")"}
          style={{ width: "100%", height: 96, padding: "8px 12px", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--line)", color: "var(--text)", fontSize: 11.5, lineHeight: 1.5, resize: "vertical", marginBottom: 8 }} />
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 20 }}>
          The SSH key your hosts authorize (your ansible key). Runs use it against your repo's inventory.
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
          <label style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>Ansible Vault password</label>
          <Status on={repo.vaultPass} />
        </div>
        <input value={vaultPass} onChange={(e) => setVaultPass(e.target.value)} type="password" spellCheck={false} className="mono focusable"
          placeholder={"paste to " + (repo.vaultPass ? "replace" : "set")}
          style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--line)", color: "var(--text)", fontSize: "var(--fs-sm)", marginBottom: 8 }} />
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 20 }}>
          Decrypts <span className="mono">ansible-vault</span> content at run time via <span className="mono">--vault-password-file</span>.
        </div>

        {err && <div style={{ fontSize: "var(--fs-xs)", color: "var(--fail)", marginBottom: 12 }}>{err}</div>}

        <div style={{ display: "flex", gap: 9 }}>
          <Btn kind="ghost" onClick={() => nav("settings")}>Cancel</Btn>
          <span style={{ flex: 1 }} />
          <Btn kind="primary" icon={busy ? Icons.refresh : Icons.key} disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save to Vault"}
          </Btn>
        </div>
      </Card>
    </div>
  );
}
