# Local orchestrator observability

Tarmac keeps a **local operator history** under `.tarmac/` in the repository checkout. FP remains the task source of truth; the ledger and event logs are a durable cache for debugging `watch` and `daemon` runs after a process exits or restarts.

## Paths

| Path                                 | Purpose                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `.tarmac/runs.jsonl`                 | Append-only run ledger (`started` / `finished` records per orchestrator session) |
| `.tarmac/runs/<run-id>/events.jsonl` | Structured, redacted lifecycle events for one session                            |

Both paths are gitignored (see root `.gitignore`). They are safe to delete when you want a clean slate.

## Commands

Persistence is enabled by default for `watch` and `daemon`. Other commands write local state only when `--persist` is passed.

```bash
bun run tarmac watch --cursor fake --once
bun run tarmac daemon --cursor fake --poll-interval 5
bun run tarmac status
bun run tarmac status --limit 5 --events 20
bun run tarmac scan --cursor fake --persist
```

| Flag                | Effect                                                        |
| ------------------- | ------------------------------------------------------------- |
| `--no-persist`      | Disable local ledger/events for `watch` / `daemon`            |
| `--persist`         | Enable local ledger/events for `scan`, `run-one`, `reconcile` |
| `status --limit N`  | Return the N most recent runs (default 10)                    |
| `status --events N` | Include the last N structured events per run                  |

`status` prints JSON with `stateRoot` and `runs`. Each run includes stable join keys: local `runId`, `runnerId`, repository `baseSha`, and `eventsPath`.

## Event types

Structured events use typed `type` values, for example:

- `run.started`, `run.finished`
- `scan.started`, `scan.finished`, `issue.ineligible`
- `claim.attempt`, `claim.success`, `claim.lost`
- `cursor.launch`, `metadata.persisted`, `dispatch.failed`
- `reconcile.started`, `reconcile.finished`, `terminal.result`
- `watch.iteration`

Payloads include FP `issueId` / `displayId`, `tarmac_claim_id`, Cursor `agentId` / `runId`, branch, PR URL/number when known, and base/head SHAs when persisted to FP.

## Secret hygiene

Values are passed through the same redaction rules as worker prompts (`redactSensitiveText`) before anything is written. Token values, dotenv contents, Cursor API keys, FP tokens, and GitHub tokens must not appear in ledger or event files. If you inspect files manually, treat unknown strings as sensitive until confirmed.

## Inspecting logs

```bash
tail -n 20 .tarmac/runs.jsonl | jq .
tail -n 50 .tarmac/runs/<run-id>/events.jsonl | jq .
bun run tarmac status --events 30 | jq .
```

Corrupt JSONL lines are skipped when reading; `status` may report `corruptEventLineCount` when `--events` is used.
