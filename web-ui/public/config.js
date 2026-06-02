/* ============================================================
   Rudder — runtime configuration
   ------------------------------------------------------------
   Defaults below run the UI on built-in DEMO data, so it works
   with no backend at all.

   In the container this file is REGENERATED from environment
   variables at startup (see nginx/docker-entrypoint.d/30-rudder-config.sh),
   so you can point the UI at an external Prometheus / Loki /
   control-plane WITHOUT rebuilding the image:

     DATA_SOURCE=live
     PROMETHEUS_URL=https://prometheus.internal:9090
     LOKI_URL=https://loki.internal:3100
     CONTROL_PLANE_URL=http://control-plane:8090

   The browser never calls those URLs directly — it calls the
   same-origin proxy paths below, and nginx forwards them on. That
   avoids CORS and keeps every external endpoint server-side.
   ============================================================ */
window.RUDDER_CONFIG = {
  // "mock"  → built-in demo dataset (default)
  // "live"  → fetch from the proxied endpoints below
  dataSource: "mock",

  // url   = the real upstream (shown in Settings, used by nginx)
  // proxy = same-origin path the browser actually fetches
  // health= upstream readiness probe, hit via the proxy
  prometheus:   { url: "", proxy: "/api/prometheus",    health: "/-/healthy" },
  loki:         { url: "", proxy: "/api/loki",          health: "/ready" },
  controlPlane: { url: "", proxy: "/api/control-plane", health: "/healthz" },

  // secrets manager holding Ansible SSH private keys + encrypted secrets.
  // Values are NEVER returned to the browser — only reference metadata.
  vault:        { url: "", proxy: "/api/vault",         health: "/v1/sys/health" },
};
