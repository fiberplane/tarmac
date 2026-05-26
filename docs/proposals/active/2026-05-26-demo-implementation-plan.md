# Demo Implementation Plan

Status: Draft
Date: 2026-05-26

## Goal

Demonstrate a property-triggered FP to Cursor Cloud Agent loop:

1. A human sets `tarmac_ready=Ready` on an FP issue.
2. Tarmac detects the issue as eligible.
3. Tarmac dispatches a Cursor Cloud Agent.
4. Cursor works the issue with FP REST/no-clone context.
5. The result is a GitHub PR and `tarmac_*` metadata on the issue.

## Implementation Slices

### 1. Foundation

- Keep the Otter-style monorepo scaffold, QA package, ast-grep rules, drift, and
  Git 2.54 hooks.
- Register Tarmac FP properties via `.fp/extensions/tarmac-dispatch.ts`.
- Vendor Cursor worker skills under `.cursor/skills/`.
- Track Cursor references under `docs/reference/` and ignored `references/`.

### 2. FP Domain Tracebullet

Create `packages/fp-domain` with pure, tested logic:

- decode `tarmac_*` properties;
- build an open issue index;
- evaluate eligibility;
- create claim/update intents;
- prove idempotency for already-running issues.

Red tests first:

- ready todo issue dispatches;
- non-ready issue does not dispatch;
- open dependency blocks;
- open child blocks;
- malformed property blocks;
- issue with existing run ID does not launch twice.

### 3. Cursor Client Tracebullet

Create `packages/cursor-client` with a small interface and fake implementation:

- `createAgentRun(request)`;
- `getRun(agentId, runId)`;
- optional `streamRun(...)` later.

The first green path uses a fake client that returns a branch/PR-shaped result.
The real SDK adapter is behind `CURSOR_API_KEY` and a gated command.

### 4. Orchestrator CLI

Create `apps/tarmac-orchestrator`:

- `tarmac scan` prints eligible issues;
- `tarmac run-one <issue-id>` claims and dispatches one issue;
- `tarmac reconcile <issue-id>` reads Cursor run state and updates FP if needed.

Use FP CLI/REST as the first adapter, then replace with direct REST only if the
CLI surface blocks tests.

### 5. Worker Prompt And Guardrails

Render a Cursor prompt that includes:

- issue title/description/comments;
- FP REST/no-clone instructions;
- exact expected metadata writes;
- verification and PR expectations;
- secret hygiene prohibitions.

Add tests that assert rendered prompts do not include `CURSOR_API_KEY`,
`FP_TOKEN`, GitHub tokens, or dotenv values.

### 6. Real E2E Gates

Gated checks only run when env is present:

- `TARMAC_FP_REST_E2E=1` proves non-repo FP property reads/writes.
- `TARMAC_CURSOR_E2E=1` launches a tiny Cursor run.
- `TARMAC_FULL_DEMO_E2E=1` creates or uses a real issue, launches Cursor, and
  expects PR metadata.

## Acceptance Criteria

- `fp guide` lists all `tarmac_*` properties.
- Unit tests cover eligibility, prompt redaction, fake Cursor dispatch, and
  orchestration idempotency.
- Root `bun run check`, `bun run test`, and `bun run format:check` pass.
- A demo run can be performed with fake Cursor locally.
- Real Cursor launch is documented and gated behind explicit env.

## Open Risks

- Cursor account/API key may be unavailable until the macOS keychain is unlocked
  or a service key is provided.
- Tarmac needs a GitHub remote before Cursor Cloud Agents can clone it.
- FP REST/no-clone custom-property writes must be proven before real worker
  completion is reliable.
