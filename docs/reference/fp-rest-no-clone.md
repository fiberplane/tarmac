# FP REST From A Cursor Worker

Use REST mode from a directory outside the repo checkout so fp does not resolve local `.fp` project state. This is required in sandboxes and worktrees when the issue state lives in Console.

## Environment

Required for env-only no-clone REST mode:

- `FP_REMOTE=rest-api`
- `FP_TOKEN`
- `FP_WORKSPACE`
- `FP_PROJECT_ID`
- `FP_SERVER_URL`; this is required in env-only no-clone mode

Optional:

- `FP_PROJECT_PREFIX` as a display/input fallback when project metadata cannot be fetched first

Never print token values. Do not write them into repo files, shell profiles, git remotes, artifacts, PR text, or issue comments.

## Workdir

Create a non-repo workdir and run REST fp commands there:

```bash
mkdir -p /tmp/fp-rest-ticket
cd /tmp/fp-rest-ticket
```

Use the global `fp` binary, not a repo-local `bun run` command, unless the user explicitly asks to test the local CLI.

## Read Context

Fetch each target issue and comments before editing code:

```bash
FP_REMOTE=rest-api fp issue show "$ISSUE_ID" --format json
FP_REMOTE=rest-api fp comment list "$ISSUE_ID" --format json
```

If the issue references child issues or dependencies, fetch those too. If the supplied ID is ambiguous or missing, use `fp issue list` or `fp search` in REST mode to find the intended issue.

## Update Issue State

Post clear progress comments at state transitions. Respect project-specific status names from issue context or repo guidance. Use `in-progress` only when it is a valid status for the project; if the status update fails, leave a progress comment instead of guessing another status.

```bash
FP_REMOTE=rest-api fp issue update --status in-progress "$ISSUE_ID" \
  --comment "Started in Cursor Cloud Agent on branch $BRANCH_NAME."

FP_REMOTE=rest-api fp comment add "$ISSUE_ID" --file /tmp/progress.md
```

Use comments for narrative updates and `fp issue update` for status/metadata changes. Do not mark done until the finish criteria in `SKILL.md` are met.

## Evidence Attachments

For screenshots, logs, or other visual evidence:

```bash
FP_REMOTE=rest-api fp attach /path/to/evidence.png
FP_REMOTE=rest-api fp comment add "$ISSUE_ID" --file /tmp/evidence-comment.md
```

`fp attach` prints a markdown image reference using `fp-asset://...`. Include that markdown in issue comments and PR bodies. Do not commit gitignored evidence unless the prompt explicitly asks.

`fp issue create`, `fp issue update`, and `fp comment add` also support `--attach` in REST no-clone mode; use that when the attachment belongs directly to a new issue, issue description update, or comment.

## Blockers

If REST fp fails, verify the environment with non-secret checks such as `env | rg '^FP_(REMOTE|WORKSPACE|PROJECT_ID|PROJECT_PREFIX|SERVER_URL)='`. Report missing or invalid context without printing `FP_TOKEN`.

## Tarmac Proof Script

Tarmac includes a gated proof script:

```bash
TARMAC_FP_REST_E2E=1 \
TARMAC_FP_REST_ISSUE_ID=TARM-... \
bun run e2e:fp-rest
```

The script runs from `/tmp/tarmac-fp-rest-e2e`, forces `FP_REMOTE=rest-api`,
writes every `tarmac_*` property, reads the issue back, verifies round-trip
values, and restores the original property values.

Current local status on 2026-05-26: this checkout has a valid FP auth token in
the user credentials file, but the Tarmac project is not linked to a remote FP
project and no `FP_*` REST environment variables are exported in this shell.
The proof therefore remains gated until a remote project ID and REST token env
are provided.
