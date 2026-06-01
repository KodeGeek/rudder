/* Rudder — UI atoms (status, pills, sparklines, buttons, logo) */
import React from "react";
import { Icons, type IconFn } from "./icons";
import type { SparkPoint } from "../data/types";

/* ---------- status model (§5.4) ---------- */
export interface StatusMeta { label: string; c: string; dim: string; word: string; }
export const STATUS: Record<string, StatusMeta> = {
  ok:      { label: "Passing",  c: "var(--ok)",   dim: "var(--ok-dim)",   word: "success" },
  fail:    { label: "Failed",   c: "var(--fail)", dim: "var(--fail-dim)", word: "failed" },
  running: { label: "Running",  c: "var(--warn)", dim: "var(--warn-dim)", word: "running" },
  stale:   { label: "Stale",    c: "var(--warn)", dim: "var(--warn-dim)", word: "stale" },
  never:   { label: "No data",  c: "var(--idle)", dim: "var(--idle-dim)", word: "never run" },
  success: { label: "Success",  c: "var(--ok)",   dim: "var(--ok-dim)",   word: "success" },
  failed:  { label: "Failed",   c: "var(--fail)", dim: "var(--fail-dim)", word: "failed" },
};
export const st = (k: string): StatusMeta => STATUS[k] || STATUS.never;

export function StatusDot({ s, size = 9, pulse }: { s: string; size?: number; pulse?: boolean }) {
  const m = st(s);
  const running = s === "running" || s === "stale";
  return (
    <span style={{ position: "relative", display: "inline-flex", width: size, height: size, flexShrink: 0 }}>
      {(running || pulse) && (
        <span style={{ position: "absolute", inset: -3, borderRadius: 99, background: m.c, opacity: 0.18,
          animation: "pulse-dot 1.6s ease-in-out infinite" }} />
      )}
      <span style={{ width: size, height: size, borderRadius: 99, background: m.c,
        boxShadow: `0 0 0 3px ${m.dim}`, animation: running ? "pulse-dot 1.6s ease-in-out infinite" : "none" }} />
    </span>
  );
}

export function StatusPill({ s, children, size = "md" }: { s: string; children?: React.ReactNode; size?: "sm" | "md" }) {
  const m = st(s);
  const pad = size === "sm" ? "2px 8px 2px 7px" : "3px 10px 3px 8px";
  const fs = size === "sm" ? "var(--fs-micro)" : "var(--fs-xs)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: pad,
      borderRadius: 99, background: m.dim, color: m.c, fontSize: fs, fontWeight: 600,
      letterSpacing: ".01em", whiteSpace: "nowrap", border: `1px solid ${m.c}`, borderColor: "transparent" }}>
      <StatusDot s={s} size={size === "sm" ? 6 : 7} />
      {children || m.label}
    </span>
  );
}

export function ProviderTag({ p, withText = true }: { p: string; withText?: boolean }) {
  const G = p === "ado" || p === "azure" ? Icons.azure : Icons.github;
  const label = p === "ado" || p === "azure" ? "Azure DevOps" : "GitHub";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-3)", fontSize: "var(--fs-xs)" }}>
      <G size={14} sw={2} />
      {withText && label}
    </span>
  );
}

export function KindTag({ kind }: { kind: string }) {
  const dsc = kind === "dsc";
  return (
    <span title={dsc ? "Desired-state job — re-applies on an interval to heal drift" : "Task job — runs the playbook on schedule"}
      style={{ fontSize: "var(--fs-micro)", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase",
        padding: "2px 6px", borderRadius: 4, color: dsc ? "var(--accent-text)" : "var(--text-3)",
        background: dsc ? "var(--accent-soft)" : "var(--surface-3)", border: "1px solid var(--line-soft)" }}>
      {dsc ? "DSC" : "TASK"}
    </span>
  );
}

/* ---------- duration sparkline (bars, colored by ok/fail) ---------- */
export function Sparkline({ data, w = 132, h = 30, gap = 1.5 }: { data: SparkPoint[]; w?: number; h?: number; gap?: number }) {
  if (!data || !data.length) return <div style={{ width: w, height: h }} />;
  const max = Math.max(...data.map((d) => d.d), 1);
  const bw = (w - gap * (data.length - 1)) / data.length;
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      {data.map((d, i) => {
        const bh = Math.max(2, (d.d / max) * (h - 2));
        return <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx={Math.min(1.5, bw / 2)}
          fill={d.ok ? "var(--ok)" : "var(--fail)"} opacity={d.ok ? 0.55 : 0.95} />;
      })}
    </svg>
  );
}

/* ---------- success-rate ring ---------- */
export function Ring({ pct, size = 38, sw = 4, color }: { pct: number | null; size?: number; sw?: number; color?: string }) {
  if (pct == null) return <div className="mono" style={{ width: size, height: size, display: "grid", placeItems: "center", color: "var(--idle)", fontSize: 11 }}>—</div>;
  const r = (size - sw) / 2, c = 2 * Math.PI * r;
  const col = color || (pct >= 95 ? "var(--ok)" : pct >= 80 ? "var(--warn)" : "var(--fail)");
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={sw}
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} strokeLinecap="round" />
      </svg>
      <span className="mono" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
        fontSize: 10, fontWeight: 600, color: "var(--text-2)" }}>{pct}</span>
    </div>
  );
}

/* ---------- buttons ---------- */
export interface BtnProps {
  children?: React.ReactNode;
  kind?: "ghost" | "solid" | "primary" | "bare";
  size?: "sm" | "md" | "lg";
  icon?: IconFn;
  iconR?: IconFn;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  full?: boolean;
  title?: string;
  style?: React.CSSProperties;
}
export function Btn({ children, kind = "ghost", size = "md", icon: I, iconR: IR, onClick, disabled, danger, full, title, style }: BtnProps) {
  const [hover, setHover] = React.useState(false);
  const sizes = {
    sm: { h: 28, px: 10, fs: "var(--fs-xs)", g: 6 },
    md: { h: 34, px: 13, fs: "var(--fs-sm)", g: 7 },
    lg: { h: 40, px: 17, fs: "var(--fs-md)", g: 8 },
  }[size];
  let bg = "transparent", col = "var(--text-2)", bd = "1px solid var(--line)";
  if (kind === "primary") { bg = hover ? "var(--accent-strong)" : "var(--accent)"; col = "#fff"; bd = "1px solid transparent"; }
  else if (kind === "solid") { bg = hover ? "var(--surface-3)" : "var(--surface-2)"; col = "var(--text)"; bd = "1px solid var(--line)"; }
  else if (kind === "ghost") { bg = hover ? "var(--surface-2)" : "transparent"; col = hover ? "var(--text)" : "var(--text-2)"; }
  else if (kind === "bare") { bg = "transparent"; bd = "1px solid transparent"; col = hover ? "var(--text)" : "var(--text-3)"; }
  if (danger) { col = hover ? "#fff" : "var(--fail)"; bg = hover ? "var(--fail)" : "var(--fail-dim)"; bd = "1px solid transparent"; }
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: sizes.g,
        height: sizes.h, padding: `0 ${sizes.px}px`, borderRadius: "var(--r-md)", background: bg, color: col,
        border: bd, fontSize: sizes.fs, fontWeight: 550, letterSpacing: ".005em", width: full ? "100%" : "auto", whiteSpace: "nowrap",
        opacity: disabled ? 0.45 : 1, pointerEvents: disabled ? "none" : "auto", transition: "background .12s, color .12s, transform .08s",
        transform: hover && !disabled ? "translateY(-0.5px)" : "none", ...style }}>
      {I && <I size={size === "sm" ? 14 : 16} />}
      {children}
      {IR && <IR size={size === "sm" ? 14 : 16} />}
    </button>
  );
}

export function IconBtn({ icon: I, onClick, title, active, size = 32 }: { icon: IconFn; onClick?: () => void; title?: string; active?: boolean; size?: number }) {
  const [h, setH] = React.useState(false);
  return (
    <button onClick={onClick} title={title} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ width: size, height: size, display: "grid", placeItems: "center", borderRadius: "var(--r-md)",
        background: active ? "var(--accent-soft)" : h ? "var(--surface-2)" : "transparent",
        color: active ? "var(--accent-text)" : h ? "var(--text)" : "var(--text-3)",
        border: "1px solid", borderColor: active ? "var(--accent-line)" : "transparent", transition: "all .12s" }}>
      <I size={17} />
    </button>
  );
}

/* ---------- misc atoms ---------- */
export function Card({ children, style, pad = true, onClick, hover, className }:
  { children?: React.ReactNode; style?: React.CSSProperties; pad?: boolean; onClick?: () => void; hover?: boolean; className?: string }) {
  const [h, setH] = React.useState(false);
  return (
    <div className={className} onClick={onClick}
      onMouseEnter={() => hover && setH(true)} onMouseLeave={() => hover && setH(false)}
      style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)",
        padding: pad ? "var(--pad)" : 0, boxShadow: "var(--shadow-1)", transition: "border-color .14s, transform .14s, box-shadow .14s",
        borderColor: h ? "var(--line)" : "var(--line)", cursor: onClick ? "pointer" : "default",
        transform: h ? "translateY(-1px)" : "none", ...style }}>
      {children}
    </div>
  );
}

export function Kbd({ children }: { children?: React.ReactNode }) {
  return <kbd className="mono" style={{ fontSize: 10.5, padding: "1px 5px", borderRadius: 4, background: "var(--surface-3)",
    border: "1px solid var(--line)", color: "var(--text-3)", boxShadow: "0 1px 0 var(--line)" }}>{children}</kbd>;
}

export function SectionLabel({ children, right }: { children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
      <span style={{ fontSize: "var(--fs-micro)", fontWeight: 650, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--text-faint)" }}>{children}</span>
      {right}
    </div>
  );
}

/* ---------- logo ---------- */
export function Logo({ size = 24, withText = true, sub = false }: { size?: number; withText?: boolean; sub?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="8" fill="var(--accent)" />
          <rect width="32" height="32" rx="8" fill="url(#rgrad)" fillOpacity="0.35" />
          <defs>
            <linearGradient id="rgrad" x1="0" y1="0" x2="32" y2="32">
              <stop stopColor="#fff" stopOpacity="0.5" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* rudder: pivot pin + stock + curved blade, with hull-section ribs */}
          <circle cx="13" cy="7.6" r="2.1" fill="#fff" />
          <path d="M13 9.8V25.4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M13 12.6C20.5 14.4 20.8 21.5 13 25.4Z" fill="#fff" fillOpacity="0.95" />
          {/* ribs cut through the blade in the tile color (nerdy hull-section look) */}
          <path d="M13.6 16.1H18.4M13.6 19.2H18.7M13.6 22.2H17.4" stroke="var(--accent)" strokeWidth="1" strokeLinecap="round" />
          {/* course-correction tick — small dashed wake to port */}
          <path d="M7.5 11.5C8.6 14.5 8.6 17 7.5 20" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="0.2 2.6" opacity="0.8" />
        </svg>
      </span>
      {withText && (
        <div style={{ lineHeight: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 680, letterSpacing: "-.01em", color: "var(--text)" }}>Rudder</span>
            <span style={{ display: "inline-block", width: 6.5, height: 14, background: "var(--accent-text)", borderRadius: 1,
              marginLeft: 3, animation: "caret-blink 1.15s steps(1) infinite" }} />
          </div>
          {sub && <div className="mono" style={{ fontSize: 9.5, color: "var(--text-faint)", marginTop: 4, letterSpacing: ".04em" }}>gitops control plane</div>}
        </div>
      )}
    </div>
  );
}
