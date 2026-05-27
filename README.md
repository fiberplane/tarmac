# tarmac

Tarmac is an FP + Cursor Cloud Agent prototype. The demo target is:

1. A human marks an FP issue ready for dispatch (`tarmac_ready=true`; the desktop UI may show **Ready** / **Not Ready** as labels only).
2. A Tarmac orchestrator detects the eligible issue.
3. The orchestrator dispatches a Cursor Cloud Agent with FP no-clone REST context.
4. The Cursor worker pushes a branch, opens a PR, records FP metadata, and closes
   or hands off the issue according to guardrails.

This intentionally deviates from Symphony's Codex app-server runtime. The
tracker and scheduler shape stays Symphony-inspired; the runner becomes Cursor's
durable cloud-agent API and GitHub PR workflow.

## Getting Started

**[GETTING_STARTED.md](GETTING_STARTED.md)** — install, FP project link, orchestrator commands (`scan`, `run-one`, `watch`, `reconcile`), fake vs real Cursor mode, REST env setup, and adding Tarmac to another repo.

Fast path:

```bash
bun install
fp init -y          # if this repo is not yet an fp project
fp tree             # inspect work
bun run tarmac scan --cursor fake
```

Architecture: [docs/architecture/0001-cursor-backed-symphony-loop.md](docs/architecture/0001-cursor-backed-symphony-loop.md) · FP boundaries: [docs/architecture/fp-boundary.md](docs/architecture/fp-boundary.md)

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
- The thermonuclear review skill is vendored under `.agents/skills/`; PRs use
  `.github/pull_request_template.md` to record that review (separate from CI).
