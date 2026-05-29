# Daemon and dashboard demo runbook

Operator guide for the **shareable** Tarmac demo: local FP tree, orchestrator `daemon` loop, HTTP dashboard, fake vs real Cursor, and the worker PR/reconcile path.

## Related docs

| Doc                                                                                                                            | Use when                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| [architecture/SPEC.md](../architecture/SPEC.md)                                                                                | Behavioral contract, components, invariants           |
| [architecture/fp-boundary.md](../architecture/fp-boundary.md)                                                                  | `tarmac_*` properties, eligibility, writer boundaries |
| [GETTING_STARTED.md](../../GETTING_STARTED.md)                                                                                 | Install, FP link, CLI flags, first fake dispatch      |
| [local-observability.md](./local-observability.md)                                                                             | `.tarmac/` ledger, `status`, dashboard endpoints      |
| [dispatch-capacity-and-bouts.md](./dispatch-capacity-and-bouts.md)                                                             | Concurrency cap, parent/child bouts                   |
| [fp-rest-no-clone.md](./fp-rest-no-clone.md)                                                                                   | Worker REST mode from outside the repo                |
| [cursor/cloud-agent-api.md](./cursor/cloud-agent-api.md)                                                                       | Cursor Cloud Agent API surface                        |
| [ops/cursor/README.md](../../ops/cursor/README.md)                                                                             | Host bootstrap, env boundaries                        |
| [.agents/skills/thermo-nuclear-code-quality-review/SKILL.md](../../.agents/skills/thermo-nuclear-code-quality-review/SKILL.md) | Pre-PR maintainability review (workers and humans)    |
| [.cursor/skills/fp-ticket/SKILL.md](../../.cursor/skills/fp-ticket/SKILL.md)                                                   | Cloud worker issue-to-PR loop                         |
| [testing/daemon-dashboard-verification-checklist.md](../testing/daemon-dashboard-verification-checklist.md)                    | Pre-demo and post-change verification                 |

## Prerequisites

From the repository root (not a nested clone):

```bash
bun install
fp init -y    # if this checkout is not yet an FP project
fp project test-connection   # when using Console-linked FP
```

Confirm you are on the intended base revision before a real dispatch (workers pin `tarmac_base_sha`):

```bash
git rev-parse HEAD
git status --short
```

Secret hygiene: never commit or paste API keys, FP tokens, GitHub tokens, or dotenv contents into repo files, prompts, FP comments, PR text, logs, or dashboard output. Host Cursor credentials belong in `ops/cursor/.env` (gitignored) or the host environment only.

## Modes at a glance

| Mode              | `--cursor` | Cursor credentials                                          | FP                                                     | Git checkout                                       |
| ----------------- | ---------- | ----------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| **Fake demo**     | `fake`     | None                                                        | Local `fp` from repo root                              | Remotes used for context; pushed HEAD not required |
| **Real dispatch** | `real`     | Host `CURSOR_API_KEY`; worker FP REST env via launch config | Local `fp` for orchestrator; workers use REST no-clone | Clean tree; local HEAD must match remote base ref  |

CLI source of truth: `apps/tarmac-orchestrator/src/cli.ts`.

## Setup: fake local dashboard demo

Goal: an operator with **no** Cursor Cloud credentials can show scan → dispatch → dashboard → local logs.

### 1. Prepare FP work

```bash
fp tree
fp issue list --status todo
```

Create or pick child issues under a parent bout if you want rollup UI (see [dispatch-capacity-and-bouts.md](./dispatch-capacity-and-bouts.md)). Mark executable children ready:

```bash
fp issue update <child-id> --status todo --property tarmac_ready=true
```

Canonical wire value is `tarmac_ready=true` (not desktop label text `Ready`).

### 2. Terminal A — daemon (persisted loop)

```bash
bun run tarmac daemon --cursor fake --poll-interval 5
```

`daemon` is the long-running equivalent of `watch`: it scans eligible issues, respects `TARMAC_MAX_CONCURRENT_RUNS` (default `1`), claims, and dispatches fake Cursor runs. Local history is written under `.tarmac/` by default.

Single iteration (smoke without a long process):

```bash
bun run tarmac watch --cursor fake --once
```

### 3. Terminal B — dashboard

```bash
bun run tarmac dashboard
```

Default URL: `http://127.0.0.1:3847/`. The UI polls `GET /api/status` every five seconds. It is **read-only** and does not mutate FP.

Useful flags:

| Flag               | Effect                                              |
| ------------------ | --------------------------------------------------- |
| `--host 127.0.0.1` | Bind address (default loopback)                     |
| `--port 3847`      | Port (default `3847`)                               |
| `--no-live-scan`   | Show only cached `.tarmac/` data; skip live FP scan |

### 4. What to show in the UI

- **Issue queue**: grouped Active, Needs attention, Eligible, Blocked, Done, and Unknown buckets (display labels only).
- **Issue detail**: selected issue FP/tarmac fields, links, and last error.
- **Bout rollup**: parent rollups with child eligibility, runs, and PR links.
- **Run ledger**: local session cards from `.tarmac/runs.jsonl` with command, status, and summary counts.
- **Dispatch timeline**: structured events from persisted run events (not parsed log strings).
- **Logs**: redacted monospace rows from `.tarmac/runs/<run-id>/events.jsonl`.

Refresh is the only dashboard command. Scan/Run/Reconcile/Watch controls are not exposed.

Open FP issue rows and follow inferred **Cursor** links only when `tarmac_agent_id` / `tarmac_cursor_url` are populated (fake mode uses deterministic fake IDs).

### 5. Local logs (CLI)

```bash
bun run tarmac status --limit 5 --events 20
tail -n 20 .tarmac/runs.jsonl
```

Paths and event types: [local-observability.md](./local-observability.md).

## Setup: real Cursor path

Use after fake mode is understood and gates in [GETTING_STARTED.md](../../GETTING_STARTED.md) are green.

### Host

1. Copy `ops/cursor/.env.example` → `ops/cursor/.env` (gitignored); set host-only values documented in `ops/cursor/README.md`.
2. Ensure the GitHub repo is visible to your Cursor account.
3. Link FP to Console: `fp project remote`, `fp project link`, `fp project test-connection`.
4. Export worker REST variables (non-secret helper): `bun run fp:rest-env -- --shell`; set the token in the shell after `fp auth login` — do not log it.

### Repository gates (orchestrator)

Real mode calls `readRepositoryContext` with `requireLocalHeadAtRemote: true`:

- Working tree **clean**.
- Local `HEAD` matches remote `CURSOR_BASE_REF` (default `main`) on `CURSOR_REMOTE_NAME` (default `origin`).
- Push commits before dispatch.

### Gated proofs (optional but recommended)

```bash
bun run e2e:fp-rest          # REST property round-trip from non-repo dir
TARMAC_FP_REST_ATTACH_E2E=1 bun run e2e:fp-rest-attach  # REST fp attach smoke
bun run e2e:cursor-bootstrap   # live Cursor worker bootstrap smoke
```

### Run real daemon + dashboard

```bash
bun run tarmac daemon --cursor real --poll-interval 10
bun run tarmac dashboard
```

Watch FP for orchestrator-written fields (`tarmac_claim_id`, `tarmac_agent_id`, `tarmac_run_id`, `tarmac_cursor_url`, `tarmac_base_sha`). After handoff, the **Cursor worker** owns branch, PR, `tarmac_pr_*`, verification comments, and terminal `tarmac_state` / `status`.

## Expected FP properties during a demo

Full table: [fp-boundary.md](../architecture/fp-boundary.md).

| Phase            | Who writes             | Fields operators care about                                                                                                                                       |
| ---------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Human ready      | Planner                | `tarmac_ready=true`, `status=todo`, dependencies satisfied                                                                                                        |
| Claim / launch   | Orchestrator           | `status=in-progress`, `tarmac_state=active`, `tarmac_claim_id`, `tarmac_attempt`, then `tarmac_agent_id`, `tarmac_run_id`, `tarmac_cursor_url`, `tarmac_base_sha` |
| Worker handoff   | Cursor worker          | `tarmac_branch`, `tarmac_pr_url`, `tarmac_pr_number`, `tarmac_head_sha`, verification comments                                                                    |
| Terminal success | Worker                 | `tarmac_state=end`, `status=done` (per team policy)                                                                                                               |
| Failure          | Orchestrator or worker | `tarmac_state=needs-attention`, `tarmac_last_error` (redacted)                                                                                                    |

Inspect from CLI:

```bash
fp issue show <issue-id>
fp comment list <issue-id>
```

## PR and reconcile loop

After Cursor handoff, operators and workers follow the GitHub PR, not the dashboard.

### Worker responsibilities

Documented in [.cursor/skills/fp-ticket/SKILL.md](../../.cursor/skills/fp-ticket/SKILL.md):

- Push branch; use Cursor auto-created PR when enabled.
- Run verification (`bun run test`, `bun run format:check`, `bun run check` for code changes).
- Run [thermo-nuclear review](../../.agents/skills/thermo-nuclear-code-quality-review/SKILL.md) and complete `.github/pull_request_template.md` before opening/updating the PR.
- Record PR URL, head SHA, and terminal `tarmac_*` in FP (no credential names or values).

### Orchestrator reconcile

When a Cursor run is terminal but FP is stale:

```bash
bun run tarmac reconcile <issue-id> --cursor fake   # or real
```

Reconcile refreshes observed Cursor state and may post a terminal run/PR comment without relaunching. It does not replace worker PR babysitting.

### Merge completed work

Human merges the PR when CI and review are green. Confirm FP shows `tarmac_pr_url` and terminal state before closing the issue.

## Meetup demo script (~15 minutes)

Assumes repo is installed, FP initialized, and at least one parent with two child issues.

| Step | Action                                                        | Talking point                                                                         |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1    | `fp tree`                                                     | Work is tracked in FP; parent is planning, children execute.                          |
| 2    | Mark children `tarmac_ready=true`                             | Human gate; wire value `true`, not UI label text.                                     |
| 3    | `bun run tarmac scan --cursor fake`                           | JSON eligibility, capacity, `parentRollups`.                                          |
| 4    | Start `bun run tarmac daemon --cursor fake --poll-interval 5` | Long-running loop; mention `.tarmac/` persistence.                                    |
| 5    | Start `bun run tarmac dashboard` in second terminal           | Local-only UI; default `127.0.0.1:3847`.                                              |
| 6    | Browser: issue queue + bout rollup                            | Eligible children vs blocked parent; active runs; logs pane shows redacted excerpts.  |
| 7    | Browser: run cards + log excerpt                              | Redaction; join keys `runId` / `baseSha`.                                             |
| 8    | `fp issue show <child-id>`                                    | `tarmac_*` after fake dispatch.                                                       |
| 9    | Open `tarmac_cursor_url` (fake or real)                       | Inferred Cursor link; real path needs credentials.                                    |
| 10   | Show PR on GitHub (real path) or explain fake branch metadata | Worker owns PR after handoff.                                                         |
| 11   | `bun run tarmac reconcile <issue-id> --cursor fake`           | Terminal sync without relaunch.                                                       |
| 12   | Mention worker checklist + thermo-nuclear PR attestation      | Link [verification checklist](../testing/daemon-dashboard-verification-checklist.md). |

Optional pacing: run `watch --once` instead of `daemon` for a single dispatch beat, then start `daemon` for the “always on” story.

## Degraded modes

| Condition                       | Symptom                                       | Operator response                                                                                   |
| ------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Missing Cursor credentials**  | `real` launch fails immediately               | Stay on `--cursor fake`; configure `ops/cursor/.env` before real demo                               |
| **Unlinked FP remote**          | `fp project remote` errors; worker REST fails | `fp project link`; `fp project test-connection`; see [GETTING_STARTED.md](../../GETTING_STARTED.md) |
| **Dirty or unpushed checkout**  | Real mode refuses launch                      | `git status`; commit; `git push`; align `HEAD` with `origin/main` (or configured base ref)          |
| **Failing CI on open PR**       | GitHub checks red                             | Worker babysits per fp-ticket skill; do not mark FP done until green or human handoff               |
| **No open PRs**                 | `tarmac_pr_url` empty while run active        | Normal pre-handoff; wait for worker or run `reconcile` after terminal Cursor state                  |
| **FP unavailable**              | Dashboard scan empty or errors                | `dashboard --no-live-scan` to show cached runs; fix local `fp` / network                            |
| **Second orchestrator process** | Duplicate dispatch risk                       | Run one `daemon` per repo; see [fp-boundary.md](../architecture/fp-boundary.md) claim limits        |
| **Corrupt local JSONL**         | `status` reports `corruptEventLineCount`      | Trim or delete `.tarmac/` for a clean slate (gitignored)                                            |

## Verification

Before sharing the demo or merging doc changes, use [daemon-dashboard-verification-checklist.md](../testing/daemon-dashboard-verification-checklist.md).

Root package scripts (from `package.json`):

```bash
bun run format:check
bun run check
bun run test
```

Scoped orchestrator tests when touching CLI or dashboard behavior:

```bash
bun run --filter @tarmac/orchestrator test
```
