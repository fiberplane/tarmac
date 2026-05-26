# tarmac

Tarmac is an FP + Cursor Cloud Agent prototype. The demo target is:

1. A human marks an FP issue with `tarmac_ready=Ready` in the desktop app.
2. A Tarmac orchestrator detects the eligible issue.
3. The orchestrator dispatches a Cursor Cloud Agent with FP no-clone REST context.
4. The Cursor worker pushes a branch, opens a PR, records FP metadata, and closes
   or hands off the issue according to guardrails.

This intentionally deviates from Symphony's Codex app-server runtime. The
tracker and scheduler shape stays Symphony-inspired; the runner becomes Cursor's
durable cloud-agent API and GitHub PR workflow.

## Setup

```bash
bun install
git config --local include.path "$(git rev-parse --show-toplevel)/.githooks/hooks.gitconfig"
```

The repo uses `fp` for all task tracking. Start with:

```bash
fp tree
fp guide
```

## Guardrails

- FP extensions register the `tarmac_*` property surface and block empty issue
  descriptions.
- `bun run check` runs oxlint, ast-grep, drift, and typecheck.
- Git 2.54 config-based hooks run staged linting and drift checks when enabled.
- The thermonuclear review skill is vendored under `.agents/skills/`.
