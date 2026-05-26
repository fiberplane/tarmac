# Cursor Cloud Agent Reference

Date captured: 2026-05-26.

Tarmac depends on Cursor Cloud Agents as a durable remote worker, not on Codex
app-server. Official docs currently describe these useful surfaces:

- Cloud Agents clone GitHub or GitLab repos, work on a separate branch, and push
  changes back for handoff.
- Repo setup should live in `.cursor/environment.json`; Cloud Agents also run
  `.cursor/hooks.json` hooks when present.
- The current REST API is run-based: create a durable agent with
  `POST /v1/agents`, create follow-up runs with `POST /v1/agents/{id}/runs`,
  poll `GET /v1/agents/{id}/runs/{runId}`, and stream with
  `GET /v1/agents/{id}/runs/{runId}/stream`.
- Run status values observed in the docs include `CREATING`, `RUNNING`, and
  `FINISHED`; failed or expired states should be treated as terminal handoff
  states once the client model is implemented.
- Run results can include `git.branches[].branch` and
  `git.branches[].prUrl`.
- The TypeScript SDK package is `@cursor/sdk`; `npm view @cursor/sdk version`
  returned `1.0.13` on 2026-05-26.

Tracked external references:

- https://cursor.com/docs/cloud-agent
- https://cursor.com/docs/cloud-agent/api/endpoints
- https://cursor.com/docs/api/sdk/typescript
- https://cursor.com/blog/typescript-sdk
- `references/cursor-cookbook/sdk/quickstart`
- `references/cursor-cookbook/sdk/agent-kanban`
- `references/cursor-cookbook/self-hosted-cloud-agent`

## Tarmac Bootstrap Proof

Tarmac includes a gated Cursor Cloud bootstrap proof:

```bash
TARMAC_CURSOR_BOOTSTRAP_E2E=1 \
TARMAC_CURSOR_BOOTSTRAP_ISSUE_ID=TARM-... \
bun run e2e:cursor-bootstrap
```

Required env names are `CURSOR_API_KEY`, `FP_TOKEN`, `FP_WORKSPACE`,
`FP_PROJECT_ID`, and `FP_SERVER_URL`. The script resolves
`CURSOR_REMOTE_NAME/main` (default `origin/main`), refuses real launch from a
dirty or unpushed checkout, starts Cursor from the verified branch name, sends
FP REST env through Cursor SDK `cloud.envVars`, and asks the cloud worker to
verify `.cursor` files,
`bun --version`, `fp --version`, and `fp issue show` from `/tmp`.

Current local status on 2026-05-26: `cursor-agent status` reports a logged-in
user, but `cursor-agent models` fails because the macOS login keychain is
locked. This proof requires an exported `CURSOR_API_KEY`; the CLI keychain path
is only useful as separate operational context.

Cursor repository access is currently the gating external integration. The
`fiberplane/tarmac` private repo exists, but the Cursor account did not list it
on 2026-05-26. A private fallback repo at `brettimus/tarmac` is pushed as the
local `cursor` remote and is visible to Cursor; run live proofs with
`CURSOR_REMOTE_NAME=cursor` until the canonical org repo is connected.
