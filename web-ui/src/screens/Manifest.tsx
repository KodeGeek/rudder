/* Rudder — Manifest viewer (READ-ONLY). Shows the live jobs.yml + rudder.yml
   pulled from the connected repo. To change anything: edit in Git → PR → reconcile. */
import React from "react";
import { Card, Btn, StatusDot } from "../components/ui";
import { Icons } from "../components/icons";
import { EmptyState } from "../components/EmptyState";
import { relTime } from "../lib/format";
import { useData } from "../lib/data";
import { api, type ManifestDoc } from "../lib/api";
import type { NavFn } from "../data/types";

function yamlLine(line: string) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) {
    return <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>{line}</span>;
  }
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
  const lines = (text || "").split("\n");
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

export function ManifestScreen({ nav }: { nav: NavFn }) {
  const { repos, reconcile, reconcileNow } = useData();
  const [doc, setDoc] = React.useState<ManifestDoc | null>(null);
  const [file, setFile] = React.useState<"jobs" | "rudder">("jobs");
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (repos.length === 0) return;
    api.manifest().then(setDoc).catch(() => setDoc(null));
  }, [repos.length]);

  if (repos.length === 0) {
    return <EmptyState icon={Icons.doc} title="No manifest yet"
      body="Rudder reads ansible/jobs.yml and rudder.yml from a connected repository. Connect one to see it here."
      actionLabel="Connect a repository" onAction={() => nav("connect")} />;
  }

  // Repo cloned, but no Rudder manifest → guide the operator to add one.
  if (doc && !doc.found) {
    const example = doc.playbooks.slice(0, 2).map((pb, i) =>
      `- name: ${pb.split("/").pop()!.replace(/\.ya?ml$/, "") || `job-${i + 1}`}\n  cron: "0 3 * * *"\n  playbook: ${pb}\n  limit: all`
    ).join("\n\n") || `- name: my-job\n  cron: "0 3 * * *"\n  playbook: playbooks/site.yml\n  limit: all`;
    return (
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "22px 30px 60px", animation: "screen-in .35s cubic-bezier(.2,.7,.2,1) both" }}>
        <h1 style={{ margin: 0, fontSize: "var(--fs-xl)", fontWeight: 660, letterSpacing: "-.01em" }}>Manifest</h1>
        <Card style={{ marginTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icons.alert size={18} style={{ color: "var(--warn)" }} />
            <span style={{ fontSize: "var(--fs-md)", fontWeight: 640 }}>No <span className="mono">ansible/jobs.yml</span> found in <span className="mono">{doc.slug}</span></span>
          </div>
          <p style={{ margin: "10px 0 0", fontSize: "var(--fs-sm)", color: "var(--text-3)", lineHeight: 1.6 }}>
            Rudder is a GitOps <strong>scheduler</strong> — it runs the playbooks you declare in a manifest, on the cron you set.
            Your repo cloned fine, but it has no <span className="mono">ansible/jobs.yml</span> (or top-level <span className="mono">jobs.yml</span>),
            so there's nothing to schedule yet. Add one like this and open a PR:
          </p>
          <div style={{ background: "var(--term-bg)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", marginTop: 14 }}>
            <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line)", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }} className="mono">ansible/jobs.yml</div>
            <pre className="mono" style={{ margin: 0, padding: "12px 14px", fontSize: 12.5, lineHeight: 1.7, color: "var(--text-2)", overflow: "auto" }}>{example}</pre>
          </div>
        </Card>

        <Card style={{ marginTop: "var(--gap)" }}>
          <div style={{ fontSize: "var(--fs-md)", fontWeight: 640, marginBottom: 4 }}>Playbooks discovered in your repo</div>
          <p style={{ margin: "0 0 12px", fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>{doc.playbooks.length} file{doc.playbooks.length === 1 ? "" : "s"} that look like playbooks — reference any of these in <span className="mono">jobs.yml</span>.</p>
          {doc.playbooks.length ? (
            <div style={{ display: "grid", gap: 6 }}>
              {doc.playbooks.map((pb) => (
                <div key={pb} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: "var(--r-sm)", background: "var(--surface-2)", border: "1px solid var(--line-soft)" }}>
                  <Icons.doc size={14} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                  <span className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>{pb}</span>
                </div>
              ))}
            </div>
          ) : <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>No playbooks detected.</div>}
        </Card>
      </div>
    );
  }

  const files = [
    { k: "jobs" as const, name: "ansible/jobs.yml", desc: "Job manifest — schedules, playbooks, targets", text: doc?.jobsYaml || "" },
    { k: "rudder" as const, name: "rudder.yml", desc: "Operational config — reconcile, observability, vault, alerts", text: doc?.rudderYaml || "" },
  ];
  const active = files.find((f) => f.k === file) || files[0];
  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(active.text).catch(() => {});
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
        <Btn kind="solid" icon={Icons.refresh} onClick={() => reconcileNow()}>Reconcile now</Btn>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, padding: "12px 16px", borderRadius: "var(--r-md)",
        background: "var(--surface)", border: "1px solid var(--line)" }}>
        <StatusDot s="ok" size={9} />
        <span style={{ fontSize: "var(--fs-sm)", color: "var(--text)", fontWeight: 550 }}>Config in sync</span>
        <span style={{ color: "var(--text-faint)" }}>·</span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>no drift between Git and the running schedule</span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>
          <Icons.refresh size={13} /> last reconcile {relTime(reconcile?.lastAt)} · every {reconcile?.intervalMin ?? "—"}m
        </span>
      </div>

      <Card pad={false} style={{ marginTop: "var(--gap)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
          {files.map((f) => {
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
          {doc && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)", color: "var(--text-faint)", marginRight: 4 }}>
              {doc.provider === "ado" ? <Icons.azure size={13} /> : <Icons.github size={13} />}
              <span className="mono">{doc.slug}</span><span style={{ color: "var(--line)" }}>·</span><Icons.branch size={12} /><span className="mono">{doc.branch}</span>
            </span>
          )}
          <button onClick={copy} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: copied ? "var(--ok)" : "var(--text-3)", background: "none", border: "none" }}>
            {copied ? <Icons.check size={13} /> : <Icons.copy size={13} />}{copied ? "copied" : "copy"}
          </button>
        </div>
        <div style={{ padding: "8px 16px 0", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>{active.desc}</div>
        <div style={{ background: "var(--term-bg)", borderTop: "1px solid var(--line)", marginTop: 8 }}>
          <YamlView text={active.text} />
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--gap)", marginTop: "var(--gap)" }}>
        {[
          { n: "1", t: "Edit in Git", d: "Change ansible/jobs.yml (or rudder.yml) in your branch — locally or on GitHub / Azure DevOps." },
          { n: "2", t: "Open a PR", d: "Review the diff with your team. Git history is your audit log and rollback." },
          { n: "3", t: "Merge → reconcile", d: `Rudder pulls on merge and regenerates the schedule within ~${reconcile?.intervalMin ?? 2}m. No UI edits, no drift.` },
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
