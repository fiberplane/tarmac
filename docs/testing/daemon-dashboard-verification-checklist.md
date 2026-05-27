# Daemon and dashboard verification checklist

Use this checklist before a **meetup demo**, after **orchestrator/dashboard changes**, or when **onboarding a new operator**. Pair with the [daemon and dashboard demo runbook](../reference/daemon-dashboard-demo-runbook.md).

## Related docs

- [daemon-dashboard-demo-runbook.md](../reference/daemon-dashboard-demo-runbook.md) — setup, meetup script, degraded modes
- [GETTING_STARTED.md](../../GETTING_STARTED.md) — install and FP link
- [local-observability.md](../reference/local-observability.md) — `.tarmac/` paths and dashboard API
- [architecture/SPEC.md](../architecture/SPEC.md) — system contract
- [architecture/fp-boundary.md](../architecture/fp-boundary.md) — `tarmac_*` and eligibility
- [.agents/skills/thermo-nuclear-code-quality-review/SKILL.md](../../.agents/skills/thermo-nuclear-code-quality-review/SKILL.md) — PR maintainability attestation (not CI)

## 1. Repository baseline

Run from repo root (confirm not a nested clone):

```bash
git rev-parse --show-toplevel
bun install
bun run format:check
bun run check
```

For code changes (orchestrator, dashboard, packages):

```bash
bun run test
bun run --filter @tarmac/orchestrator test
```

`bun run check` runs `lint`, `lint:ast`, `lint:drift`, and `typecheck` — it does **not** run tests or `format:check`.

Optional when FP REST helpers changed:

```bash
bun test ops/fp/rest-env-from-remote.test.ts
```

## 2. FP and project link

| Check                    | Command / action                | Pass criteria                                             |
| ------------------------ | ------------------------------- | --------------------------------------------------------- |
| FP project registered    | `fp tree`                       | Lists issues without “not a registered fp project”        |
| Console link (real path) | `fp project remote`             | Shows linked remote or documented skip for fake-only demo |
| Connection               | `fp project test-connection`    | Succeeds when using real Cursor workers                   |
| Ready gate               | `fp issue show <id>`            | `tarmac_ready` wire value `true` for dispatch candidates  |
| No secrets in comments   | Review recent `fp comment list` | No token names/values in text                             |

REST worker path (outside repo):

```bash
mkdir -p /tmp/fp-rest-check && cd /tmp/fp-rest-check
# After sourcing non-secret env from: bun run fp:rest-env -- --shell
# and setting token locally:
fp issue show <issue-id>
```

Gated E2E (when env gates are set): `bun run e2e:fp-rest`.

## 3. Fake-mode orchestrator

| Check           | Command                                                                                | Pass criteria                                                     |
| --------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Scan            | `bun run tarmac scan --cursor fake`                                                    | JSON with `eligible` / `ineligible` / `parentRollups` as expected |
| Single dispatch | `bun run tarmac run-one <issue-id> --cursor fake`                                      | FP gains `tarmac_claim_id`, fake agent/run IDs                    |
| Watch once      | `bun run tarmac watch --cursor fake --once`                                            | Completes one iteration; `.tarmac/runs.jsonl` grows               |
| Daemon smoke    | Start `bun run tarmac daemon --cursor fake --poll-interval 5`; stop after one dispatch | Ledger and per-run `events.jsonl` present                         |
| Status          | `bun run tarmac status --limit 3 --events 10`                                          | JSON `stateRoot`, runs with `eventsPath`                          |
| Reconcile       | `bun run tarmac reconcile <issue-id> --cursor fake`                                    | No relaunch; terminal metadata or comment when applicable         |

## 4. Dashboard browser inspection

| Check         | Action                                             | Pass criteria                                     |
| ------------- | -------------------------------------------------- | ------------------------------------------------- |
| Server starts | `bun run tarmac dashboard`                         | stderr prints loopback URL (default port `3847`)  |
| Page loads    | Open `/` in browser                                | Scan, bouts, runs sections render                 |
| API           | `curl -s http://127.0.0.1:3847/api/status \| head` | JSON payload; no raw tokens in output             |
| Live scan     | Default (no `--no-live-scan`)                      | Eligible issues match `tarmac scan`               |
| Cached-only   | `bun run tarmac dashboard --no-live-scan`          | Shows `.tarmac/` history when FP down             |
| Security      | Confirm bind address                               | Stays on `127.0.0.1` unless you trust the network |

## 5. Real Cursor path (configured operators only)

| Check           | Command / action                      | Pass criteria                                   |
| --------------- | ------------------------------------- | ----------------------------------------------- |
| Host env        | `ops/cursor/.env` from example        | API key set locally; not committed              |
| Clean git       | `git status --short`                  | Empty before `real` dispatch                    |
| Pushed HEAD     | `git push` then `git rev-parse HEAD`  | Matches remote base ref                         |
| Bootstrap smoke | `bun run e2e:cursor-bootstrap`        | Passes when gate env is set                     |
| Real daemon     | `bun run tarmac daemon --cursor real` | Launches cloud agent; FP pre-handoff fields set |
| Cursor link     | Open `tarmac_cursor_url` from FP      | Run visible in Cursor UI (real IDs)             |

## 6. Secret hygiene

- [ ] No API keys, FP tokens, or GitHub tokens in repo files, commits, or PR descriptions.
- [ ] `bun run fp:rest-env` used without `--include-token` in shared logs.
- [ ] `.tarmac/` excerpts and dashboard JSON reviewed for accidental paste of secrets.
- [ ] Worker prompts and FP comments use redacted errors only (`tarmac_last_error`).

## 7. Worker and PR babysitting (real demos)

For issues handed to Cursor Cloud Agents:

- [ ] Worker followed [.cursor/skills/fp-ticket/SKILL.md](../../.cursor/skills/fp-ticket/SKILL.md).
- [ ] Verification on branch: `bun run test`, `bun run format:check`, `bun run check` when code changed.
- [ ] Thermo-nuclear skill run; `.github/pull_request_template.md` attestation filled (separate from CI).
- [ ] FP updated with branch, PR URL, head SHA, terminal `tarmac_state` when available.
- [ ] PR checks monitored until green or explicit human handoff.
- [ ] Issue marked done only after acceptance criteria and review gates are met.

## 8. Degraded-mode spot checks

Confirm documented behavior from the runbook:

| Scenario           | Quick test                                              | Expected                                   |
| ------------------ | ------------------------------------------------------- | ------------------------------------------ |
| Missing Cursor key | `bun run tarmac run-one <id> --cursor real` without env | Clear failure; no silent fake fallback     |
| Unlinked remote    | Worker `fp issue show` from `/tmp` without REST env     | Fails with actionable message              |
| Dirty tree         | Uncommitted file + `--cursor real`                      | Launch blocked                             |
| No PR yet          | Active run, empty `tarmac_pr_url`                       | Normal; reconcile/worker fills later       |
| Failing CI         | Open PR with red checks                                 | Document handoff; do not false-complete FP |

## Sign-off

| Role     | Name | Date | Notes                       |
| -------- | ---- | ---- | --------------------------- |
| Operator |      |      | Fake demo OK / Real path OK |
| Worker   |      |      | PR + FP metadata OK         |
