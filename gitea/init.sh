#!/bin/sh
# One-shot Gitea bootstrap. Runs as root only to set up the volume; the Gitea
# CLI itself runs as uid 1000 (Gitea refuses to run as root). Writes a
# deterministic app.ini, migrates the DB, creates an admin, and generates an API
# token for the control-plane to seed the demo repo. The token goes to a shared
# volume — never committed.
set -e

CONF=/data/gitea/conf/app.ini
USER="${GITEA_ADMIN_USER:-rudder}"
PW="${GITEA_ADMIN_PASSWORD:-}"
[ -z "$PW" ] && PW=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')

mkdir -p /data/gitea/conf /shared
chown -R 1000:1000 /data /shared

if [ ! -f "$CONF" ]; then
  cat > "$CONF" <<INI
APP_NAME = Rudder Gitea
RUN_MODE = prod
WORK_PATH = /data/gitea
[database]
DB_TYPE = sqlite3
PATH = /data/gitea/gitea.db
[server]
ROOT_URL = http://gitea:3000/
HTTP_PORT = 3000
[security]
INSTALL_LOCK = true
[service]
DISABLE_REGISTRATION = true
[repository]
DEFAULT_BRANCH = main
INI
  chown 1000:1000 "$CONF"
fi

run() {
  su-exec 1000:1000 env GITEA_WORK_DIR=/data/gitea HOME=/data/git gitea --config "$CONF" "$@"
}

run migrate

run admin user create --username "$USER" --password "$PW" --email "$USER@local" \
  --admin --must-change-password=false 2>/dev/null \
  || echo "gitea-init: admin '$USER' already exists"

if run admin user generate-access-token --username "$USER" --scopes all \
     --token-name "seed-$(date +%s)" --raw > /shared/gitea-token 2>/dev/null; then
  echo "gitea-init: access token written to /shared/gitea-token"
else
  echo "gitea-init: token generation failed"
fi

chown -R 1000:1000 /data /shared
[ -s /shared/gitea-token ] && echo "gitea-init: done" || echo "gitea-init: WARNING token empty"
