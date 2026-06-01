/* Rudder — Manifest viewer (READ-ONLY). The schedule + config live in Git;
   this screen shows them. To change anything: edit in Git → PR → reconcile. */
import React from "react";
import { Card, Btn, StatusDot } from "../components/ui";
import { Icons } from "../components/icons";
import { relTime } from "../lib/format";
import { RUDDER } from "../data/mock";
import type { NavFn, RudderData } from "../data/types";

// very light YAML tinting for read-only display
function yamlLine(line: string) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) {
    return <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>{line}</span>;
  }
  // split inline comment
  let comment = "";
  let content = line;
  const hashIdx = line.indexOf("#");
  if (hashIdx > 0) { comment = line.slice(hashIdx); content = line.slice(0, hashIdx); }
  const m = content.match(/^(\s*-?\s*)([A-Za-z0-9_./-]+)(:)(.*)$/);
  if (m) {
    return (
      <span>
        <span style={{ color: "var(--text-3)" }}>{m[1]}</span>
        <span style={{ color: "var(--accent-text)" }}>{m[2]}</span>
        <span style={{ color: "var(--text-faint)" }}>{m[3]}</span>
        <span style={{ color: "var(--text)" }}>{m[4]}</span>
        {comment && <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>{comment}</span>}
      </span>
    );
  }
  return <span style={{ color: "var(--text-2)" }}>{content}<span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>{comment}</span></span>;
}

function YamlView({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7, overflow: "auto", maxHeight: 560, padding: "10px 0" }}>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 14, padding: "0 16px", whiteSpace: "pre" }}>
          <span style={{ width: 26, textAlign: "right", color: "var(--text-faint)", userSelect: "none", opacity: 0.6, flexShrink: 0 }}>{i + 1}</span>
          <span>{yamlLine(l)}</span>
        </div>
      ))}
    </div>
  );
}

const FILES: { k: string; name: string; desc: string; get: (D: RudderData) => string }[] = [
  { k: "jobs", name: "ansible/jobs.yml", desc: "Job manifest — schedules, playbooks, targets", get: (D) => D.manifestYaml },
  { k: "rudder", name: "rudder.yml", desc: "Operational config — git, reconcile, observability, vault, alerts", get: (D) => D.rudderYaml },
];

export function ManifestScreen({ onReconcile }: { nav: NavFn; onReconcile: () => void }) {
  const D = RUDDER;
  const [file, setFile] = React.useState("jobs");
  const [copied, setCopied] = React.useState(false);
  const active = FILES.find((f) => f.k === file) || FILES[0];
  const text = active.get(D);
  const repo = D.repos.github;

  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "22px 30px 60px", animation: "screen-in .35s cubic-bezier(.2,.7,.2,1) both" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--fs-xl)", fontWeight: 660, letterSpacing: "-.01em" }}>Manifest</h1>
          <p style={{ margin: "5px 0 0", fontSize: "var(--fs-sm)", color: "var(--text-3)", maxWidth: 580 }}>
            The schedule and all configuration live in Git. This view is read-only — to change anything, edit the file and open a pull request. Rudder reconciles on merge.
          </p>
        </div>
        <div style={{ display: "flex", gap: 9 }}>
          <Btn kind="solid" icon={Icons.refresh} onClick={onReconcile}>Reconcile now</Btn>
          <Btn kind="primary" iconR={Icons.ext} onClick={() => {}}>Edit in Git</Btn>
        </div>
      </div>

      {/* sync banner */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, padding: "12px 16px", borderRadius: "var(--r-md)",
        background: "var(--surface)", border: "1px solid var(--line)" }}>
        <StatusDot s="ok" size={9} />
        <span style={{ fontSize: "var(--fs-sm)", color: "var(--text)", fontWeight: 550 }}>Config in sync</span>
        <span style={{ color: "var(--text-faint)" }}>·</span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>no drift between Git and the running schedule</span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>
          <Icons.refresh size={13} /> last reconcile {relTime(D.reconcile.lastAt)} · every {D.reconcile.intervalMin}m
        </span>
      </div>

      {/* file viewer */}
      <Card pad={false} style={{ marginTop: "var(--gap)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
          {FILES.map((f) => {
            const on = f.k === file;
            return (
              <button key={f.k} onClick={() => setFile(f.k)}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: "var(--r-md)", border: "none",
                  background: on ? "var(--surface-3)" : "transparent", color: on ? "var(--text)" : "var(--text-3)", fontWeight: on ? 600 : 500 }}>
                <Icons.doc size={14} /><span className="mono" style={{ fontSize: 12 }}>{f.name}</span>
              </button>
            );
          })}
          <span style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)", color: "var(--text-faint)", marginRight: 4 }}>
            <Icons.github size={13} /><span className="mono">{repo.slug}</span><span style={{ color: "var(--line)" }}>·</span><Icons.branch size={12} /><span className="mono">{repo.branch}</span>
          </span>
          <button onClick={copy} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: copied ? "var(--ok)" : "var(--text-3)", background: "none", border: "none" }}>
            {copied ? <Icons.check size={13} /> : <Icons.copy size={13} />}{copied ? "copied" : "copy"}
          </button>
          <Btn size="sm" kind="bare" iconR={Icons.ext}>Edit in Git</Btn>
        </div>
        <div style={{ padding: "2px 0 8px", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>
          <div style={{ padding: "8px 16px 0" }}>{active.desc}</div>
        </div>
        <div style={{ background: "var(--term-bg)", borderTop: "1px solid var(--line)" }}>
          <YamlView text={text} />
        </div>
      </Card>

      {/* how-to */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--gap)", marginTop: "var(--gap)" }}>
        {[
          { n: "1", t: "Edit in Git", d: "Change ansible/jobs.yml (or rudder.yml) in your branch — locally or on GitHub / Azure DevOps." },
          { n: "2", t: "Open a PR", d: "Review the diff with your team. Git history is your audit log and rollback." },
          { n: "3", t: "Merge → reconcile", d: `Rudder pulls on merge and regenerates the schedule within ~${D.reconcile.intervalMin}m. No UI edits, no drift.` },
        ].map((s) => (
          <Card key={s.n} style={{ padding: "16px 17px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
              <span className="mono" style={{ width: 22, height: 22, borderRadius: 7, background: "var(--accent-soft)", color: "var(--accent-text)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }}>{s.n}</span>
              <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>{s.t}</span>
            </div>
            <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-3)", lineHeight: 1.55 }}>{s.d}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
