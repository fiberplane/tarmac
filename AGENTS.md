# AGENTS.md

Tarmac is a prototype for a Symphony-like autonomous software loop that uses FP
as the tracker and Cursor Cloud Agents as the worker runtime.

## Operating Contract

- Use `fp` for task tracking, comments, and implementation devlog.
- Prefer small ADR-backed tracebullets: write the behavioral contract, add a red
  test or QA scenario, then make the smallest green implementation.
- Keep worker credentials and service tokens out of repo files, prompts, logs,
  fp comments, PR text, and artifacts.
- Cursor workers own code changes after handoff: they should push a branch, open
  or update a PR, record PR metadata in FP, and mark their issue terminal only
  after verification.
- The local orchestrator owns pre-handoff eligibility, claiming, dispatch, and
  recovery from launch failures.

## Commands

```bash
bun install
bun run lint
bun run lint:ast
bun run lint:drift
bun run format:check
bun run typecheck
bun run check
```

After non-trivial code changes, run `bun run test`, `bun run format:check`, and
`bun run check`. If a command is unavailable because dependencies are not
installed yet, record that in the relevant fp issue comment.

## Architecture Pointers

- `docs/architecture/0001-cursor-backed-symphony-loop.md` records the core
  deviation from Symphony/Codex toward Cursor Cloud Agents.
- `docs/architecture/fp-boundary.md` records FP custom properties, eligibility,
  and writer boundaries.
- `.agents/skills/fp-task/SKILL.md` is the local issue implementation workflow.
- `.agents/skills/thermo-nuclear-code-quality-review/SKILL.md` is the strict
  maintainability review rubric.

@FP_AGENTS.md
