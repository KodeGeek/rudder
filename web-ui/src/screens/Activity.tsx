/* Rudder — Activity feed + Inventory */
import React from "react";
import { Card, Btn, StatusDot, KindTag } from "../components/ui";
import { relTime, clockTime, dur } from "../lib/format";
import { RUDDER } from "../data/mock";
import type { ActivityItem, NavFn, RouteParams } from "../data/types";

/* ========== ACTIVITY FEED (§4.5) ========== */
const AFILT = [
  { k: "all", label: "All runs" },
  { k: "failed", label: "Failed only" },
  { k: "success", label: "Succeeded" },
  { k: "running", label: "Running" },
];
function dayBucket(ts: number): string {
  const diff = RUDDER.NOW - ts;
  if (diff < RUDDER.DAY && new Date(ts).getUTCDate() === new Date(RUDDER.NOW).getUTCDate()) return "Today";
  if (diff < 2 * RUDDER.DAY) return "Yesterday";
  return "Earlier";
}

export function ActivityScreen({ nav, params }: { nav: NavFn; params: RouteParams }) {
  const D = RUDDER;
  const [filter, setFilter] = React.useState<string>(params.filter || "all");
  const [job, setJob] = React.useState("all");
  const items = D.activity.filter((a) => {
    if (filter !== "all" && a.status !== filter) return false;
    if (job !== "all" && a.job !== job) return false;
    return true;
  });
  const buckets: Record<string, ActivityItem[]> = {};
  items.forEach((a) => { const b = dayBucket(a.at); (buckets[b] = buckets[b] || []).push(a); });
  const order = ["Today", "Yesterday", "Earlier"];

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "22px 30px 60px", animation: "screen-in .35s cubic-bezier(.2,.7,.2,1) both" }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: "var(--fs-xl)", fontWeight: 660, letterSpacing: "-.01em" }}>Activity</h1>
        <p style={{ margin: "4px 0 0", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>Every run, newest first. Click through to the log.</p>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "inline-flex", padding: 3, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", gap: 2 }}>
          {AFILT.map((f) => (
            <button key={f.k} onClick={() => setFilter(f.k)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 6, border: "none",
                background: filter === f.k ? "var(--surface-3)" : "transparent", color: filter === f.k ? "var(--text)" : "var(--text-3)",
                fontSize: "var(--fs-xs)", fontWeight: filter === f.k ? 600 : 500 }}>
              {f.k === "failed" && <StatusDot s="fail" size={6} />}{f.label}
            </button>
          ))}
        </div>
        <select value={job} onChange={(e) => setJob(e.target.value)} className="focusable"
          style={{ height: 34, padding: "0 12px", borderRadius: "var(--r-md)", background: "var(--surface)", border: "1px solid var(--line)", color: "var(--text-2)", fontSize: "var(--fs-sm)", appearance: "none" }}>
          <option value="all">All jobs</option>
          {D.jobs.map((j) => <option key={j.name} value={j.name}>{j.name}</option>)}
        </select>
      </div>

      {order.filter((o) => buckets[o]).map((o) => (
        <div key={o} style={{ marginBottom: 22 }}>
          <div style={{ fontSize: "var(--fs-micro)", fontWeight: 650, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 8, paddingLeft: 2 }}>{o}</div>
          <Card pad={false}>
            {buckets[o].map((a, i) => (
              <button key={i} onClick={() => nav("job", { name: a.job })}
                style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, alignItems: "center", width: "100%", textAlign: "left",
                  padding: "11px 16px", border: "none", background: "transparent", borderTop: i ? "1px solid var(--line-soft)" : "none" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <StatusDot s={a.status} size={9} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>
                      <span style={{ color: "var(--text)", fontWeight: 600 }}>{a.job}</span>
                      {" "}{a.status === "running" ? "is running" : a.status === "failed" ? "failed" : "completed"} on{" "}
                      <span className="mono" style={{ color: "var(--text-2)" }}>{a.host}</span>
                    </span>
                    <KindTag kind={a.kind} />
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>
                    {a.exit != null ? `exit ${a.exit} · ` : ""}{a.duration != null ? dur(a.duration) : "in progress"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>{relTime(a.at)}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{clockTime(a.at)}</div>
                </div>
              </button>
            ))}
          </Card>
        </div>
      ))}
      {items.length === 0 && <Card style={{ textAlign: "center", color: "var(--text-3)", padding: 40 }}>No activity matches these filters.</Card>}
    </div>
  );
}

/* ========== INVENTORY / FLEET (§4.6) ========== */
export function InventoryScreen({ nav }: { nav: NavFn }) {
  const D = RUDDER;
  const [group, setGroup] = React.useState("all");
  const hosts = D.hosts.filter((h) => group === "all" || h.group === group);
  const jobsForGroup = (g: string) => D.jobs.filter((j) => j.limit === g || j.limit === "all");
  void nav;

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 30px 60px", animation: "screen-in .35s cubic-bezier(.2,.7,.2,1) both" }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: "var(--fs-xl)", fontWeight: 660, letterSpacing: "-.01em" }}>Inventory</h1>
        <p style={{ margin: "4px 0 0", fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>Hosts and groups your jobs target · reachability from the control node.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "var(--gap)", marginBottom: 22 }}>
        {D.groups.map((g) => {
          const down = g.hosts - g.up;
          return (
            <button key={g.name} onClick={() => setGroup(group === g.name ? "all" : g.name)}
              style={{ textAlign: "left", padding: "15px 16px", borderRadius: "var(--r-lg)", border: "1px solid",
                borderColor: group === g.name ? "var(--accent-line)" : "var(--line)", background: group === g.name ? "var(--accent-soft)" : "var(--surface)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StatusDot s={down ? "stale" : "ok"} size={8} />
                <span className="mono" style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)" }}>{g.name}</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 12 }}>
                <span className="mono" style={{ fontSize: 24, fontWeight: 600, color: down ? "var(--warn)" : "var(--text)" }}>{g.up}</span>
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>/ {g.hosts} up</span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 6 }}>{g.desc}</div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8 }}>{jobsForGroup(g.name).length} jobs target this group</div>
            </button>
          );
        })}
      </div>

      <Card pad={false}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px" }}>
          <span style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>Hosts {group !== "all" && <span className="mono" style={{ color: "var(--accent-text)", fontWeight: 500 }}>· {group}</span>}</span>
          {group !== "all" && <Btn size="sm" kind="bare" onClick={() => setGroup("all")}>Clear filter</Btn>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr 1fr", gap: 14, padding: "9px 18px", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line-soft)",
          fontSize: "var(--fs-micro)", fontWeight: 650, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-faint)" }}>
          <span>Host</span><span>Group</span><span>OS</span><span>Jobs</span><span style={{ textAlign: "right" }}>Last seen</span>
        </div>
        {hosts.map((h, i) => (
          <div key={h.name} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr 1fr", gap: 14, padding: "12px 18px", alignItems: "center",
            borderBottom: i < hosts.length - 1 ? "1px solid var(--line-soft)" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <StatusDot s={h.up ? "ok" : "fail"} size={8} />
              <span className="mono" style={{ fontSize: "var(--fs-sm)", color: "var(--text)", fontWeight: 550 }}>{h.name}</span>
            </div>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{h.group}</span>
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>{h.os}</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{h.jobs}</span>
            <span style={{ textAlign: "right", fontSize: "var(--fs-xs)", color: h.up ? "var(--text-3)" : "var(--fail)" }}>
              {h.up ? relTime(h.lastSeen) : "unreachable"}
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}
