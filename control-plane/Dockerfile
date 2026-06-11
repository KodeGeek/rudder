# ── Rudder control-plane ────────────────────────────────────────
# Reconcile loop + cron scheduler + Ansible runner + Vault + telemetry + API.
FROM python:3.12-slim@sha256:a39549e211a16149edf74e5fdc9ef03a6767e46cd987c5048b6659b6c9904c94

RUN apt-get update && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# rsync: many playbooks use ansible's `synchronize` module, which shells out to
# rsync ON THE CONTROL NODE (this container). Separate trailing layer = cheap to
# add without busting the apt/pip cache above.
RUN apt-get update && apt-get install -y --no-install-recommends rsync \
    && rm -rf /var/lib/apt/lists/*

COPY app/ ./app/
COPY seed/ ./seed/

ENV PYTHONUNBUFFERED=1 \
    WORKDIR=/app/work \
    STATE_FILE=/app/work/repos.json \
    SEED_DIR=/app/seed

EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=6 \
  CMD curl -fsS http://127.0.0.1:8090/healthz || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
