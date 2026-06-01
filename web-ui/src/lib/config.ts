/* Runtime configuration accessor.
   The real values come from `public/config.js` (window.RUDDER_CONFIG), which the
   container regenerates from env at start — so endpoints can change without a
   rebuild. The defaults below keep the dev server (and any missing config) on
   built-in demo data. */

export interface SourceConfig {
  /** the real upstream URL (shown in Settings; used by nginx) */
  url: string;
  /** same-origin path the browser actually fetches */
  proxy: string;
  /** upstream readiness probe, hit via the proxy */
  health: string;
}

export interface RudderConfig {
  dataSource: "mock" | "live";
  prometheus: SourceConfig;
  loki: SourceConfig;
  controlPlane: SourceConfig;
  vault: SourceConfig;
}

declare global {
  interface Window {
    RUDDER_CONFIG?: Partial<RudderConfig>;
  }
}

const DEFAULT: RudderConfig = {
  dataSource: "mock",
  prometheus:   { url: "", proxy: "/api/prometheus",    health: "/-/healthy" },
  loki:         { url: "", proxy: "/api/loki",          health: "/ready" },
  controlPlane: { url: "", proxy: "/api/control-plane", health: "/healthz" },
  vault:        { url: "", proxy: "/api/vault",         health: "/v1/sys/health" },
};

export function getConfig(): RudderConfig {
  const w = typeof window !== "undefined" ? window.RUDDER_CONFIG : undefined;
  return { ...DEFAULT, ...(w || {}) } as RudderConfig;
}
