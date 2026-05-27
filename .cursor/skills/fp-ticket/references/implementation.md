# Implementation, Verification, And Evidence

## Before Editing

Read the repo's `AGENTS.md`, the relevant package docs, and nearby tests. Confirm whether the issue asks for a user-facing change, internal behavior, docs, or release-affecting work.

Create a branch from current `main` unless the prompt says to continue an existing branch or PR:

```bash
git fetch origin main
git checkout -b "$BRANCH_NAME" origin/main
```

When continuing work, preserve existing author/user changes. Do not reset or revert unrelated files.

## Implementation

- Keep changes scoped to the fp issue and the documented acceptance criteria.
- Prefer established repo patterns and package scripts.
- Use `bun` scripts from `package.json`; do not use `npx`.
- For generated scripts, use checked-in helper scripts, explicit temp files,
  `node`, or `bun -e`. Do not use `bun <<EOF`; Bun prints help instead of
  evaluating stdin in Daytona sandboxes.
- For scripted edits, prefer exact block replacement, parsers, or AST-aware
  transforms. Avoid ad hoc line deletion that can leave dangling syntax.
- Add or update tests proportional to risk and blast radius.
- For docs that describe code behavior, use drift anchors.
- For CLI or Desktop user-facing fixes/features, create a changeset when release notes should mention the change.

## Local Verification

Run the narrowest meaningful command first, then broaden when risk warrants it:

- Changed a test-covered unit: run that test file or package test.
- Changed types or shared contracts: run package typecheck and affected tests.
- Changed UI behavior: run the app, verify the workflow, and capture screenshots.
- Changed Cloudflare Worker behavior: use the repo's worker test scripts, not root-level `bun test`.

Record exact verification commands and results. If a sandbox cannot launch Docker, Electron, a browser, or the app, record the degraded verification explicitly in fp and the PR.

Start dev servers in the background with PID files or a process group. Clean up Electron, Vite, Docker, browser, and background processes before finishing.

## Evidence

Save local run artifacts under `ops/daytona/artifacts/<issue-or-run>/` when the orchestrator expects them. Upload visual evidence with REST fp attachment commands from `fp-rest.md` and include the resulting markdown references in fp comments and the PR body.

## Review Passes

Before opening or finalizing the PR:

1. Review your own diff for correctness, security, test risk, and unrelated changes.
2. Use the `thermo-nuclear-code-quality-review` skill when available for a strict maintainability pass.
3. Ask subagents for independent review when available:
   - adversarial review for regressions and failure modes;
   - code review for bugs, tests, integration risk, and missing verification.
4. Treat findings as hypotheses. Inspect the code yourself, verify material findings, discard false positives, and only implement fixes you can justify.
5. Comment on the fp issue with review passes run, material findings, fixes made, false positives ignored, and residual risks.

After substantial fixes from review or CI, rerun relevant verification and review passes.
