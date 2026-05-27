import { join } from "node:path";

export const TARMAC_STATE_DIR_NAME = ".tarmac";
export const RUNS_LEDGER_FILE_NAME = "runs.jsonl";

export const resolveStateRoot = (cwd: string): string => join(cwd, TARMAC_STATE_DIR_NAME);

export const resolveRunsLedgerPath = (stateRoot: string): string =>
  join(stateRoot, RUNS_LEDGER_FILE_NAME);

export const resolveRunEventsPath = (stateRoot: string, runId: string): string =>
  join(stateRoot, "runs", runId, "events.jsonl");

export const eventsPathRelativeToStateRoot = (stateRoot: string, runId: string): string => {
  const absolute = resolveRunEventsPath(stateRoot, runId);
  const prefix = `${stateRoot}/`;
  return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : absolute;
};
