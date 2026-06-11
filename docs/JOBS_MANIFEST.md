# Rudder Job Manifest Format

The job manifest (`jobs.yml` or `ansible/jobs.yml` in your repository) declares which Ansible playbooks run, where, and when. Rudder parses this file on every reconcile and regenerates the cron schedule automatically.

## File Location & Format

The manifest can be placed at:
- `jobs.yml` (repository root)
- `ansible/jobs.yml` (standard Ansible subdirectory)

The file must be valid YAML. It can be:
1. A bare list of job entries
2. Under a `jobs:` key
3. Under a `scheduled_jobs:` key

**Example (bare list):**
```yaml
- name: nightly-patching
  cron: "0 3 * * *"
  playbook: playbooks/patch.yml
  limit: ubuntuservers
```

**Example (under `jobs:` key):**
```yaml
jobs:
  - name: nightly-patching
    cron: "0 3 * * *"
    playbook: playbooks/patch.yml
    limit: ubuntuservers
```

## Job Entry Structure

Each job is a YAML map with the following fields:

### Required Fields

#### `name`
- **Type:** string
- **Description:** Unique identifier for the job across all repositories
- **Constraints:** Must be alphanumeric with hyphens/underscores; no spaces
- **Example:** `"nightly-patching"`

#### `cron`
- **Type:** string
- **Description:** Standard cron expression for scheduling
- **Format:** `"minute hour day-of-month month day-of-week"`
- **Examples:**
  - `"0 3 * * *"` — 3 AM daily
  - `"*/5 * * * *"` — every 5 minutes
  - `"0 0 1 * *"` — first day of every month
  - `"0 2 * * 1-5"` — 2 AM weekdays only
- **Note:** Rudder uses APScheduler's CronTrigger; see [cron syntax reference](https://en.wikipedia.org/wiki/Cron#CRON_expression)

#### `playbook`
- **Type:** string
- **Description:** Path to the Ansible playbook (relative to repository root)
- **Example:** `"playbooks/patch.yml"` or `"ansible/site.yml"`

#### `limit`
- **Type:** string
- **Description:** Ansible inventory target (group, host, or "all")
- **Examples:**
  - `"all"` — run against all hosts in the inventory
  - `"ubuntuservers"` — run against the `ubuntuservers` group
  - `"web01.example.com"` — run against a single host
- **Semantics:** Passed directly to `ansible-playbook -l <limit>`

### Optional Fields

#### `kind`
- **Type:** string
- **Default:** `"task"`
- **Allowed Values:** `"task"`, `"dsc"`
- **Description:** Job classification for the UI and alerting
- **Semantics:**
  - `"task"` — standard Ansible task (playbook runs and reports status)
  - `"dsc"` — desired-state configuration (job heals drift; failures may be expected/tolerated)
- **Example:** `kind: "dsc"`

#### `desc`
- **Type:** string
- **Default:** `""` (empty string)
- **Description:** Human-readable job description for the UI
- **Example:** `"Apply security updates across the fleet"`

#### `extra_args`
- **Type:** string
- **Default:** `null` (no extra arguments)
- **Description:** Additional Ansible command-line arguments passed to `ansible-playbook`
- **Examples:**
  - `"-v"` — verbose output
  - `"-e key=value"` — set extra variables
  - `"--check"` — dry-run / check mode
- **Note:** Arguments are stored as-is; no quoting or parsing is performed; Rudder does not validate these

## Field Type Reference

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `name` | string | Yes | — |
| `cron` | string | Yes | — |
| `playbook` | string | Yes | — |
| `limit` | string | Yes | — |
| `kind` | string | No | `"task"` |
| `desc` | string | No | `""` |
| `extra_args` | string | No | `null` |

## Parsing & Validation Rules

1. **Manifest Discovery:** Rudder searches for `jobs.yml`, `ansible/jobs.yml`, etc. in order. The first file found is parsed; only one manifest per repository is supported.

2. **YAML Parsing:** The file must be valid YAML. Syntax errors are logged during reconcile; jobs fail to render but don't crash the control-plane.

3. **Job Name Uniqueness:** Job names must be unique **across all connected repositories**. If two repositories define the same job name, the second one overwrites the first during reconcile.

4. **Cron Validation:** Invalid cron expressions are logged. Jobs with bad cron syntax are skipped and don't appear in the schedule.

5. **Playbook Resolution:**
   - Paths are relative to the repository root
   - The playbook file must exist (verified during the run, not during manifest parsing)
   - If the file is missing at run time, the run fails

6. **Limit Semantics:**
   - `"all"` is a literal value (same as no `-l` in `ansible-playbook`)
   - Other limits are passed to Ansible; invalid groups/hosts cause run failures at execution time

7. **Extra Fields:** Unknown fields in a job entry are silently ignored.

## Example Manifest

```yaml
- name: ping-fleet
  cron: "*/2 * * * *"
  playbook: ansible/playbooks/ping.yml
  limit: targets
  desc: Reachability + uptime check across the fleet.

- name: set-motd
  cron: "*/5 * * * *"
  playbook: ansible/playbooks/motd.yml
  limit: targets
  kind: dsc
  desc: Ensure the managed message-of-the-day is present (heals drift).

- name: disk-check
  cron: "*/3 * * * *"
  playbook: ansible/playbooks/disk-check.yml
  limit: targets
  desc: Report root filesystem usage.

- name: weekly-deploy
  cron: "0 2 * * 0"
  playbook: playbooks/deploy.yml
  limit: all
  kind: task
  extra_args: "-e environment=prod"
  desc: Weekly production deployment.
```

## Integration with rudder.yml

The manifest is separate from the operational configuration (`rudder.yml`). While `jobs.yml` declares the schedule, `rudder.yml` in the same repository can define:

- `settings:` — operational parameters (reconcile interval, run timeout, etc.)
- `alerts:` — notification channels and rules
- `dashboard:` — custom Overview layout (widgets)

Both files are parsed on every reconcile; changes to either are picked up automatically.

## Common Patterns

### Minimal Job
```yaml
- name: check-status
  cron: "0 * * * *"
  playbook: check.yml
  limit: all
```

### Weekly Maintenance (Sunday, 3 AM)
```yaml
- name: weekly-maintenance
  cron: "0 3 * * 0"
  playbook: maintenance.yml
  limit: all
  desc: Weekly infrastructure maintenance
```

### Environment-Specific Job (with extra variables)
```yaml
- name: deploy-prod
  cron: "0 2 * * *"
  playbook: deploy.yml
  limit: prod-servers
  extra_args: "-e environment=production -e skip_tests=true"
  desc: Deploy to production
```

### Drift Remediation (DSC)
```yaml
- name: enforce-config
  cron: "*/30 * * * *"
  playbook: enforce.yml
  limit: all
  kind: dsc
  desc: Continuous configuration enforcement
```

## Troubleshooting

### Job not appearing in the UI
- Ensure the manifest file is in one of the expected locations
- Check the reconcile logs for YAML parse errors
- Verify all required fields are present

### Jobs not running at scheduled time
- Check the cron expression syntax
- Verify the playbook file exists in the repository
- Confirm the repository has been reconciled (check `/reconcile` endpoint)

### Run fails immediately
- Verify the playbook path is correct
- Check that the `limit` target exists in your inventory
- Look at run logs for Ansible errors

### Secrets not available during run
- Confirm SSH key and/or Vault password are configured via the UI
- Check that the playbook references the correct variable names
