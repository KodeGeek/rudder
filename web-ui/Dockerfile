# ── Rudder web-ui ───────────────────────────────────────────────
# Multi-stage: build the Vite app, then serve the static output with nginx.
# The result is a tiny, read-only observability UI with NO runtime CDN calls.
#
#   docker build -t rudder-web-ui web-ui            # from repo root
#   docker run --rm -p 8080:80 rudder-web-ui        # demo data
#
# Point it at real backends without rebuilding (proxied server-side):
#   docker run --rm -p 8080:80 \
#     -e DATA_SOURCE=live \
#     -e PROMETHEUS_URL=https://prometheus.internal:9090 \
#     -e LOKI_URL=https://loki.internal:3100 \
#     -e VAULT_URL=https://vault.internal:8200 \
#     -e CONTROL_PLANE_URL=http://control-plane:8090 \
#     rudder-web-ui

# ---- stage 1: build ----
FROM node:22-alpine@sha256:9385cd9f3001dfc3431e8ead12c43e9e1f87cc1b9b5c6cfd0f73865d405b27c4 AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# ---- stage 2: serve ----
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

# nginx config is a template — our vars are substituted at start, nginx's own
# $variables are preserved via NGINX_ENVSUBST_FILTER.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

# detect the DNS resolver from resolv.conf (Docker 127.0.0.11 / k8s CoreDNS) and
# regenerate config.js from env at start. nginx's entrypoint only sources/runs
# files in /docker-entrypoint.d that are EXECUTABLE, so both need chmod +x.
COPY nginx/docker-entrypoint.d/05-resolver.envsh /docker-entrypoint.d/05-resolver.envsh
COPY nginx/docker-entrypoint.d/30-rudder-config.sh /docker-entrypoint.d/30-rudder-config.sh
RUN chmod +x /docker-entrypoint.d/05-resolver.envsh /docker-entrypoint.d/30-rudder-config.sh

# built app
COPY --from=build /app/dist /usr/share/nginx/html

# bootstrap defaults (override at runtime). Empty endpoints → demo mode.
ENV NGINX_ENVSUBST_FILTER="^(PROMETHEUS_URL|LOKI_URL|CONTROL_PLANE_URL|VAULT_URL|NGINX_RESOLVER)$" \
    DATA_SOURCE=mock \
    PROMETHEUS_URL="" \
    LOKI_URL="" \
    CONTROL_PLANE_URL="" \
    VAULT_URL=""

EXPOSE 80

# 127.0.0.1 (not localhost): nginx listens on IPv4 only, but localhost can
# resolve to IPv6 ::1 first inside the container → false "unhealthy".
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
