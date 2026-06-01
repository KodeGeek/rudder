/* Rudder — Settings (read-only, Git-declared) + Git-connection onboarding */
import React from "react";
import { Card, Btn, StatusPill } from "../components/ui";
import { Icons, type IconFn } from "../components/icons";
import { relTime } from "../lib/format";
import { RUDDER } from "../data/mock";
import { getConfig } from "../lib/config";
import type { NavFn } from "../data/types";

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

const CHAN_ICON: Record<string, IconFn> = { slack: Icons.bell, email: Icons.bell, webhook: Icons.link, telegram: Icons.bell };

interface ReachSrc { url?: string; proxy: string; health: string; live: boolean; }

// live reachability probe for an external source (no-op in demo mode)
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
  demo:     { s: "never", label: "Demo data" },
  checking: { s: "running", label: "Checking…" },
  ok:       { s: "ok", label: "Reachable" },
  fail:     { s: "fail", label: "Unreachable" },
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

const SECRET_KIND: Record<string, string> = {
  "ssh-key":   "SSH key",
  "token":     "Token",
  "app-creds": "App creds",
  "key":       "Key",
};

function VaultBlock() {
  const D = RUDDER;
  const cfg = getConfig();
  const live = cfg.dataSource === "live";
  const vault: ReachSrc = { ...cfg.vault, live };
  const state = useReach(vault);
  const pill = REACH_PILL[state];
  return (
    <Card style={{ marginBottom: "var(--gap)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--surface-2)", border: "1px solid var(--line-soft)", display: "grid", placeItems: "center", color: "var(--text-2)", flexShrink: 0 }}>
          <Icons.key size={17} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: "var(--fs-md)", fontWeight: 640 }}>Vault</h3>
            <StatusPill s={pill.s} size="sm">{pill.label}</StatusPill>
          </div>
          <p style={{ margin: "3px 0 0", fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>
            Encrypted secrets + SSH private keys used to authenticate Ansible runs. Values never leave Vault — Rudder references and rotates them.
          </p>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 5 }}>
            {vault.url ? vault.url : "openbao://vault:8200 (bundled)"} <span style={{ color: "var(--line)" }}>·</span> proxied via {vault.proxy}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {D.secrets.map((s, i, arr) => (
          <SettingsRow key={s.ref} last={i === arr.length - 1}>
            <Icons.key size={16} style={{ color: s.warn ? "var(--warn)" : "var(--text-3)" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: "var(--fs-sm)", color: "var(--text)" }}>{s.ref}</span>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", padding: "1px 6px", borderRadius: 4, color: "var(--text-3)", background: "var(--surface-3)", border: "1px solid var(--line-soft)" }}>{SECRET_KIND[s.kind] || s.kind}</span>
                <span className="mono" style={{ fontSize: 11, letterSpacing: 1, color: "var(--text-faint)" }}>••••••••</span>
              </div>
              <div style={{ fontSize: 11.5, color: s.warn ? "var(--warn)" : "var(--text-faint)", marginTop: 2 }}>
                used by {s.used} jobs · rotated {relTime(s.rotated)}{s.warn ? " — due for rotation" : ""}
              </div>
            </div>
            <Btn size="sm" kind="ghost" icon={Icons.refresh}>Rotate</Btn>
          </SettingsRow>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 12, fontSize: 11.5, color: "var(--text-faint)" }}>
        <Icons.git size={13} />
        <span>Secret references are declared in <span className="mono" style={{ color: "var(--text-3)" }}>rudder.yml</span>; values are written to Vault out-of-band (never via this UI). Rotation is an explicit operation.</span>
      </div>
    </Card>
  );
}

function ObservabilityBlock() {
  const cfg = getConfig();
  const live = cfg.dataSource === "live";
  const mk = (k: "prometheus" | "loki" | "controlPlane"): ReachSrc => ({ ...cfg[k], live });
  return (
    <Block title="Observability sources"
      desc={live ? "Live mode — the UI binds to these external endpoints (proxied server-side)." : "Demo mode — running on built-in sample data. Set DATA_SOURCE=live to bind real endpoints."}
      icon={Icons.activity}>
      <SourceRow icon={Icons.activity} name="Prometheus — metrics (§5.2)" src={mk("prometheus")} />
      <SourceRow icon={Icons.terminal} name="Loki — run logs (§5.3)" src={mk("loki")} />
      <SourceRow icon={Icons.refresh} name="Control plane — API" src={mk("controlPlane")} last />
    </Block>
  );
}

export function SettingsScreen({ nav }: { nav: NavFn }) {
  const D = RUDDER;
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
          All settings are declared in <span className="mono" style={{ color: "var(--text)" }}>rudder.yml</span> in Git. This screen is read-only — edit the file and open a PR to change anything.
        </span>
        <Btn size="sm" kind="ghost" iconR={Icons.ext} onClick={() => nav("manifest")}>View / edit in Git</Btn>
      </div>

      <Block title="Git connections" desc="Repos that drive the schedule. Git is the source of truth." icon={Icons.git}>
        {[D.repos.github, D.repos.ado].map((r, i, arr) => (
          <SettingsRow key={r.slug} last={i === arr.length - 1}>
            {r.provider === "ado" ? <Icons.azure size={18} style={{ color: "var(--text-2)" }} /> : <Icons.github size={18} style={{ color: "var(--text-2)" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: "var(--fs-sm)", color: "var(--text)", fontWeight: 550 }}>{r.slug}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>branch {r.branch} · last commit {relTime(r.lastCommit.at)}</div>
            </div>
            <StatusPill s="ok" size="sm">synced</StatusPill>
          </SettingsRow>
        ))}
        <div style={{ marginTop: 12 }}>
          <Btn kind="solid" icon={Icons.plus} onClick={() => nav("connect")}>Connect a repository</Btn>
          <span style={{ fontSize: 11.5, color: "var(--text-faint)", marginLeft: 12 }}>first-time bootstrap only</span>
        </div>
      </Block>

      <ObservabilityBlock />

      <VaultBlock />

      <Block title="Alerting" desc="Notify on failure or stale jobs." icon={Icons.bell}>
        {D.channels.map((c, i, arr) => {
          const I = CHAN_ICON[c.type] || Icons.bell;
          return (
            <SettingsRow key={c.label} last={i === arr.length - 1}>
              <I size={16} style={{ color: "var(--text-3)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--text)", fontWeight: 550 }}>{c.label}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>
                  {c.type} · {c.target} · on {c.on.join(", ")}
                </div>
              </div>
              <StatusPill s={c.enabled ? "ok" : "never"} size="sm">{c.enabled ? "On" : "Off"}</StatusPill>
            </SettingsRow>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 12, fontSize: 11.5, color: "var(--text-faint)" }}>
          <Icons.git size={13} /><span>Channels are declared under <span className="mono" style={{ color: "var(--text-3)" }}>alerts:</span> in rudder.yml — edit in Git to add or change.</span>
        </div>
      </Block>

      <Block title="Reconcile loop" desc="How often Rudder pulls Git and regenerates the schedule." icon={Icons.refresh}>
        <SettingsRow last>
          <Icons.clock size={16} style={{ color: "var(--text-3)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--fs-sm)", color: "var(--text)", fontWeight: 550 }}>Pull interval</div>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>last reconcile {relTime(D.reconcile.lastAt)} · next {relTime(D.reconcile.nextAt)}</div>
          </div>
          <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text)" }}>{D.reconcile.intervalMin}<span style={{ fontSize: "var(--fs-sm)", color: "var(--text-3)", fontWeight: 400 }}> min</span></span>
        </SettingsRow>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 12, fontSize: 11.5, color: "var(--text-faint)" }}>
          <Icons.git size={13} /><span>Set under <span className="mono" style={{ color: "var(--text-3)" }}>reconcile.interval</span> in rudder.yml.</span>
        </div>
      </Block>
    </div>
  );
}

/* ========== ONBOARDING: connect a repo ========== */
export function ConnectScreen({ nav }: { nav: NavFn }) {
  const [step, setStep] = React.useState(0);
  const [prov, setProv] = React.useState("github");
  const [repo, setRepo] = React.useState("");
  const [branch, setBranch] = React.useState("main");
  const [syncing, setSyncing] = React.useState(false);
  const steps = ["Provider", "Repository", "First sync"];

  React.useEffect(() => {
    if (step === 2) { setSyncing(true); const t = setTimeout(() => setSyncing(false), 2200); return () => clearTimeout(t); }
  }, [step]);

  const sample = prov === "github" ? "northwind-infra/fleet-automation" : "northwind/Platform/identity-automation";

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "40px 30px 60px", animation: "screen-in .35s cubic-bezier(.2,.7,.2,1) both" }}>
      <button onClick={() => nav("settings")} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: 0, marginBottom: 20 }}>
        <Icons.chevL size={15} /> Settings
      </button>

      {/* stepper */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 26 }}>
        {steps.map((s, i) => (
          <React.Fragment key={s}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 24, height: 24, borderRadius: 99, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600,
                background: i <= step ? "var(--accent)" : "var(--surface-3)", color: i <= step ? "#fff" : "var(--text-faint)" }}>
                {i < step ? <Icons.check size={13} sw={2.4} /> : i + 1}
              </span>
              <span style={{ fontSize: "var(--fs-sm)", color: i <= step ? "var(--text)" : "var(--text-faint)", fontWeight: i === step ? 600 : 500 }}>{s}</span>
            </div>
            {i < steps.length - 1 && <span style={{ flex: 1, height: 1, background: "var(--line)" }} />}
          </React.Fragment>
        ))}
      </div>

      <Card>
        {step === 0 && (
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: "var(--fs-xl)", fontWeight: 640 }}>Connect your Git provider</h2>
            <p style={{ margin: "0 0 18px", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>Rudder reads your job manifest from here and commits schedule changes back.</p>
            {([["github", "GitHub", Icons.github, "github.com or GitHub Enterprise"], ["ado", "Azure DevOps", Icons.azure, "dev.azure.com or Azure DevOps Server"]] as const).map(([k, t, I, d]) => (
              <button key={k} onClick={() => setProv(k)}
                style={{ display: "flex", alignItems: "center", gap: 13, width: "100%", textAlign: "left", padding: "14px 15px", marginBottom: 10, borderRadius: "var(--r-md)",
                  border: "1px solid", borderColor: prov === k ? "var(--accent-line)" : "var(--line)", background: prov === k ? "var(--accent-soft)" : "transparent" }}>
                <I size={22} style={{ color: "var(--text)" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>{t}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{d}</div>
                </div>
                <span style={{ width: 18, height: 18, borderRadius: 99, border: "2px solid", borderColor: prov === k ? "var(--accent)" : "var(--line)", display: "grid", placeItems: "center" }}>
                  {prov === k && <span style={{ width: 9, height: 9, borderRadius: 99, background: "var(--accent)" }} />}
                </span>
              </button>
            ))}
            <Btn kind="primary" full iconR={Icons.chevR} onClick={() => setStep(1)} style={{ marginTop: 8 }}>Continue</Btn>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: "var(--fs-xl)", fontWeight: 640 }}>Point at your repository</h2>
            <p style={{ margin: "0 0 18px", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>The repo containing your job manifest and playbooks.</p>
            <label style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 7 }}>Repository</label>
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder={sample} spellCheck={false} className="mono focusable"
              style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--line)", color: "var(--text)", fontSize: "var(--fs-sm)", marginBottom: 16 }} />
            <label style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 7 }}>Branch</label>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} spellCheck={false} className="mono focusable"
              style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--line)", color: "var(--text)", fontSize: "var(--fs-sm)", marginBottom: 16 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--line-soft)", marginBottom: 18 }}>
              <Icons.key size={15} style={{ color: "var(--text-3)" }} />
              <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>Auth uses a deploy key / app token stored as a secret reference — never shown here.</span>
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <Btn kind="ghost" onClick={() => setStep(0)}>Back</Btn>
              <span style={{ flex: 1 }} />
              <Btn kind="primary" iconR={Icons.chevR} onClick={() => setStep(2)}>Connect & sync</Btn>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            {syncing ? (
              <>
                <div style={{ width: 50, height: 50, margin: "0 auto 18px", color: "var(--accent-text)" }}>
                  <Icons.refresh size={50} sw={1.6} style={{ animation: "spin 1s linear infinite" }} />
                </div>
                <h2 style={{ margin: "0 0 6px", fontSize: "var(--fs-xl)", fontWeight: 640 }}>Cloning & rendering schedule…</h2>
                <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-3)" }} className="mono">{repo || sample} · {branch}</p>
              </>
            ) : (
              <>
                <div style={{ width: 52, height: 52, margin: "0 auto 16px", borderRadius: 15, background: "var(--ok-dim)", color: "var(--ok)", display: "grid", placeItems: "center" }}>
                  <Icons.check size={28} sw={2.2} />
                </div>
                <h2 style={{ margin: "0 0 6px", fontSize: "var(--fs-xl)", fontWeight: 640 }}>Connected · 8 jobs discovered</h2>
                <p style={{ margin: "0 0 20px", fontSize: "var(--fs-sm)", color: "var(--text-3)", maxWidth: 380, marginInline: "auto" }}>
                  Rudder rendered the manifest into a schedule and will reconcile every 15 minutes.
                </p>
                <div style={{ display: "flex", gap: 9, justifyContent: "center" }}>
                  <Btn kind="primary" iconR={Icons.chevR} onClick={() => nav("overview")}>Go to dashboard</Btn>
                  <Btn kind="ghost" onClick={() => nav("jobs")}>View jobs</Btn>
                </div>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
