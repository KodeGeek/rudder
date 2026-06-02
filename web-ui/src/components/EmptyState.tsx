import React from "react";
import { Btn } from "./ui";
import type { IconFn } from "./icons";

export function EmptyState({ icon: I, title, body, actionLabel, onAction }:
  { icon?: IconFn; title: string; body?: React.ReactNode; actionLabel?: string; onAction?: () => void }) {
  return (
    <div style={{ display: "grid", placeItems: "center", padding: "72px 24px", textAlign: "center" }}>
      <div style={{ maxWidth: 440 }}>
        {I && (
          <div style={{ width: 48, height: 48, margin: "0 auto 16px", borderRadius: 14, background: "var(--surface-2)",
            border: "1px solid var(--line)", display: "grid", placeItems: "center", color: "var(--text-3)" }}>
            <I size={22} />
          </div>
        )}
        <div style={{ fontSize: "var(--fs-lg)", fontWeight: 640, color: "var(--text)" }}>{title}</div>
        {body && <p style={{ margin: "8px 0 0", fontSize: "var(--fs-sm)", color: "var(--text-3)", lineHeight: 1.55 }}>{body}</p>}
        {actionLabel && onAction && (
          <div style={{ marginTop: 18 }}><Btn kind="primary" onClick={onAction}>{actionLabel}</Btn></div>
        )}
      </div>
    </div>
  );
}
