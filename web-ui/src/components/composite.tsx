/* Rudder — composite components: LogViewer, RunTimeline, Toast */
import React from "react";
import { Icons } from "./icons";
import { st, StatusDot } from "./ui";
import { clockTime, relTime, dur } from "../lib/format";
import { NOW } from "../data/mock";
import type { Job, Run } from "../data/types";

/* ============ LOG VIEWER (terminal drill-down, §5.3) ============ */
const LOG_COL: Record<string, string> = {
  ok: "var(--ok)", chg: "var(--warn)", err: "var(--fail)",
  task: "var(--text-3)", play: "var(--accent-text)", recap: "var(--text-2)",
};
export function LogViewer({ run, job, height = 340, dense }:
  { run: Run | null | undefined; job?: Job; height?: number; dense?: boolean }) {
  const [wrap, setWrap] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const lines = run?.log || [];

  React.useEffect(() => {
    if (run?.streaming && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [run]);

  const copy = () => {
    const txt = lines.map((l) => l.text).join("\n");
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };
  const startTs = run ? run.at - (run.duration || 0) * 1000 : NOW;

  return (
    <div style={{ background: "var(--term-bg)", borderRadius: "var(--r-md)", border: "1px solid var(--line)", overflow: "hidden",
      display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px 8px 12px", borderBottom: "1px solid var(--line)",
        background: "var(--surface)" }}>
        <Icons.terminal size={15} style={{ color: "var(--text-3)" }} />
        <span className="mono" style={{ fontSize: 11.5, color: "var(--text-2)" }}>
          {`{ task="${job?.name || "—"}", status="${run ? st(run.status).word : "—"}" }`}
        </span>
        <span style={{ flex: 1 }} />
        {run?.streaming && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--warn)" }}>
            <StatusDot s="running" size={6} /> streaming
          </span>
        )}
        <button onClick={() => setWrap((w) => !w)} title="Toggle wrap"
          style={{ fontSize: 11, color: wrap ? "var(--accent-text)" : "var(--text-3)", background: "none", border: "none" }}>wrap</button>
        <button onClick={copy} title="Copy log"
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: copied ? "var(--ok)" : "var(--text-3)", background: "none", border: "none" }}>
          {copied ? <Icons.check size={13} /> : <Icons.copy size={13} />}{copied ? "copied" : "copy"}
        </button>
      </div>
      <div ref={ref} style={{ height, overflow: "auto", padding: "10px 0", fontFamily: "var(--font-mono)", fontSize: dense ? 11.5 : 12.5, lineHeight: 1.65 }}>
        {lines.length === 0 && (
          <div style={{ color: "var(--text-faint)", padding: "20px 16px", fontSize: 12 }}>No log output — this job has not run yet.</div>
        )}
        {lines.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 14, padding: "0 14px", whiteSpace: wrap ? "pre-wrap" : "pre",
            background: l.t === "err" ? "var(--fail-dim)" : "transparent" }}>
            <span style={{ color: "var(--text-faint)", width: 26, textAlign: "right", flexShrink: 0, userSelect: "none", opacity: 0.7 }}>{i + 1}</span>
            <span style={{ color: "var(--text-faint)", flexShrink: 0, userSelect: "none", opacity: 0.7 }}>{clockTime(startTs + i * 900)}</span>
            <span style={{ color: LOG_COL[l.t] || "var(--text-2)", fontWeight: l.t === "recap" ? 600 : 400 }}>{l.text}</span>
          </div>
        ))}
        {run?.streaming && (
          <div style={{ padding: "2px 14px 0 54px", color: "var(--warn)" }}>
            <span style={{ display: "inline-block", width: 8, height: 15, background: "var(--warn)", animation: "pulse-dot 1s steps(2) infinite", verticalAlign: "middle" }} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ============ RUN TIMELINE (history, §4.2) ============ */
export function RunTimeline({ runs, selected, onSelect }:
  { runs: Run[]; selected?: string; onSelect: (id: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {runs.map((r, i) => {
        const active = selected === r.id;
        const m = st(r.status);
        return (
          <button key={r.id} onClick={() => onSelect(r.id)}
            style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 12, textAlign: "left",
              padding: "9px 12px", border: "none", borderLeft: `2px solid ${active ? m.c : "transparent"}`,
              background: active ? "var(--surface-2)" : "transparent", borderRadius: "0 var(--r-sm) var(--r-sm) 0", position: "relative" }}>
            <span style={{ position: "relative", display: "grid", placeItems: "center", width: 16 }}>
              {i < runs.length - 1 && <span style={{ position: "absolute", top: 14, bottom: -18, left: "50%", width: 1, background: "var(--line)", transform: "translateX(-50%)" }} />}
              <StatusDot s={r.status} size={9} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: "var(--fs-sm)", color: active ? "var(--text)" : "var(--text-2)", fontWeight: active ? 600 : 500 }}>
                {r.status === "running" ? "Running now" : m.label} · {clockTime(r.at)}
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                {r.host}{r.exit != null ? ` · exit ${r.exit}` : ""}
              </span>
            </span>
            <span style={{ textAlign: "right", flexShrink: 0 }}>
              <span style={{ display: "block", fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>{relTime(r.at)}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>{dur(r.duration)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ============ Toast ============ */
export interface ToastData { msg: string; kind?: string; sub?: string; }
export function Toast({ toast }: { toast: ToastData | null }) {
  if (!toast) return null;
  const m = st(toast.kind || "ok");
  const I = toast.kind === "fail" ? Icons.alert : toast.kind === "running" ? Icons.refresh : Icons.check;
  return (
    <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 200,
      display: "flex", alignItems: "center", gap: 11, padding: "11px 16px 11px 13px", borderRadius: "var(--r-md)",
      background: "var(--surface-3)", border: "1px solid var(--line)", boxShadow: "var(--shadow-pop)", animation: "fade-up .25s ease",
      maxWidth: 460 }}>
      <span style={{ display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: 7, background: m.dim, color: m.c }}>
        <I size={15} />
      </span>
      <span style={{ fontSize: "var(--fs-sm)", color: "var(--text)" }}>{toast.msg}</span>
      {toast.sub && <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>{toast.sub}</span>}
    </div>
  );
}
