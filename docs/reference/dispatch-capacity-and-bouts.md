# Dispatch capacity and multi-issue bouts

Tarmac limits how many Cursor Cloud runs the orchestrator launches at once and
models parent/child FP issue trees as **bouts**: the parent is the planning unit,
children are execution units.

## Global concurrency cap

| Source      | Name                         | Default                |
| ----------- | ---------------------------- | ---------------------- |
| Environment | `TARMAC_MAX_CONCURRENT_RUNS` | `1`                    |
| CLI         | `--max-concurrent-runs <n>`  | overrides env when set |

`watch` and `daemon` dispatch at most this many **active** runs per iteration.
`scan` shows which ready issues would dispatch now versus which are waiting on
capacity.

Active runs are counted **conservatively** for restarts:

1. Any open issue with `tarmac_agent_id` and/or `tarmac_run_id` where
   `tarmac_state` is not `end` and built-in status is not terminal.
2. Any issue ID held in the orchestrator process claim set (between claim and
   Cursor metadata write).

The same issue is never double-counted. This does **not** add cross-process
exactly-once guarantees; two orchestrator processes can still race.

Per-bout or per-parent caps are intentionally out of scope for the first
implementation; use FP structure and the global cap until a future release adds
finer limits.

## Modeling bouts in FP

1. Create a **parent** issue for the bout (planning, acceptance, rollup).
2. Create **child** issues linked with FP `parent` for executable units.
3. Mark children `todo` with `tarmac_ready=true` when they should be considered.
4. Use built-in **dependencies** between children when order matters.

Rules:

- A parent with **open children** (`todo` or `in-progress`) is **not**
  dispatchable; children dispatch when individually ready and dependencies are
  satisfied.
- When all children are terminal (`done` / `cancelled`), the parent may become
  eligible if it is otherwise ready.
- `tarmac scan` includes `parentRollups` summarizing open/done children and active
  child Cursor runs for each parent.

Example scan fragment:

```json
{
  "eligible": ["TARM-12"],
  "capacity": { "activeRunCount": 1, "maxConcurrentRuns": 2 },
  "parentRollups": [
    {
      "parentId": "…",
      "parentDisplayId": "TARM-10",
      "openChildCount": 2,
      "doneChildCount": 1,
      "activeChildRunCount": 1,
      "dispatchBlockedByOpenChildren": true
    }
  ]
}
```

## Dispatch ordering

When capacity allows multiple dispatches in one iteration, issues are ordered by
`displayId` (numeric-aware), then `id`. This keeps fake-mode tests and operator
reruns predictable.

## Operator commands

```bash
export TARMAC_MAX_CONCURRENT_RUNS=2
bun run tarmac scan --cursor fake
bun run tarmac watch --cursor fake --once --max-concurrent-runs 2
```

See [GETTING_STARTED.md](../../GETTING_STARTED.md) and [fp-boundary.md](../architecture/fp-boundary.md).
