# Cursor Cloud Agent Reference

Date captured: 2026-05-27.

Tarmac depends on Cursor Cloud Agents as a durable remote worker, not on Codex
app-server. Official docs currently describe these useful surfaces:

- Cloud Agents clone GitHub or GitLab repos, work on a separate branch, and push
  changes back for handoff.
- Repo setup should live in `.cursor/environment.json`; Cloud Agents also run
  `.cursor/hooks.json` hooks when present.
- Machine setup starts from Cursor's base environment, then runs the
  repository's `install` command. That command must be idempotent and cannot
  assume project-specific tools such as Bun are already on `PATH`.
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
verify `.cursor` files, `ops/cursor/bootstrap-env.sh`, `bun --version`,
`fp --version`, and `fp issue show` from `/tmp`.

The checked-in Cursor install command is `sh ops/cursor/bootstrap-env.sh`. The
script installs or exposes Bun before running `bun install --frozen-lockfile`,
installs `fp` into `$HOME/.fiberplane/bin`, updates `PATH` for the current
install shell, and verifies `bun --version` plus `fp --version`. It does not
read local shell profiles or print credential values.

Current local status on 2026-05-26: `cursor-agent status` reports a logged-in
user, but `cursor-agent models` fails because the macOS login keychain is
locked. This proof requires an exported `CURSOR_API_KEY`; the CLI keychain path
is only useful as separate operational context.

Cursor repository access was the gating external integration during the first
live proof. Current real launches should use the canonical repo with
`CURSOR_REMOTE_NAME=origin`.

Live proof status on 2026-05-26: passed against a temporary fallback remote. Run
`bc-c8c2a71a-c559-49e5-80ef-8652317e160d/run-48d5f049-95a5-480a-b07f-d8710fcb68e3`
finished and returned the expected `BOOTSTRAP_SMOKE_OK` JSON marker after
verifying repo-local Cursor files, `bun`, `fp`, and FP REST/no-clone issue read
from `/tmp`.

## Tarmac Live Dispatch Proof

Full property-triggered dispatch status on 2026-05-26: first passed against a
temporary fallback remote. The FP issue `TARM-weeqzaxz` was made eligible by
setting `tarmac_ready=true`; `tarmac run-one --cursor real` claimed it, launched
Cursor run `bc-3d23cee8-0cbb-4987-b15b-ef74338806b1/run-668ab4dc-c708-4f90-82d3-a45bec90b107`,
and `tarmac reconcile --cursor real` recorded terminal PR metadata.

The follow-up getting-started dispatch also used the temporary fallback and was
merged back into canonical `origin/main` before retiring that fallback.
