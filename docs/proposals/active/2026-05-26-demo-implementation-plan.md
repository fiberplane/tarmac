# Demo Implementation Plan

Status: Draft
Date: 2026-05-26

## Goal

Demonstrate a property-triggered FP to Cursor Cloud Agent loop:

1. A human sets `tarmac_ready` to the `Ready` desktop label, whose canonical
   stored value is `"true"`, on an FP issue.
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
- treat `tarmac_ready` wire values `"true"` / `"false"` as canonical and UI
  labels as display-only;
- build an open issue index;
- evaluate eligibility;
- create durable claim/update intents with `tarmac_claim_id`;
- prove idempotency for already-running issues and restart reconciliation.

Red tests first:

- ready todo issue dispatches;
- non-ready issue does not dispatch;
- open dependency blocks;
- open child blocks;
- malformed property blocks;
- issue with existing run ID does not launch twice;
- same-process duplicate `run-one` attempts do not double-dispatch;
- cross-process exactly-once dispatch is out of scope until FP supports
  conditional updates or Tarmac adds a durable lock store.

### 3. Required Pre-Demo Remote Bootstrap

Real Cursor gates require a hosted repo. Before any real Cursor launch:

- `origin/main` must point at a cloneable GitHub repo;
- `git ls-remote origin main` must succeed;
- remote `main` must contain `.cursor/environment.json`, `.cursor/skills/`, and
  `.fp/extensions/tarmac-dispatch.ts`;
- local required files must be committed and pushed;
- launch must resolve and record the remote base SHA;
- the worker must checkout and validate that exact SHA before editing.

Current remote: `https://github.com/fiberplane/tarmac` (private).

### 4. FP REST/No-Clone Blocking Gate

Before relying on worker-side FP writes, add `TARMAC_FP_REST_E2E=1`:

- run from a non-repo directory such as `/tmp/fp-rest-ticket`;
- verify `fp issue show` and comments work;
- set every `tarmac_*` property type through REST;
- read the issue back and assert values round-trip;
- document whether REST mode learns extension-registered properties from the
  server/project or requires a local checkout.

Full demo remains blocked until this gate passes. If property mutation fails,
workers may comment PR metadata but must not claim production-ready completion.

### 5. Cursor Secret Delivery Gate

Before full E2E, prove Cursor workers can receive non-prompt FP context:

- configure the exact supported Cursor secret/env mechanism;
- launch a tiny cloud run that checks non-secret env names are present;
- from `/tmp`, run `FP_REMOTE=rest-api fp issue show <test-issue>`;
- ensure no token values appear in prompts, logs, FP comments, PR text, or
  artifacts.

Full demo fails closed if FP secrets cannot be injected without prompt exposure.

### 6. Cursor SDK Tracebullet

Create `packages/cursor-client` with a small interface and fake implementation
that matches the current SDK shape:

- `Agent.create({ cloud: { repos, autoCreatePR } })`;
- `agent.send(prompt)`;
- `Agent.getRun(run.id, { runtime: "cloud", agentId: run.agentId })`;
- optional `streamRun(...)` later.

The first green path uses a fake client that returns a branch/PR-shaped result.
The real SDK adapter is behind `CURSOR_API_KEY` and a gated command. Include a
compile-time contract test against installed `@cursor/sdk` types.

### 7. Orchestrator CLI And Watch Loop

Create `apps/tarmac-orchestrator`:

- `tarmac scan` prints eligible issues;
- `tarmac run-one <issue-id>` claims and dispatches one issue;
- `tarmac reconcile <issue-id>` reads Cursor run state and updates FP if needed.
- `tarmac watch --poll-interval <seconds>` polls FP, detects newly ready issues,
  and dispatches without a manual issue ID.

Use FP CLI/REST as the first adapter, then replace with direct REST only if the
CLI surface blocks tests.

Claiming assumes a single orchestrator process for the prototype. Inside that
process, use a mutex keyed by issue ID plus write-and-confirm: write a unique
`tarmac_claim_id`, re-read the issue, and launch only if this runner still owns
the claim and no run IDs are present. Cross-process exactly-once dispatch is a
future durable-lock/CAS problem.

The demo remains property-triggered only if `watch` is running. Manual
`scan`/`run-one` is a fallback demo mode, not the primary acceptance path.

### 8. Worker Prompt And Guardrails

Render a Cursor prompt that includes:

- issue title/description/comments;
- FP REST/no-clone instructions;
- exact expected metadata writes;
- verification and PR expectations;
- secret hygiene prohibitions.

Add tests that assert rendered prompts do not include `CURSOR_API_KEY`,
`FP_TOKEN`, GitHub tokens, or dotenv values.

### 9. PR Ownership

Use Cursor `autoCreatePR` for the first real E2E. The worker records Cursor's PR
URL from the run result in FP and comments verification evidence.

A worker-driven `gh` path requires a separate GitHub credential provisioning
gate and is out of scope for the first demo.

### 10. Real E2E Gates

Gated checks only run when env is present:

- `TARMAC_FP_REST_E2E=1` proves non-repo FP property reads/writes.
- `TARMAC_CURSOR_BOOTSTRAP_E2E=1` proves Cursor can clone/bootstrap the repo,
  see `.cursor/skills`, run `bun --version`, `fp --version`, and perform
  non-secret FP REST read from `/tmp`.
- `TARMAC_CURSOR_E2E=1` launches a tiny Cursor run and verifies branch/PR output
  through GitHub.
- `TARMAC_FULL_DEMO_E2E=1` creates or uses a real issue, launches Cursor, and
  expects matching GitHub PR URL and FP `tarmac_pr_url`.

## Acceptance Criteria

- `fp guide` lists all `tarmac_*` properties.
- Unit tests cover eligibility, prompt redaction, fake Cursor dispatch, and
  orchestration idempotency.
- `tarmac watch` observes a ready issue without a manual issue ID.
- Root `bun run check`, `bun run test`, and `bun run format:check` pass.
- A demo run can be performed with fake Cursor locally.
- Real Cursor launch is documented and gated behind explicit env.
- Full real E2E is blocked unless remote bootstrap, FP REST property writes,
  Cursor secret delivery, and Cursor bootstrap gates pass.

## Open Risks

- Cursor account/API key may be unavailable until the macOS keychain is unlocked
  or a service key is provided.
- FP REST/no-clone custom-property writes must be proven before real worker
  completion is reliable.
- Cursor API/SDK examples changed recently; keep the SDK contract test pinned to
  the installed `@cursor/sdk` version.
