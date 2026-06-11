# Rudder Control-Plane API Reference

The Rudder control-plane exposes a RESTful API for managing repositories, jobs, runs, and operational settings. Interactive documentation is available at `/docs` (Swagger UI) and `/redoc` (ReDoc).

## Authentication

All endpoints require authentication via a Bearer token (except probes). Set `RUDDER_API_KEY` to enable authentication; when unset, the API is open (development only).

**Role-Based Access Control:**
- `admin` — full access; only role can modify secrets and rotate keys
- `operator` — can trigger runs, reconcile, and connect repos
- `viewer` — read-only access
- `probe` — reserved for health/readiness checks (no token required)

## Probes (Open Paths)

These paths do not require authentication:

### GET /healthz
**Status:** 200

Returns health status.

```json
{
  "status": "ok",
  "booted": true
}
```

---

### GET /readyz
**Status:** 200 or 503

Returns readiness (200 if ready, 503 if not).

```json
{
  "ready": true
}
```

---

### GET /metrics
**Status:** 200

Returns Prometheus-format metrics (text/plain).

---

### GET /openapi.json
**Status:** 200

Returns the OpenAPI 3.0 schema for this API.

---

### GET /docs
**Status:** 200

Interactive Swagger UI documentation.

---

### GET /redoc
**Status:** 200

Interactive ReDoc documentation.

---

## Authentication

### GET /auth/verify
**Auth:** Required  
**Role:** Any

Verify the current API key and inspect the authenticated principal's role.

```json
{
  "ok": true,
  "role": "admin",
  "authRequired": true
}
```

| Code | Description |
|------|-------------|
| 200 | Authenticated and verified |
| 401 | Invalid or missing API key |

---

### GET /info
**Auth:** Required  
**Role:** Any

Get bundled Gitea URL (if seeded) and the reconcile interval setting.

```json
{
  "bundledRepoUrl": "http://localhost:3000",
  "reconcileInterval": "2m"
}
```

| Code | Description |
|------|-------------|
| 200 | Success |

---

## Repositories

### GET /repos
**Auth:** Required  
**Role:** Any

List all connected repositories. Secret flags (hostKey, vaultPass, auth) reflect live Vault state; values are never returned.

```json
[
  {
    "id": "github:org/repo",
    "provider": "github",
    "slug": "org/repo",
    "branch": "main",
    "url": "https://github.com/org/repo",
    "addedAt": 1700000000000,
    "auth": true,
    "authMethod": "token",
    "hostKey": true,
    "vaultPass": false,
    "error": null
  }
]
```

| Code | Description |
|------|-------------|
| 200 | Success |
| 401 | Not authenticated |

---

### POST /repos
**Auth:** Required  
**Role:** operator, admin

Connect a new repository (GitHub or Azure DevOps).

**Request:**
```json
{
  "provider": "github",
  "url": "https://github.com/org/repo",
  "branch": "main",
  "token": "",
  "authMethod": "",
  "vaultPass": ""
}
```

**Response:**
```json
{
  "id": "github:org/repo",
  "provider": "github",
  "slug": "org/repo",
  "branch": "main",
  "url": "https://github.com/org/repo",
  "addedAt": 1700000000000,
  "auth": false,
  "authMethod": "",
  "hostKey": false,
  "vaultPass": false,
  "error": null
}
```

| Code | Description |
|------|-------------|
| 200 | Repository added (may have error if clone/auth failed) |
| 403 | Insufficient role |

---

### POST /repos/credentials
**Auth:** Required  
**Role:** admin

Update repository credentials (SSH key, Vault password, or Git token). Write-only — values are never returned, only boolean "configured" flags.

**Request:**
```json
{
  "rid": "github:org/repo",
  "hostKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
  "vaultPass": "secret-vault-password",
  "token": "github_pat_xxx"
}
```

**Response:**
```json
{
  "id": "github:org/repo",
  "provider": "github",
  "slug": "org/repo",
  "branch": "main",
  "url": "https://github.com/org/repo",
  "addedAt": 1700000000000,
  "auth": true,
  "authMethod": "token",
  "hostKey": true,
  "vaultPass": true,
  "error": null
}
```

| Code | Description |
|------|-------------|
| 200 | Credentials updated |
| 403 | Insufficient role |
| 404 | Repository not found |

---

### POST /deploy-key
**Auth:** Required  
**Role:** operator, admin

Generate a per-repository deploy keypair and return the public key (private key remains in Vault).

**Request:**
```json
{
  "provider": "github",
  "url": "https://github.com/org/repo"
}
```

**Response:**
```json
{
  "rid": "github:org/repo",
  "publicKey": "ssh-rsa AAAA...",
  "sshUrl": "git@github.com:org/repo.git"
}
```

| Code | Description |
|------|-------------|
| 200 | Deploy key generated or retrieved |

---

### DELETE /repos/{rid}
**Auth:** Required  
**Role:** admin  
**Param:** `rid` — repository ID (e.g. `github:org/repo`)

Remove a repository and all its associated jobs.

| Code | Description |
|------|-------------|
| 204 | Repository deleted |
| 403 | Insufficient role |
| 404 | Repository not found |

---

## Reconciliation

### GET /reconcile
**Auth:** Required  
**Role:** Any

Get the current reconcile state (last run timestamp, next run, interval).

```json
{
  "lastAt": 1700000000000,
  "intervalMin": 2,
  "inSync": true,
  "pendingCommit": null,
  "nextAt": 1700000120000
}
```

| Code | Description |
|------|-------------|
| 200 | Success |

---

### POST /reconcile
**Auth:** Required  
**Role:** operator, admin

Trigger an immediate reconcile (reload all repos and re-render the schedule).

**Response:**
```json
{
  "lastAt": 1700000000000,
  "intervalMin": 2,
  "inSync": true,
  "pendingCommit": null,
  "nextAt": 1700000120000
}
```

| Code | Description |
|------|-------------|
| 200 | Reconcile started |
| 403 | Insufficient role |

---

## Jobs

### GET /jobs
**Auth:** Required  
**Role:** Any

List all scheduled jobs with their status, history (spark), and next run time.

```json
[
  {
    "name": "nightly-patching",
    "cron": "0 3 * * *",
    "playbook": "playbooks/patch.yml",
    "limit": "ubuntuservers",
    "kind": "task",
    "args": null,
    "desc": "Apply security updates",
    "provider": "github",
    "repoSlug": "org/repo",
    "branch": "main",
    "enabled": true,
    "status": "ok",
    "lastRun": 1700000000000,
    "duration": 120000,
    "exit": 0,
    "successRate": 98,
    "spark": [
      { "d": 118000, "ok": true },
      { "d": 120000, "ok": true }
    ],
    "runs": [],
    "nextRun": 1700086800000
  }
]
```

| Code | Description |
|------|-------------|
| 200 | Success |

---

### GET /jobs/{name}
**Auth:** Required  
**Role:** Any  
**Param:** `name` — job name

Get a single job with full run history (up to 30 most recent).

**Response:** Same as GET /jobs, but includes `runs: [...]` with full run details.

| Code | Description |
|------|-------------|
| 200 | Success |
| 404 | Job not found |

---

### POST /jobs/{name}/run
**Auth:** Required  
**Role:** operator, admin  
**Param:** `name` — job name

Trigger an immediate manual run of the job.

**Response:**
```json
{
  "started": true
}
```

| Code | Description |
|------|-------------|
| 200 | Run queued successfully |
| 403 | Insufficient role |
| 404 | Job not found |
| 409 | A run for this job is already in progress |
| 429 | Run queue is full; try again shortly |

---

### POST /jobs/{name}/runs/{run_id}/stop
**Auth:** Required  
**Role:** operator, admin  
**Params:** `name` — job name, `run_id` — run ID

Stop a running job.

**Response:**
```json
{
  "stopped": true
}
```

| Code | Description |
|------|-------------|
| 200 | Stop signal sent (may not stop immediately) |
| 403 | Insufficient role |
| 404 | Job not found |

---

### GET /jobs/{name}/playbook
**Auth:** Required  
**Role:** Any  
**Param:** `name` — job name

Retrieve the playbook source code for a job (capped at 256 KiB).

**Response:**
```json
{
  "path": "playbooks/patch.yml",
  "content": "---\n- hosts: all\n  ...",
  "found": true
}
```

| Code | Description |
|------|-------------|
| 200 | Success (found may be false if playbook doesn't exist) |
| 404 | Job not found |

---

## Activity & Status

### GET /activity
**Auth:** Required  
**Role:** Any

Get recent run activity across all jobs (last 100 runs from all jobs).

```json
[
  {
    "job": "nightly-patching",
    "provider": "github",
    "status": "success",
    "at": 1700000000000,
    "duration": 120000,
    "host": "localhost",
    "exit": 0,
    "kind": "task",
    "runId": "nightly-patching-1700000000000"
  }
]
```

| Code | Description |
|------|-------------|
| 200 | Success |

---

### GET /inventory
**Auth:** Required  
**Role:** Any

Get the aggregated Ansible inventory: groups and hosts with reachability status.

```json
{
  "groups": [
    {
      "name": "ubuntuservers",
      "hosts": 5,
      "up": 4,
      "desc": "from repo inventory"
    }
  ],
  "hosts": [
    {
      "name": "web01.example.com",
      "group": "ubuntuservers",
      "ip": "192.168.1.10",
      "os": "Linux",
      "up": true,
      "jobs": 3,
      "lastSeen": 1700000000000
    }
  ]
}
```

| Code | Description |
|------|-------------|
| 200 | Success |

---

### GET /host-stats
**Auth:** Required  
**Role:** Any

Get local host resource usage (CPU %, memory, disk space).

```json
{
  "cpu": 12.5,
  "mem": 45.2,
  "disk": 62.1,
  "source": "host"
}
```

| Code | Description |
|------|-------------|
| 200 | Success |

---

## Configuration

### GET /manifest
**Auth:** Required  
**Role:** Any

Get the currently committed manifest (jobs.yml and rudder.yml) from the first connected repository.

```json
{
  "jobsYaml": "- name: job1\n  cron: ...",
  "rudderYaml": "settings:\n  reconcileSeconds: 120",
  "found": true,
  "playbooks": ["playbooks/patch.yml", "playbooks/deploy.yml"],
  "slug": "org/repo",
  "branch": "main",
  "provider": "github"
}
```

| Code | Description |
|------|-------------|
| 200 | Success |

---

### GET /dashboard
**Auth:** Required  
**Role:** Any

Get the committed dashboard layout (widgets) or null if none is configured.

```json
{
  "cols": 12,
  "widgets": [
    {
      "type": "metric",
      "x": 0,
      "y": 0,
      "w": 6,
      "h": 2,
      "metric": "job.duration"
    }
  ]
}
```

| Code | Description |
|------|-------------|
| 200 | Success |

---

### GET /settings
**Auth:** Required  
**Role:** Any

Get effective operational settings (defaults + overrides from rudder.yml `settings:` block).

```json
{
  "reconcileSeconds": 120,
  "runWorkers": 4,
  "runQueueMax": 100,
  "runTimeoutSeconds": 3600,
  "sshStrict": false,
  "reachability": {
    "intervalSeconds": 60,
    "timeoutSeconds": 5.0,
    "attempts": 3,
    "downAfter": 5
  }
}
```

| Code | Description |
|------|-------------|
| 200 | Success |

---

## Channels & Alerts

### GET /channels
**Auth:** Required  
**Role:** Any

List configured notification channels (Slack, Teams, email, webhooks).

```json
[
  {
    "type": "slack",
    "label": "#alerts",
    "target": "https://hooks.slack.com/services/...",
    "on": ["fail"],
    "enabled": true
  }
]
```

| Code | Description |
|------|-------------|
| 200 | Success |

---

### POST /channels/test
**Auth:** Required  
**Role:** operator, admin

Send a test notification to a channel.

**Request:**
```json
{
  "type": "webhook",
  "target": "https://example.com/webhook"
}
```

**Response:**
```json
{
  "sent": true
}
```

| Code | Description |
|------|-------------|
| 200 | Test notification sent successfully |
| 403 | Insufficient role |
| 502 | Channel test failed (check configuration) |

---

## Secrets & Audit

### GET /secrets
**Auth:** Required  
**Role:** Any

List secret references (Vault paths) and their metadata. Secret values are never returned.

```json
[
  {
    "ref": "vault/ssh-deploy-key",
    "used": 3,
    "rotated": 1700000000000,
    "kind": "ssh-key",
    "rotatable": true
  },
  {
    "ref": "vault/github-app",
    "used": 2,
    "rotated": 0,
    "kind": "token",
    "rotatable": false
  }
]
```

| Code | Description |
|------|-------------|
| 200 | Success |

---

### POST /secrets/rotate
**Auth:** Required  
**Role:** admin

Rotate the Rudder-managed SSH key. Operator-supplied secrets (git tokens, vault passwords) are rotated via the Credentials endpoint.

**Response:**
```json
{
  "public": "ssh-rsa AAAA...",
  "rotated": 1700000000000
}
```

| Code | Description |
|------|-------------|
| 200 | Key rotated successfully |
| 403 | Insufficient role |
| 502 | Rotation failed (check Vault connectivity) |

---

### GET /audit
**Auth:** Required  
**Role:** admin

Get the audit trail (last 200 entries): who did what, when, and from where.

```json
[
  {
    "at": 1700000000000,
    "principal": "alice@corp.com",
    "role": "admin",
    "action": "repo.add",
    "target": "https://github.com/org/repo",
    "source_ip": "203.0.113.5",
    "detail": ""
  }
]
```

| Code | Description |
|------|-------------|
| 200 | Success |
| 403 | Insufficient role (admin only) |

---

## Error Handling

All error responses follow the format:

```json
{
  "detail": "descriptive error message"
}
```

**Common status codes:**
- `200` — Success
- `204` — Success, no content
- `400` — Bad request (invalid payload)
- `401` — Unauthorized (missing or invalid API key)
- `403` — Forbidden (insufficient role)
- `404` — Not found (resource doesn't exist)
- `409` — Conflict (e.g., run already in progress)
- `429` — Too many requests (run queue full)
- `502` — Bad gateway (external service error, e.g., Vault down)
