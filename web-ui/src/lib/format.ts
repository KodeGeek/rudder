/* Time + cron formatting helpers. Everything is relative to the dataset's
   virtual NOW so demo times stay stable across reloads. */

import { NOW } from "../data/mock";

export function relTime(ts: number | null | undefined): string {
  if (ts == null) return "never";
  const diff = NOW - ts;
  const fut = diff < 0;
  const a = Math.abs(diff);
  const m = 60e3, h = 60 * m, d = 24 * h;
  let s: string;
  if (a < 45e3) s = "just now";
  else if (a < h) s = `${Math.round(a / m)}m`;
  else if (a < d) s = `${Math.round(a / h)}h`;
  else if (a < 7 * d) s = `${Math.round(a / d)}d`;
  else s = `${Math.round(a / (7 * d))}w`;
  if (s === "just now") return s;
  return fut ? `in ${s}` : `${s} ago`;
}

export function clockTime(ts: number): string {
  const dt = new Date(ts);
  return dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export function fullStamp(ts: number): string {
  const dt = new Date(ts);
  return (
    dt.toLocaleString("en-GB", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC",
    }) + " UTC"
  );
}

export function dur(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

const DOW = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

export function cronHuman(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return cron;
  const [mi, hr, dom, , dow] = p;
  const at = (h: string, m: string) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  if (mi.startsWith("*/")) return `Every ${mi.slice(2)} minutes`;
  if (hr === "*" && mi === "0") return "Hourly, on the hour";
  if (hr === "*") return `Every hour at :${mi.padStart(2, "0")}`;
  const time = at(hr, mi === "*" ? "00" : mi);
  if (dow !== "*") {
    const d = DOW[+dow] || `day ${dow}`;
    return `${d} at ${time}`;
  }
  if (dom !== "*") {
    const n = +dom;
    const ord = n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
    return `Monthly · ${ord} at ${time}`;
  }
  return `Daily at ${time}`;
}
