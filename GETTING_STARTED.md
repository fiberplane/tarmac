# Getting Started with Tarmac

Tarmac is a Symphony-inspired loop that uses **FP** as the tracker and **Cursor Cloud Agents** as the worker runtime. This guide is the operator and agent entry point: install, link FP, run the local orchestrator in fake mode, and—when credentials and remotes are ready—dispatch real Cursor workers.

Deeper design stays in [docs/architecture/0001-cursor-backed-symphony-loop.md](docs/architecture/0001-cursor-backed-symphony-loop.md) and [docs/architecture/fp-boundary.md](docs/architecture/fp-boundary.md). Cursor host details live in [ops/cursor/README.md](ops/cursor/README.md). Worker sandboxes should follow [docs/reference/fp-rest-no-clone.md](docs/reference/fp-rest-no-clone.md) and [.cursor/skills/fp-ticket/SKILL.md](.cursor/skills/fp-ticket/SKILL.md).

## Secret hygiene

Never place API keys, FP tokens, GitHub tokens, or dotenv secrets in repo files, prompts, issue comments, PR text, logs, or artifacts. Host-only Cursor credentials belong in `ops/cursor/.env` (gitignored) or the host environment. Workers receive FP REST identity through Cursor-managed secrets or another documented non-prompt mechanism—not through committed files.

## Prerequisites

- [Bun](https://bun.sh) for local development. Cursor Cloud workers bootstrap
  Bun through `ops/cursor/bootstrap-env.sh` before running dependency install.
- [fp](https://setup.fp.dev) CLI for local issue tracking and orchestrator reads
- Git 2.54+ if you enable config-based hooks (see [README.md](README.md))

```bash
bun install
git config --local include.path "$(git rev-parse --show-toplevel)/.githooks/hooks.gitconfig"
```

Register this directory as an FP project when you use local `fp` commands from the repo root:

```bash
fp init -y
fp tree
```

## How the loop works

1. A human marks an FP issue ready for dispatch using the canonical wire value `tarmac_ready=true` (status `todo`, dependencies satisfied). In the FP desktop UI the same gate may appear as labels such as **Ready** / **Not Ready**—those are display text only. Do not write `tarmac_ready=Ready` from agents or scripts.
2. The **orchestrator** scans eligible issues, claims them, launches Cursor (fake or real), and writes pre-handoff `tarmac_*` fields including `tarmac_cursor_url` (an inferred link derived from the Cursor agent id; see `packages/cursor-client/src/run-url.ts`).
3. After handoff, the **Cursor worker** owns branch/PR creation, verification, FP comments, and terminal `tarmac_*` / status updates.
4. **Reconcile** observes terminal Cursor runs when the worker has not finished FP updates, refreshes `tarmac_cursor_url`, and posts a terminal run/PR comment when appropriate (without duplicating an identical run-link comment).

Writer boundaries and the full property table: [docs/architecture/fp-boundary.md](docs/architecture/fp-boundary.md).

## Orchestrator commands

Source of truth: `apps/tarmac-orchestrator/src/cli.ts`. Every command requires `--cursor fake` or `--cursor real`.

From the repo root (no global `tarmac` binary required):

```bash
bun run tarmac scan --cursor fake
bun run tarmac run-one <issue-id> --cursor fake
bun run tarmac watch --cursor fake --poll-interval 5
bun run tarmac watch --cursor fake --once
bun run tarmac reconcile <issue-id> --cursor fake
```

Equivalent direct invocation:

```bash
bun apps/tarmac-orchestrator/src/cli.ts scan --cursor fake
```

| Command                | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `scan`                 | List eligible vs ineligible issues (JSON on stdout)       |
| `run-one <issue-id>`   | Claim and dispatch one issue                              |
| `watch`                | Poll scan/dispatch loop; `--once` runs a single iteration |
| `reconcile <issue-id>` | Sync terminal Cursor state to FP without relaunching      |

### Fake vs real Cursor mode

| Mode     | `--cursor` | Credentials                                              | Git / remote                                                                                                                   |
| -------- | ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Fake** | `fake`     | None for Cursor; local `fp` must work from repo root     | Uses `git` remotes for context; does not require a pushed HEAD                                                                 |
| **Real** | `real`     | `CURSOR_API_KEY` on host; worker FP REST env (see below) | Local HEAD must match remote `CURSOR_BASE_REF` (default `main`) on `CURSOR_REMOTE_NAME` (default `origin`); working tree clean |

Real mode builds worker env from `apps/tarmac-orchestrator/src/launch-config.ts`: `FP_REMOTE=rest-api`, `FP_TOKEN`, `FP_WORKSPACE`, `FP_PROJECT_ID`, `FP_SERVER_URL`, and optional `FP_PROJECT_PREFIX`. Repository resolution: `apps/tarmac-orchestrator/src/repository.ts`. Cursor SDK dispatch: `packages/cursor-client/src/sdk-client.ts`.

## First run: local fake dispatch

1. Install dependencies (`bun install`).
2. Ensure FP is initialized in this repo (`fp init` if needed).
3. Create or pick a `todo` issue and set `tarmac_ready=true` (via `fp issue update` or the desktop UI).
4. Scan:

   ```bash
   bun run tarmac scan --cursor fake
   ```

5. Dispatch one issue:

   ```bash
   bun run tarmac run-one <issue-id> --cursor fake
   ```

6. Optionally run a single watch iteration:

   ```bash
   bun run tarmac watch --cursor fake --once
   ```

Fake mode exercises claim, prompt rendering, and FP metadata writes without calling Cursor. Use it before enabling real Cloud Agents.

## FP project setup

The orchestrator reads issues through the `fp` CLI from the **repo checkout** (local project mode). Cursor workers must use **REST no-clone** mode from a directory outside the repo; see [docs/reference/fp-rest-no-clone.md](docs/reference/fp-rest-no-clone.md).

### Confirm the repo is linked to Console

From the repository root:

```bash
fp project remote
fp project remote --format json
```

If you see “Project not linked to remote”, connect it:

```bash
fp project link <remote-project-id>
fp project test-connection
```

`fp project remote --format json` is the source for non-secret REST variables (`FP_WORKSPACE`, `FP_PROJECT_ID`, `FP_SERVER_URL`, optional `FP_PROJECT_PREFIX`). The canonical REST mode flag is `FP_REMOTE=rest-api` (see `launch-config.ts`).

### Local FP registry and project files

- User registry: `projects.toml` in the FP CLI data directory (path is printed when you run `fp init`; see [setup.fp.dev](https://setup.fp.dev))
- Per-project storage: a per-project folder under that same data directory
- Repo-local config: `.fp/config.toml` (prefix, `project_id`, extensions)
- User CLI config: `config.toml` alongside `projects.toml` in the FP data directory

Inspect these when debugging “not a registered fp project” or sync issues. Do not commit tokens or host secrets into `.fp/`.

### REST token and environment variables

Obtain or refresh a REST-capable token through supported FP flows:

```bash
fp auth login          # browser or token flow; stores credentials for the CLI
fp auth status         # shows whether a token is configured (do not log stdout in CI)
```

For copy/paste-safe **non-secret** exports, use the repo helper (defaults to redacted `FP_TOKEN`):

```bash
bun run fp:rest-env
bun run fp:rest-env -- --shell
```

`--include-token` prints `FP_TOKEN` to stdout and is **unsafe for logs**—local troubleshooting only.

Manual setup: copy non-secret values from `fp project remote --format json` into the required REST variable names listed in `docs/reference/fp-rest-no-clone.md` and `launch-config.ts`. Prefer `bun run fp:rest-env -- --shell` for export lines. Set the token only in your shell after `fp auth login`; never commit it.

Gated proof that REST property writes work from a non-repo directory (env gate documented in `ops/fp/rest-no-clone-e2e.ts`):

```bash
bun run e2e:fp-rest
```

## Configuring Cursor

Host-side setup lives under `ops/cursor/`. Copy `ops/cursor/.env.example` to `ops/cursor/.env` (gitignored) and set host-only values—never commit `.env`.

| Variable             | Role                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `CURSOR_API_KEY`     | Host-only; required for `--cursor real` and bootstrap scripts                         |
| `CURSOR_REPO_URL`    | Documented default repo URL for experiments (orchestrator resolves remotes via `git`) |
| `CURSOR_BASE_REF`    | Base branch name (default `main`)                                                     |
| `CURSOR_REMOTE_NAME` | Git remote to resolve (default `origin`)                                              |
| `CURSOR_MODEL`       | Model id for SDK experiments                                                          |

Pass **worker** FP REST variables through Cursor Cloud `envVars` (see `launch-config.ts`), not through the worker prompt:

- `FP_REMOTE=rest-api`
- `FP_TOKEN`, `FP_WORKSPACE`, `FP_PROJECT_ID`, `FP_SERVER_URL`
- optional `FP_PROJECT_PREFIX`

Real dispatch additionally requires:

- A **clean** working tree and **pushed** local HEAD matching the remote base ref (`repository.ts` with `requireLocalHeadAtRemote`).
- The GitHub repo **visible** to your Cursor account (private repos must be connected in Cursor settings).
- Repo bootstrap files: `.cursor/environment.json` (install/start), `.cursor/skills/` (e.g. `fp-ticket`), and agent rules under `AGENTS.md` / `FP_AGENTS.md`.

The checked-in Cursor install command is `sh ops/cursor/bootstrap-env.sh`. It
does not rely on a user shell profile or local `~/.bun`; it installs or exposes
Bun in the current shell, runs `bun install --frozen-lockfile`, installs `fp`,
exposes both CLIs through the base worker `PATH`, and verifies both CLIs. To
diagnose a base image without Bun, run:

```bash
rm -rf /tmp/tarmac-cursor-home
mkdir -p /tmp/tarmac-cursor-home/bin
env -i HOME=/tmp/tarmac-cursor-home PATH=/tmp/tarmac-cursor-home/bin:/usr/bin:/bin sh ops/cursor/bootstrap-env.sh
```

Gated live bootstrap (proves SDK + FP REST from a cloud worker; env gate in `ops/cursor/bootstrap-smoke-e2e.ts`):

```bash
bun run e2e:cursor-bootstrap
```

API reference: [docs/reference/cursor/cloud-agent-api.md](docs/reference/cursor/cloud-agent-api.md). Do not use legacy `/v0/agents` REST paths.

## Adding Tarmac to an existing repository

This is a **checklist**, not shipped automation. Adapt paths and prefixes to your project.

1. **FP extensions** — Register `tarmac_*` properties (see `.fp/extensions/tarmac-dispatch.ts` in this repo).
2. **Agent instructions** — Add `AGENTS.md`, `FP_AGENTS.md`, and workflow skills under `.agents/skills/` (mirror to `.claude/skills/` if needed; see [docs/README.md](docs/README.md)).
3. **Cursor worker surface** — Add `.cursor/environment.json`, `.cursor/skills/` (e.g. fp-ticket), and hooks if required.
4. **Bun workspace** — Orchestrator package with CLI entry (`apps/tarmac-orchestrator`), shared packages (`fp-domain`, `cursor-client`, `worker-prompt`), root `bun install` / `bun run check`.
5. **Remote visibility** — Cursor account can access the GitHub remote you dispatch against.
6. **Docs and guardrails** — Architecture ADR, `fp-boundary`, reference docs under `docs/reference/`, ops notes under `ops/cursor/`.
7. **Project-specific values** — Issue prefix, `FP_PROJECT_ID`, workspace slug, server URL, and Cursor repo URL.

After wiring, validate with fake mode, then REST E2E and Cursor bootstrap scripts before production dispatch.

## Agent-oriented pointers

- Repo map: [AGENTS.md](AGENTS.md)
- FP workflow: [FP_AGENTS.md](FP_AGENTS.md)
- Cloud worker ticket loop: [.cursor/skills/fp-ticket/SKILL.md](.cursor/skills/fp-ticket/SKILL.md)
- Implementation skill: [.agents/skills/fp-task/SKILL.md](.agents/skills/fp-task/SKILL.md)

## Verification commands

```bash
bun run format:check
bun run check
bun run test
```

For helper/script changes, also run `bun test ops/fp/rest-env-from-remote.test.ts`.
