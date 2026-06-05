/* API-key login + the auth gate that mounts before the dashboard.
   Distinguishes "unauthorized" (show login) from "backend down" (let the app
   load and show its own resilient unreachable state). */
import React from "react";
import { Logo, Btn } from "../components/ui";
import { Icons } from "../components/icons";
import { api, AuthError, setToken, clearToken } from "../lib/api";
import { getConfig } from "../lib/config";

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [key, setKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setToken(key.trim());
    try {
      await api.verify();
      onSuccess();
    } catch (e) {
      clearToken();
      setErr(e instanceof AuthError ? "Invalid API key." : "Couldn't reach the control-plane.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh", background: "var(--bg)" }}>
      <form onSubmit={submit} style={{ width: 360, maxWidth: "90vw", background: "var(--surface)",
        border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: "28px 26px",
        boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}><Logo size={30} sub /></div>
        <label style={{ display: "block", fontSize: "var(--fs-sm)", color: "var(--text-2)", marginBottom: 8 }}>
          API key
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-2)",
          border: `1px solid ${err ? "var(--fail)" : "var(--line)"}`, borderRadius: "var(--r-md)", padding: "0 10px" }}>
          <Icons.key size={15} style={{ color: "var(--text-3)", flexShrink: 0 }} />
          <input
            type="password" autoFocus value={key} onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your RUDDER_API_KEY"
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text)",
              fontSize: "var(--fs-sm)", padding: "11px 0", fontFamily: "var(--font-mono)" }} />
        </div>
        {err && <div style={{ fontSize: "var(--fs-xs)", color: "var(--fail)", marginTop: 8 }}>{err}</div>}
        <Btn kind="primary" full style={{ marginTop: 16 }} disabled={busy || !key.trim()}>
          {busy ? "Verifying…" : "Sign in"}
        </Btn>
        <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 14, lineHeight: 1.5 }}>
          The key is set on the server as <span className="mono">RUDDER_API_KEY</span>. For SSO,
          front Rudder with an authenticating reverse proxy.
        </p>
      </form>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh", background: "var(--bg)",
      color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>{children}</div>
  );
}

/** Verifies auth before mounting the dashboard. Only a real 401 shows the login;
    a backend outage falls through so the app's own resilient UI can render. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const live = getConfig().dataSource === "live";
  const [state, setState] = React.useState<"checking" | "ok" | "login">(live ? "checking" : "ok");

  const check = React.useCallback(() => {
    if (!live) { setState("ok"); return; }
    api.verify()
      .then(() => setState("ok"))
      .catch((e) => setState(e instanceof AuthError ? "login" : "ok"));
  }, [live]);

  React.useEffect(() => { check(); }, [check]);

  if (state === "checking") return <Centered>Loading…</Centered>;
  if (state === "login") return <LoginScreen onSuccess={check} />;
  return <>{children}</>;
}
