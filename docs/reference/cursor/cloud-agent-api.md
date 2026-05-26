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
