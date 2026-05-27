# PR Creation And Babysitting

Use this when opening a PR, continuing an existing PR, or checking whether the branch is ready for human review/merge.

Run all bundled scripts from the repository root. Use the full script path under the skill root:

```bash
bun run <skill-root>/scripts/fetch-pr-feedback.ts [--pr NUMBER]
bun run <skill-root>/scripts/fetch-pr-checks.ts [--pr NUMBER]
bun run <skill-root>/scripts/reply-to-thread.ts THREAD_ID BODY
```

## Identify Or Create The PR

```bash
gh pr view --json number,url,headRefName,baseRefName,state,mergeStateStatus,reviewDecision,statusCheckRollup
```

If no PR exists, push the branch and create a full non-draft PR unless the user explicitly asked for draft:

```bash
git push -u origin "$BRANCH_NAME"
gh pr create --base main --head "$BRANCH_NAME" --title "$TITLE" --body-file /tmp/pr-body.md
```

For private repos, keep fetch and push authentication token-isolated. Use
`GIT_ASKPASS`, `gh` with token in the process environment, or another temporary
credential file outside the repo. Do not put tokens in clone URLs, git remotes,
command text, artifacts, issue comments, or PR text.

If `gh` is unavailable, use GitHub REST/GraphQL with session-only credentials. Do not print raw payloads containing secrets. If no authenticated GitHub path is available, stop and leave an fp issue comment explaining that PR creation/babysitting is blocked.

The PR body must include:

- fp issue ID(s);
- summary of changes;
- verification commands and results;
- review passes and material outcomes;
- screenshot/evidence links when relevant;
- known warnings or human-handoff reasons.

## Initial Review Sweep

Fetch current PR state before waiting:

```bash
bun run <skill-root>/scripts/fetch-pr-feedback.ts
bun run <skill-root>/scripts/fetch-pr-checks.ts
gh pr view --json mergeStateStatus,reviewDecision,updatedAt,headRefOid
```

Use the bundled feedback script for thread-level review state. It uses GraphQL and fails closed if review-thread state cannot be fetched.

Handle feedback by priority:

- Fix high-priority or changes-requested feedback without prompting when the fix is clear.
- Fix medium-priority actionable feedback when it is correct and scoped.
- Ask the user before spending time on low-priority nits or stylistic preferences.
- Skip resolved threads and purely informational bot comments.
- Treat review bot findings as real hypotheses: verify each one, fix true positives, and explicitly record false positives.

## Waiting For Checks

Do not treat zero checks as success. GitHub can take 10-30 seconds after a push before checks register.

Use conservative polling rather than tight loops. Prefer a background monitor script or long-running session that emits only state changes. Do not paste the loop below into a blocking foreground assistant call. Poll checks about every 120 seconds after registration.

Example polling command:

```bash
while true; do
  total=$(gh pr checks --json bucket --jq 'length') || { sleep 120; continue; }
  if [ "$total" = "0" ]; then
    echo "waiting for checks to register"
    sleep 30
    continue
  fi
  required_total=$(gh pr checks --required --json bucket --jq 'length') || required_total=0
  pending_review_bot=$(gh pr checks --json name,workflow,bucket --jq '[.[] | select(.bucket == "pending" and ((.name // "") | test("cursor|bugbot|copilot|codex|claude|codeql"; "i") or ((.workflow // "") | test("cursor|bugbot|copilot|codex|claude|codeql"; "i"))))] | length') || pending_review_bot=0
  if [ "$required_total" = "0" ]; then
    check_args=""
  else
    check_args="--required"
  fi
  pending=$(gh pr checks $check_args --json bucket --jq '[.[] | select(.bucket == "pending")] | length') || { sleep 120; continue; }
  nonpass=$(gh pr checks $check_args --json bucket --jq '[.[] | select(.bucket != "pass")] | length') || true
  if [ "$pending" = "0" ] && [ "$pending_review_bot" = "0" ]; then
    if [ "$nonpass" = "0" ]; then
      echo "ALL_CHECKS_PASSED"
    else
      echo "CHECKS_DONE_WITH_NONPASS_RESULTS"
    fi
    gh pr checks
    exit 0
  fi
  echo "$pending checks still pending"
  sleep 120
done
```

## Fixing CI Failures

Investigation is mandatory before any fix:

1. Run `bun run <skill-root>/scripts/fetch-pr-checks.ts` and inspect every failed, skipped, cancelled, or otherwise non-pass gated result.
2. Read full logs, not just snippets. Use `gh run view <run-id> --log-failed` when the script output is insufficient.
3. Trace from the failing assertion, exception, or lint rule into source code and call sites.
4. State the cause clearly before editing: "This fails because X, affected by Y."
5. Search for related instances and fix all in-scope occurrences.
6. Apply a minimal root-cause fix, then run local verification before pushing.

Commit and push deterministic fixes:

```bash
git add <files>
git commit -m "fix: <descriptive message>"
git push
```

Post a concise fp issue comment when the fix changes scope, verification, evidence, or residual risk.

## Mergeability

Checks and reviews are not enough. Before declaring success, inspect merge state:

```bash
gh pr view --json mergeStateStatus,baseRefName,headRefName,reviewDecision,statusCheckRollup
```

If the PR is behind, dirty, blocked, or otherwise not mergeable:

1. Update the branch from `main` or the PR base branch.
2. Resolve conflicts while preserving intended and unrelated author changes.
3. Re-run relevant local verification.
4. Push, then return to waiting for checks and reviews.

If rebasing or merging the base branch would be risky or requires product judgment, ask for help and leave a clear fp issue comment.

## Feedback During Pending CI

Gate expensive review-thread fetches on cheap PR snapshots:

```bash
gh pr view --json updatedAt,headRefOid --jq '[.updatedAt, .headRefOid] | @tsv'
```

Cache the last `updatedAt` value. Re-fetch review feedback only when it changes, plus a periodic safety refresh every fifth poll if unresolved thread state matters. Always check CI status regardless of `updatedAt`, because check conclusions do not necessarily update PR metadata.

## Review Bot Final Sweep

After required checks pass and mergeability looks clean, run one final feedback sweep before declaring success:

```bash
bun run <skill-root>/scripts/fetch-pr-feedback.ts
```

The command must complete successfully. It inspects unresolved review threads, top-level PR comments, latest review bodies, and review-bot feedback.

For every review-bot item, especially Cursor Bugbot or `cursor[bot]` feedback:

1. Verify whether the finding is real.
2. Fix true positives that are small and in scope, then rerun verification and push.
3. For true positives that are real but larger than the current PR should absorb, create or request a follow-up fp child issue under the logical parent and mention it in the PR/fp handoff.
4. Record false positives explicitly in the fp issue or PR handoff.
5. Never silently ignore review-bot findings.

## Exit Conditions

Success means `fetch-pr-checks.ts` reports no pending review-bot checks and no pending or non-pass gated checks: required checks when present, otherwise all registered checks. The PR must be mergeable, final `fetch-pr-feedback.ts` must complete successfully and have no unhandled high/medium or review-bot findings, and the user must have decided on low-priority items. Non-required neutral checks are not blockers after their associated review-bot comments have been evaluated.

Ask for help when the same failure persists after two serious fix attempts, the feedback requires product judgment, the branch needs a risky rebase, credentials are missing, or infrastructure appears broken.

Stop only after leaving a clear fp issue comment and PR note with the blocker, evidence collected, and the next human decision needed.
