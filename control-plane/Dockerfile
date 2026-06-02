# ── Rudder control-plane ────────────────────────────────────────
# Reconcile loop + cron scheduler + Ansible runner + Vault + telemetry + API.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

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
