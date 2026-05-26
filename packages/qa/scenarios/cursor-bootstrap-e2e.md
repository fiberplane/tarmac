---
name: Cursor Cloud bootstrap and FP REST secret delivery proof
requires:
  - CURSOR_API_KEY
  - FP_TOKEN
  - FP_WORKSPACE
  - FP_PROJECT_ID
  - FP_SERVER_URL
  - TARMAC_CURSOR_BOOTSTRAP_ISSUE_ID
tags:
  - cursor
  - fp
  - e2e
---

## Goals

Prove that Cursor Cloud can clone the Tarmac repo, see checked-in Cursor
configuration, run the expected local tools, and use FP REST/no-clone env vars
from outside the repo without exposing secret values.

## Prerequisites

- Export `TARMAC_CURSOR_BOOTSTRAP_E2E=1`.
- Export `TARMAC_CURSOR_BOOTSTRAP_ISSUE_ID` with a readable FP issue.
- Export `CURSOR_API_KEY`.
- Export `FP_TOKEN`, `FP_WORKSPACE`, `FP_PROJECT_ID`, and `FP_SERVER_URL`.
- The local `main` checkout must be clean and match remote `origin/main`.
- Do not print token values into terminals, comments, logs, PRs, or artifacts.

## Steps

1. Action: Run `bun run e2e:cursor-bootstrap`.
   Expected: The script resolves the remote base SHA and launches a Cursor Cloud
   agent with `autoCreatePR=false`.
   Verify: Output prints only the Cursor agent/run IDs and status transitions.

2. Action: Let the Cursor run complete.
   Expected: Cursor verifies `.cursor/environment.json`,
   `.cursor/skills/fp-ticket/SKILL.md`, `bun --version`, `fp --version`, and
   `fp issue show` from `/tmp/tarmac-cursor-bootstrap-smoke`.
   Verify: The final run result contains `BOOTSTRAP_SMOKE_OK`.

## Cleanup

No repo changes or PR should be created. If Cursor creates a branch or PR anyway,
close it and record the unexpected artifact on the driving FP issue.
