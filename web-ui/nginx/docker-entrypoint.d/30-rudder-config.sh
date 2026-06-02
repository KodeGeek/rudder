#!/bin/sh
# Regenerates /usr/share/nginx/html/config.js from environment variables at
# container start, so the UI can be pointed at external Prometheus / Loki /
# Vault / control-plane WITHOUT rebuilding the image.
#
# These are BOOTSTRAP endpoints only — operational config (jobs, schedules,
# channels, secret references) is declared in Git, not here.
set -eu

cat > /usr/share/nginx/html/config.js <<EOF
/* Generated at container start from environment variables. */
window.RUDDER_CONFIG = {
  dataSource: "${DATA_SOURCE:-mock}",
  prometheus:   { url: "${PROMETHEUS_URL:-}",    proxy: "/api/prometheus",    health: "/-/healthy" },
  loki:         { url: "${LOKI_URL:-}",          proxy: "/api/loki",          health: "/ready" },
  controlPlane: { url: "${CONTROL_PLANE_URL:-}", proxy: "/api/control-plane", health: "/healthz" },
  vault:        { url: "${VAULT_URL:-}",         proxy: "/api/vault",         health: "/v1/sys/health" },
};
EOF

echo "rudder: wrote config.js (dataSource=${DATA_SOURCE:-mock})"
