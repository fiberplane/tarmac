# FP Boundary

Status: Active

This document defines the FP side of Tarmac's dispatch contract.

## Property Surface

Source of truth: `.fp/extensions/tarmac-dispatch.ts`.

| Property            | Type                                                 | Writer                                            | Meaning                           |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| `tarmac_ready`      | select `true` / `false`                              | Human/planner                                     | Explicit dispatch gate.           |
| `tarmac_state`      | select `idle` / `active` / `end` / `needs-attention` | Orchestrator before handoff; worker after handoff | Coarse human-visible run state.   |
| `tarmac_attempt`    | text                                                 | Orchestrator                                      | Attempt counter.                  |
| `tarmac_agent_id`   | text                                                 | Orchestrator                                      | Cursor durable agent ID.          |
| `tarmac_run_id`     | text                                                 | Orchestrator                                      | Cursor run ID.                    |
| `tarmac_branch`     | text                                                 | Worker                                            | Git branch pushed by Cursor.      |
| `tarmac_pr_url`     | text                                                 | Worker                                            | Durable GitHub PR artifact.       |
| `tarmac_pr_number`  | text                                                 | Worker                                            | Numeric GitHub PR number as text. |
| `tarmac_base_sha`   | text                                                 | Orchestrator or worker                            | Pinned base revision.             |
| `tarmac_head_sha`   | text                                                 | Worker                                            | Latest pushed head revision.      |
| `tarmac_last_error` | text                                                 | Orchestrator or worker                            | Redacted failure summary.         |

## Eligibility

A candidate is eligible only when all conditions hold:

- built-in `status` is `todo`;
- `tarmac_ready` is `true`;
- no dependency is currently open;
- no child issue is currently open;
- issue ID is not already in the orchestrator's active run index;
- known `tarmac_*` properties decode successfully.

`tarmac_state` is not authoritative. `needs-attention` can be re-armed by a
human by returning the issue to `todo` while leaving `tarmac_ready=true`.

## Writer Boundary

Before Cursor handoff, the orchestrator may:

- claim the issue with `status=in-progress`;
- set `tarmac_state=active`;
- set `tarmac_attempt`, `tarmac_agent_id`, `tarmac_run_id`, and
  `tarmac_base_sha`;
- comment with a redacted launch summary.

After Cursor handoff, the worker owns:

- branch and PR creation;
- `tarmac_branch`, `tarmac_pr_url`, `tarmac_pr_number`, `tarmac_head_sha`;
- verification comments;
- final `status` and `tarmac_state`.

The orchestrator can still reconcile Cursor terminal errors that happen before
the worker reports, but it must not overwrite populated PR metadata.

## REST/No-Clone Requirements

Cursor workers must run FP commands from a non-repo workdir:

```bash
mkdir -p /tmp/fp-rest-ticket
cd /tmp/fp-rest-ticket
FP_REMOTE=rest-api fp issue show "$ISSUE_ID" --format json
```

Required env:

- `FP_REMOTE=rest-api`
- `FP_TOKEN`
- `FP_WORKSPACE`
- `FP_PROJECT_ID`
- `FP_SERVER_URL`
- `FP_PROJECT_PREFIX=TARM`

No FP token may appear in repo files, shell profiles, git remotes, PR text,
issue comments, logs, or artifacts.
