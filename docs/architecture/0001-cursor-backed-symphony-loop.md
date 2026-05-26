# ADR 0001 - Cursor-Backed Symphony Loop

Date: 2026-05-26
Status: Accepted

## Context

Tarmac explores a Symphony-like autonomous software loop with a different worker
runtime. Symphony and Switchyard assume a scheduler that talks to a runner such
as Codex app-server. Tarmac keeps the tracker/scheduler shape, but dispatches
eligible FP issues to Cursor Cloud Agents.

The motivating demo is explicit: set an FP custom property from the desktop app,
have Tarmac notice the change, launch a Cursor worker, and end with a branch/PR
plus FP metadata.

## Decisions

### D1. FP custom properties are the trigger and run ledger

The dispatch trigger is `tarmac_ready=true` on a `todo` issue. Runtime metadata
is recorded in `tarmac_*` properties:

- `tarmac_state`
- `tarmac_attempt`
- `tarmac_claim_id`
- `tarmac_agent_id`
- `tarmac_run_id`
- `tarmac_branch`
- `tarmac_pr_url`
- `tarmac_pr_number`
- `tarmac_base_sha`
- `tarmac_head_sha`
- `tarmac_last_error`

Cursor agents continue after the local orchestrator exits, so durable Cursor IDs
must be recoverable from FP rather than only from in-memory state.

### D2. Tarmac replaces Codex app-server with Cursor Cloud Agents

Do not port Symphony's Codex app-server transport, thread, turn, dynamic-tool, or
stdio protocol layers. The Tarmac runner boundary is a `CursorAgentClient` over
the current Cursor SDK/API.

The local orchestrator owns candidate scan, eligibility, claim, launch, and
pre-handoff failure routing. Cursor owns remote code execution and Git branch/PR
handoff.

### D3. Cursor workers use FP REST/no-clone mode

Workers must run `fp` from a non-repo directory with env-only project identity:

- `FP_REMOTE=rest-api`
- `FP_TOKEN`
- `FP_WORKSPACE`
- `FP_PROJECT_ID`
- `FP_SERVER_URL`
- optional `FP_PROJECT_PREFIX`

The code checkout is for git work. The FP context is a remote tracker context and
must not depend on a local `.fp` directory.

### D4. The worker owns PR completion after handoff

After the Cursor run starts successfully, Cursor owns the remote branch/PR
artifact and the worker owns verification evidence, FP progress comments, PR
metadata, and terminal issue state.

For the first real demo, use Cursor `autoCreatePR` where available. The worker
records the Cursor-created PR URL in FP. A separate `gh`-driven PR path is
allowed only behind a GitHub-token provisioning gate.

The orchestrator may reconcile and report observed Cursor failures, but it
should not overwrite successful worker-owned PR metadata.

This intentionally follows the remote-PR shape from Switchyard's remote sandbox
proposal and supersedes the older archive/bundle artifact model.

### D5. Retry is human-gated for the prototype

Launch/setup failures and Cursor terminal errors move the issue to
`tarmac_state=needs-attention` with a redacted `tarmac_last_error`. A human can
re-arm by moving the issue back to `todo` with `tarmac_ready=true`.

No automatic retry/backoff is part of the first demo.

### D6. Guardrails are part of the product surface

The repo must carry enough guardrails for local agents and Cursor workers:

- FP extensions for properties and issue quality.
- Git 2.54 config-based hooks for staged linting and drift checks.
- Ast-grep rules inherited from Otter for TypeScript/Effect boundaries.
- Cursor worker skill for FP REST/no-clone issue-to-PR workflow.
- Thermonuclear maintainability review skill for strict review.
- Secret hygiene docs and tests before any real launch path.

## Consequences

Positive:

- The demo maps to Cursor's native strengths: cloud clone, branch, PR, artifacts,
  and UI handoff.
- FP remains the human-visible system of record.
- The old Codex app-server protocol surface is avoided entirely.

Negative:

- We depend on Cursor API/SDK stability and GitHub app permissions.
- Worker-side FP writes require REST/no-clone custom-property behavior to work.
- Restart recovery requires careful reconciliation from FP properties and Cursor
  run status.

## Follow-Ups

- Prove `FP_REMOTE=rest-api fp issue update --property tarmac_*` from a non-repo
  directory.
- Implement a fake Cursor client first, then gate real Cursor calls behind env.
- Add webhook support only after polling works.
- Keep `fiberplane/tarmac` pushed and verify required files exist on the remote
  before every real Cursor launch.
