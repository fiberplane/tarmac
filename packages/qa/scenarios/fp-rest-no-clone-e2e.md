---
name: FP REST no-clone custom-property proof
requires:
  - fp
  - FP_TOKEN
  - FP_WORKSPACE
  - FP_PROJECT_ID
  - FP_SERVER_URL
  - TARMAC_FP_REST_ISSUE_ID
tags:
  - cli
  - fp
  - e2e
---

## Goals

Prove that a process running outside the repository can use FP REST mode to read
an issue, write every `tarmac_*` custom property, read the issue back, and
restore the original values.

## Prerequisites

- Use a disposable issue, not an issue actively driving work.
- Export `TARMAC_FP_REST_E2E=1`.
- Export `TARMAC_FP_REST_ISSUE_ID` with the disposable issue ID.
- Export `FP_TOKEN`, `FP_WORKSPACE`, `FP_PROJECT_ID`, and `FP_SERVER_URL`.
- Do not print or paste token values into terminals, comments, logs, PRs, or
  artifacts.

## Steps

1. Action: Run `bun run e2e:fp-rest`.
   Expected: The script runs from `/tmp/tarmac-fp-rest-e2e`, not from the repo.
   Verify: Output says the FP REST/no-clone proof is running from `/tmp`.

2. Action: Let the script write the probe values.
   Expected: Every `tarmac_*` property round-trips through `fp issue update` and
   `fp issue show`.
   Verify: Output reports a pass with the number of `tarmac_*` properties.

3. Action: Let cleanup run.
   Expected: Original `tarmac_*` property values are restored.
   Verify: Output says the original values were restored.

## Cleanup

If the script exits before cleanup, manually inspect the disposable issue in FP
and clear or restore any `tarmac_*` probe values. Do not preserve probe PR URLs,
run IDs, or branch names on real work items.
