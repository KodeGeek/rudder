"""API endpoint integration tests: auth, routing, error paths, success cases."""
import json
import pytest
from fastapi.testclient import TestClient

from app import config, db, main, runner, store


@pytest.fixture
def freshdb(tmp_path, monkeypatch):
    """Isolated store with temp database, for clean endpoint tests."""
    monkeypatch.setattr(config, "DB_FILE", str(tmp_path / "rudder.db"))
    monkeypatch.setattr(config, "STATE_FILE", str(tmp_path / "repos.json"))
    monkeypatch.setattr(config, "RUNS_FILE", str(tmp_path / "runs.json"))
    db.reset()
    store._migrated = False
    store.repos.clear()
    store.runs.clear()
    store.jobs.clear()
    yield tmp_path
    db.reset()


@pytest.fixture
def admin_client(freshdb, monkeypatch):
    """TestClient with admin API key set."""
    monkeypatch.setattr(config, "API_KEY", "admin-secret-key")
    monkeypatch.setattr(config, "API_KEYS", "")
    client = TestClient(main.app)
    client.headers.update({"Authorization": "Bearer admin-secret-key"})
    return client


@pytest.fixture
def viewer_client(freshdb, monkeypatch):
    """TestClient with viewer-role API key."""
    monkeypatch.setattr(config, "API_KEY", "")
    monkeypatch.setattr(config, "API_KEYS", "viewer-key:viewer")
    client = TestClient(main.app)
    client.headers.update({"Authorization": "Bearer viewer-key"})
    return client


@pytest.fixture
def unauthenticated_client(freshdb, monkeypatch):
    """TestClient with no auth header and a key set (to trigger 401)."""
    monkeypatch.setattr(config, "API_KEY", "admin-secret-key")
    monkeypatch.setattr(config, "API_KEYS", "")
    return TestClient(main.app)


@pytest.fixture
def seeded_repo_and_job(admin_client, freshdb):
    """Add a repo and seed a test job into store.jobs."""
    # Add a repo first
    body = {
        "provider": "git",
        "url": "https://github.com/test/test-repo",
        "branch": "main",
        "token": "",
        "authMethod": "",
        "vaultPass": "",
    }
    resp = admin_client.post("/repos", json=body)
    assert resp.status_code == 200
    repo_id = resp.json()["id"]

    # Seed a job into store directly with all required fields (no real reconcile needed)
    store.jobs["test-job"] = {
        "name": "test-job",
        "cron": "",
        "playbook": "playbooks/test.yml",
        "limit": "all",
        "kind": "task",
        "provider": "git",
        "repoSlug": "test/test-repo",
        "branch": "main",
        "_repoId": repo_id,
        "_workdir": str(freshdb),
        "_manifestDir": "",
    }
    store.runs["test-job"] = []

    return admin_client, repo_id


# ── GET /repos ──
def test_get_repos_returns_list(admin_client, seeded_repo_and_job):
    """GET /repos returns a list with expected repo shape."""
    client, _ = seeded_repo_and_job
    r = client.get("/repos")
    assert r.status_code == 200
    repos = r.json()
    assert isinstance(repos, list)
    if repos:
        # Verify shape: id, url, branch, hostKey, vaultPass, etc.
        assert "id" in repos[0]
        assert "url" in repos[0]
        assert "branch" in repos[0]
        assert "hostKey" in repos[0]  # boolean flag
        assert "vaultPass" in repos[0]  # boolean flag


def test_get_repos_empty_when_none_seeded(admin_client):
    """GET /repos returns empty list when no repos added."""
    r = admin_client.get("/repos")
    assert r.status_code == 200
    assert r.json() == []


# ── POST /repos with valid body ──
def test_post_repos_success(admin_client):
    """POST /repos with valid body returns 200."""
    body = {
        "provider": "git",
        "url": "https://github.com/test/another-repo",
        "branch": "main",
    }
    r = admin_client.post("/repos", json=body)
    assert r.status_code == 200
    repo = r.json()
    assert repo["id"] == "git:test/another-repo"
    assert repo["url"] == "https://github.com/test/another-repo"


# ── POST /jobs/{name}/run ──
def test_post_jobs_run_succeeds_for_seeded_job(admin_client, seeded_repo_and_job, monkeypatch):
    """POST /jobs/{name}/run starts a run when job exists."""
    _, _ = seeded_repo_and_job

    # Mock the runner to avoid real Ansible execution.
    def mock_run_async(name):
        # Do nothing; just register the mock call succeeded
        pass

    monkeypatch.setattr(runner, "run_async", mock_run_async)

    r = admin_client.post("/jobs/test-job/run")
    assert r.status_code == 200
    assert r.json()["started"] is True


def test_post_jobs_run_404_for_missing_job(admin_client):
    """POST /jobs/{name}/run returns 404 for nonexistent job."""
    r = admin_client.post("/jobs/no-such-job/run")
    assert r.status_code == 404


# ── POST /jobs/{name}/run — AlreadyRunning ──
def test_post_jobs_run_returns_409_when_already_running(admin_client, seeded_repo_and_job, monkeypatch):
    """POST /jobs/{name}/run returns 409 if a run is already in progress."""
    _, _ = seeded_repo_and_job

    def mock_run_async_busy(name):
        raise runner.AlreadyRunning("a run is already in progress")

    monkeypatch.setattr(runner, "run_async", mock_run_async_busy)

    r = admin_client.post("/jobs/test-job/run")
    assert r.status_code == 409
    assert "already in progress" in r.json()["detail"]


# ── POST /jobs/{name}/run — QueueFull ──
def test_post_jobs_run_returns_429_when_queue_full(admin_client, seeded_repo_and_job, monkeypatch):
    """POST /jobs/{name}/run returns 429 if the run queue is full."""
    _, _ = seeded_repo_and_job

    def mock_run_async_full(name):
        raise runner.QueueFull("run queue full")

    monkeypatch.setattr(runner, "run_async", mock_run_async_full)

    r = admin_client.post("/jobs/test-job/run")
    assert r.status_code == 429
    assert "queue full" in r.json()["detail"]


# ── Viewer role cannot mutate ──
def test_viewer_role_blocked_from_admin_endpoint(viewer_client, freshdb):
    """A viewer-role key is rejected (403) on /repos POST (requires WRITERS role)."""
    body = {
        "provider": "git",
        "url": "https://github.com/test/test-repo",
        "branch": "main",
    }
    r = viewer_client.post("/repos", json=body)
    assert r.status_code == 403
    assert "insufficient role" in r.json()["detail"]


def test_viewer_role_blocked_from_job_run(viewer_client, freshdb):
    """A viewer-role key is rejected (403) on /jobs/{name}/run (requires WRITERS)."""
    # Seed the job with full required structure
    store.jobs["test-job"] = {
        "name": "test-job", "cron": "", "playbook": "playbooks/test.yml",
        "limit": "all", "kind": "task", "provider": "git",
        "repoSlug": "test/test", "branch": "main",
        "_repoId": "git:test/test", "_workdir": str(freshdb), "_manifestDir": "",
    }
    r = viewer_client.post("/jobs/test-job/run")
    assert r.status_code == 403
    assert "insufficient role" in r.json()["detail"]


# ── Unauthenticated requests ──
def test_protected_route_requires_auth(unauthenticated_client):
    """GET /repos without auth returns 401 when API_KEY is set."""
    r = unauthenticated_client.get("/repos")
    assert r.status_code == 401
    assert "invalid or missing API key" in r.json()["detail"]


def test_protected_post_requires_auth(unauthenticated_client):
    """POST /repos without auth returns 401 when API_KEY is set."""
    body = {
        "provider": "git",
        "url": "https://github.com/test/test-repo",
        "branch": "main",
    }
    r = unauthenticated_client.post("/repos", json=body)
    assert r.status_code == 401


# ── GET /metrics — always open ──
def test_metrics_endpoint_open_no_auth(freshdb, monkeypatch):
    """GET /metrics is always open (no Bearer key required)."""
    monkeypatch.setattr(config, "API_KEY", "admin-secret-key")
    monkeypatch.setattr(config, "API_KEYS", "")
    client = TestClient(main.app)  # No Authorization header
    r = client.get("/metrics")
    assert r.status_code == 200
    # Verify it's actually Prometheus format (contains our metrics)
    text = r.text
    assert "rudder_scheduler_running" in text or "HELP" in text


# ── GET /healthz and /readyz — probes always open ──
def test_healthz_always_open(freshdb, monkeypatch):
    """GET /healthz is always open (probe path)."""
    monkeypatch.setattr(config, "API_KEY", "admin-secret-key")
    client = TestClient(main.app)
    r = client.get("/healthz")
    assert r.status_code == 200


def test_readyz_always_open(freshdb, monkeypatch):
    """GET /readyz is always open (probe path)."""
    monkeypatch.setattr(config, "API_KEY", "admin-secret-key")
    client = TestClient(main.app)
    r = client.get("/readyz")
    assert r.status_code in [200, 503]  # 503 if not fully ready, but no auth error


# ── Additional GET routes ──
def test_get_jobs_list(admin_client, seeded_repo_and_job):
    """GET /jobs returns a list of jobs."""
    client, _ = seeded_repo_and_job
    r = client.get("/jobs")
    assert r.status_code == 200
    jobs = r.json()
    assert isinstance(jobs, list)


def test_get_job_by_name(admin_client, seeded_repo_and_job):
    """GET /jobs/{name} returns job details with runs."""
    client, _ = seeded_repo_and_job
    r = client.get("/jobs/test-job")
    assert r.status_code == 200
    job = r.json()
    assert job["name"] == "test-job"
    assert "runs" in job


def test_get_job_404(admin_client):
    """GET /jobs/{name} returns 404 for nonexistent job."""
    r = admin_client.get("/jobs/no-such-job")
    assert r.status_code == 404


def test_get_reconcile_state(admin_client):
    """GET /reconcile returns reconcile state."""
    r = admin_client.get("/reconcile")
    assert r.status_code == 200
    data = r.json()
    assert "lastAt" in data or "nextAt" in data or "intervalMin" in data


def test_get_settings(admin_client):
    """GET /settings returns operational settings."""
    r = admin_client.get("/settings")
    assert r.status_code == 200
    settings = r.json()
    assert isinstance(settings, dict)


def test_get_inventory(admin_client):
    """GET /inventory returns inventory view."""
    r = admin_client.get("/inventory")
    assert r.status_code == 200


def test_get_manifest(admin_client):
    """GET /manifest returns manifest."""
    r = admin_client.get("/manifest")
    assert r.status_code == 200


def test_get_activity(admin_client):
    """GET /activity returns activity log."""
    r = admin_client.get("/activity")
    assert r.status_code == 200


def test_get_dashboard(admin_client):
    """GET /dashboard returns dashboard layout."""
    r = admin_client.get("/dashboard")
    assert r.status_code == 200
    dash = r.json()
    assert "cols" in dash or "widgets" in dash


def test_get_channels(admin_client):
    """GET /channels returns list of alert channels."""
    r = admin_client.get("/channels")
    assert r.status_code == 200


def test_get_secrets(admin_client):
    """GET /secrets returns secret refs (vault integration)."""
    r = admin_client.get("/secrets")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_get_host_stats(admin_client):
    """GET /host-stats returns host statistics."""
    r = admin_client.get("/host-stats")
    assert r.status_code == 200


def test_get_auth_verify(admin_client):
    """GET /auth/verify returns principal info (authenticated)."""
    r = admin_client.get("/auth/verify")
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert "role" in data


def test_get_info(admin_client):
    """GET /info returns bundle and config info."""
    r = admin_client.get("/info")
    assert r.status_code == 200
    info = r.json()
    assert "reconcileInterval" in info


def test_inventory_endpoint_allows_never_seen_host(admin_client, monkeypatch):
    """Regression: a host that has never been probed has lastSeen=None. The
    /inventory response model must accept it (previously a 500
    ResponseValidationError because Host.lastSeen was a required int)."""
    monkeypatch.setattr(store, "inventory_view", lambda: {
        "groups": [{"name": "web", "hosts": 1, "up": 0, "desc": "from repo inventory"}],
        "hosts": [{"name": "web01", "group": "web", "ip": "—", "os": "—",
                   "up": False, "jobs": 0, "lastSeen": None}],
    })
    r = admin_client.get("/inventory")
    assert r.status_code == 200
    assert r.json()["hosts"][0]["lastSeen"] is None


def test_host_stats_endpoint_accepts_nested_usage(admin_client, monkeypatch):
    """Regression: host.stats() returns mem/disk as {used,total,pct} objects,
    not bare floats. The /host-stats response model must accept them (was a 500
    ResponseValidationError)."""
    from app import host
    monkeypatch.setattr(host, "stats", lambda: {
        "cpu": 12.5,
        "mem": {"used": 1195847680, "total": 2063581184, "pct": 58.0},
        "disk": {"used": 24679157760, "total": 51460472832, "pct": 48.0},
        "source": "host",
    })
    r = admin_client.get("/host-stats")
    assert r.status_code == 200
    body = r.json()
    assert body["mem"]["pct"] == 58.0 and body["disk"]["used"] == 24679157760
