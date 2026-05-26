---
name: fp-ticket
description: "Use when a Cursor Cloud Agent is working on one or more fp issues/tickets and expected to run the full issue-to-PR loop: fetch and update fp via REST, implement code, verify, upload evidence, open a non-draft PR, handle review/CI feedback, and babysit the PR until green or a human handoff is required."
metadata:
  short-description: Complete fp tickets from a sandbox
---

# fp Ticket

You are inside a Cursor Cloud Agent working on fp issue(s). Treat this as a full
issue-to-PR workflow, not just coding.

## Progressive References

Load these only when needed:

- [references/fp-rest.md](references/fp-rest.md): required before reading or updating fp issues from a sandbox, uploading evidence, or using REST no-clone mode.
- [references/implementation.md](references/implementation.md): required before editing code, verifying work, collecting evidence, or running review passes.
- [references/pr-babysitting.md](references/pr-babysitting.md): required before opening or continuing a PR, checking CI/reviews, fixing failures, or deciding whether to hand off.

## Ground Rules

- Use REST fp from a non-repo directory. Do not rely on local `.fp` project state in the checkout.
- Never print tokens or write credentials into repo files, shell profiles, git remotes, artifacts, PR text, or issue comments.
- Prefer `gh` for GitHub PR creation, checks, review comments, and PR updates.
- Open a full non-draft PR unless the user explicitly asks for a draft.
- Babysitting is required. Do not stop at PR creation if checks/reviews are still actionable.
- Preserve unrelated user/author changes when continuing an existing branch or PR.
- Use package scripts from `package.json`; do not invent parallel commands when scripts exist.

## Workflow

1. **Bootstrap and baseline**
   - Read [references/fp-rest.md](references/fp-rest.md).
   - Create or reuse a REST workdir outside the repo.
   - Validate REST fp context, GitHub auth, repo state, and required tooling.
   - Run a cheap baseline check when practical; if the sandbox cannot run it, record the limitation.

2. **Read fp context**
   - Fetch every supplied issue and its comments.
   - Fetch linked issues, child issues, dependencies, specs, and referenced docs.
   - Do not touch code until acceptance criteria and blockers are clear.

3. **Prepare branch and coordinate**
   - In the repo checkout, read `AGENTS.md` and relevant package docs.
   - Branch from current `main`, unless the prompt says to continue an existing branch or PR.
   - After the branch is real, comment on the fp issue with Cursor as provider, target issue(s), branch, and known PR if one already exists.

4. **Implement**
   - Read [references/implementation.md](references/implementation.md).
   - Keep changes scoped to the issue and follow local patterns.
   - Comment progress at meaningful milestones, not every command.

5. **Local verification gate**
   - Run the narrowest meaningful checks first, then broaden when risk warrants it.
   - Capture evidence for UI, visual, or workflow changes.
   - Record exact commands and any degraded verification.

6. **Review gate**
   - Review your own diff for correctness, security, test risk, and unrelated changes.
   - Run available strict/code-review subagents or skills.
   - Fix justified findings and record material false positives or residual risks.

7. **Commit and open PR**
   - Commit verified changes and push the branch.
   - Read [references/pr-babysitting.md](references/pr-babysitting.md).
   - Open a full non-draft PR unless the user explicitly asks for a draft.
   - Include fp issue ID(s), summary, verification, review passes, evidence links when relevant, and known warnings or handoff reasons.

8. **Babysit PR**
   - Loop on checks, mergeability, review feedback, and review-bot feedback.
   - Fix deterministic failures, re-run relevant verification, commit, push, and continue.
   - Stop only when success criteria are met or a human decision is required.

## Finish

Only mark the issue done after implementation, verification, evidence upload when relevant, review passes, PR creation, and babysitting are complete. If team policy requires merge before done, wait for merge or leave the issue open with a ready-for-review comment. If blocked, leave the issue open and comment with the exact blocker, evidence collected, and next human decision needed.
