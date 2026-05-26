# FP Boundary

Status: Active

This document defines the FP side of Tarmac's dispatch contract.

## Property Surface

Source of truth: `.fp/extensions/tarmac-dispatch.ts`.

| Property            | Type                                                 | Writer                                            | Meaning                                                                                            |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `tarmac_ready`      | select `true` / `false`                              | Human/planner                                     | Explicit dispatch gate.                                                                            |
| `tarmac_state`      | select `idle` / `active` / `end` / `needs-attention` | Orchestrator before handoff; worker after handoff | Coarse human-visible run state.                                                                    |
| `tarmac_attempt`    | text                                                 | Orchestrator                                      | Attempt counter.                                                                                   |
| `tarmac_claim_id`   | text                                                 | Orchestrator                                      | Durable idempotent claim key.                                                                      |
| `tarmac_agent_id`   | text                                                 | Orchestrator                                      | Cursor durable agent ID.                                                                           |
| `tarmac_run_id`     | text                                                 | Orchestrator                                      | Cursor run ID.                                                                                     |
| `tarmac_cursor_url` | text                                                 | Orchestrator                                      | Inferred Cursor Cloud run URL (from `tarmac_agent_id`; not an official Cursor deep-link contract). |
| `tarmac_branch`     | text                                                 | Worker                                            | Git branch pushed by Cursor.                                                                       |
| `tarmac_pr_url`     | text                                                 | Worker                                            | Durable GitHub PR artifact.                                                                        |
| `tarmac_pr_number`  | text                                                 | Worker                                            | Numeric GitHub PR number as text.                                                                  |
| `tarmac_base_sha`   | text                                                 | Orchestrator or worker                            | Pinned base revision.                                                                              |
| `tarmac_head_sha`   | text                                                 | Worker                                            | Latest pushed head revision.                                                                       |
| `tarmac_last_error` | text                                                 | Orchestrator or worker                            | Redacted failure summary.                                                                          |

## Eligibility

A candidate is eligible only when all conditions hold:

- built-in `status` is `todo`;
- `tarmac_ready` is `true`;
- no dependency is currently open;
- no child issue is currently open;
- issue ID is not already in the orchestrator's active run index;
- issue has no active `tarmac_agent_id` / `tarmac_run_id` unless reconcile proves
  it is terminal and re-armable;
- known `tarmac_*` properties decode successfully.

The canonical wire values for `tarmac_ready` are `"true"` and `"false"`.
Desktop labels such as `Ready` and `Not Ready` are display text only.

`tarmac_state` is not authoritative by itself. `needs-attention` can be
re-armed by a human by returning the issue to `todo` while leaving
`tarmac_ready=true`; the orchestrator must preserve prior branch/PR metadata and
write a new `tarmac_claim_id` before relaunch.

## State Machine

| State                  | Required fields                                                                               | Meaning                                                                                 | Next states                              |
| ---------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------- |
| `idle`                 | none                                                                                          | Human-visible default before claim.                                                     | `active`, `needs-attention`              |
| `active` before launch | `tarmac_claim_id`, `tarmac_attempt`                                                           | Orchestrator has claimed and is preparing Cursor launch.                                | `active` with run IDs, `needs-attention` |
| `active` after launch  | `tarmac_claim_id`, `tarmac_agent_id`, `tarmac_run_id`, `tarmac_cursor_url`, `tarmac_base_sha` | Cursor run exists or is being reconciled.                                               | `end`, `needs-attention`                 |
| `end`                  | `tarmac_pr_url` or terminal worker comment                                                    | Worker reported success or durable PR handoff.                                          | none unless human reopens                |
| `needs-attention`      | `tarmac_last_error`                                                                           | Launch, Cursor, FP REST, verification, cancellation, expiry, or worker handoff failure. | `active` after human re-arm              |

Cursor `ERROR`, `EXPIRED`, and cancelled runs map to `needs-attention` unless
the worker already wrote a successful PR handoff. Cursor `FINISHED` maps to
`end` only after PR metadata or an explicit worker terminal comment is present.

## Writer Boundary

Before Cursor handoff, the orchestrator may:

- claim the issue with `status=in-progress`;
- set `tarmac_state=active`;
- set `tarmac_attempt`, `tarmac_claim_id`, `tarmac_agent_id`, `tarmac_run_id`,
  `tarmac_cursor_url`, and `tarmac_base_sha`;
- comment with the Cursor run URL (once per run) and a redacted launch summary when needed.

After Cursor handoff, the worker owns:

- branch and PR creation;
- `tarmac_branch`, `tarmac_pr_url`, `tarmac_pr_number`, `tarmac_head_sha`;
- verification comments;
- final `status` and `tarmac_state`.

The orchestrator can still reconcile Cursor terminal errors that happen before
the worker reports, but it must not overwrite populated PR metadata.

## Claim Protocol

Tarmac's first implementation has a load-bearing single-orchestrator-process
assumption. It does not claim cross-process exactly-once dispatch.

Within one process, claim is serialized by an in-process mutex keyed by issue ID
and then uses a write-and-confirm protocol:

1. Generate a unique `tarmac_claim_id` for this runner and attempt.
2. Update the issue in one FP call with `status=in-progress`,
   `tarmac_state=active`, `tarmac_attempt`, and `tarmac_claim_id`.
3. Re-read the issue before launching Cursor.
4. Proceed only if the re-read issue still has this runner's `tarmac_claim_id`,
   no `tarmac_agent_id`, and no `tarmac_run_id`.
5. Abort without launching if ownership is lost or run IDs are already present.

This prevents duplicate dispatches inside one `tarmac watch` or `run-one`
process and catches many stale-state restarts. It does not prevent two separate
Tarmac processes from racing if both operators run them at once.

If FP later exposes conditional updates or expected-version writes, or if Tarmac
adds a durable lock store, replace this protocol with a true compare-and-set.
Until then, tests cover same-process duplicate suppression and document the
multi-process limitation.

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

Optional env:

- `FP_PROJECT_PREFIX=TARM`

No FP token may appear in repo files, shell profiles, git remotes, PR text,
issue comments, logs, or artifacts.

The first blocking E2E gate must prove custom-property writes from a non-repo
directory. If REST mode cannot see extension-registered properties, Tarmac must
document the server-side registration mechanism or keep worker completion in
comments until property mutation is available.

## Base Revision Contract

Before launch, the orchestrator resolves `CURSOR_BASE_REF` against the remote,
records the exact SHA in `tarmac_base_sha`, and includes that SHA in the worker
prompt/config.

The worker must fetch and checkout the exact `tarmac_base_sha` before editing.
If Cursor cannot start from that commit or the checkout does not match, the
worker reports `needs-attention` instead of continuing on moving `main`.
