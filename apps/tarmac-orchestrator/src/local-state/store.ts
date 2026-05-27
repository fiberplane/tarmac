import { randomUUID } from "node:crypto";

import type { PromptRedactionConfig } from "@tarmac/worker-prompt";
import { Schema } from "effect";

import { appendJsonlLine, readJsonlFile } from "./jsonl";
import {
  eventsPathRelativeToStateRoot,
  resolveRunEventsPath,
  resolveRunsLedgerPath,
} from "./paths";
import { redactUnknown } from "./redact";
import {
  PersistedOrchestratorEventSchema,
  RunLedgerRecordSchema,
  RunSummarySchema,
} from "./schemas";
import type {
  OrchestratorEvent,
  RunCommand,
  RunLedgerRecord,
  RunLifecycleStatus,
  RunStatusView,
  RunSummary,
} from "./types";
import { LOCAL_STATE_SCHEMA_VERSION } from "./types";

type DecodedPersistedEvent = Schema.Schema.Type<typeof PersistedOrchestratorEventSchema>;
type DecodedRunSummary = Schema.Schema.Type<typeof RunSummarySchema>;

const normalizeRunSummary = (summary: DecodedRunSummary): RunSummary => ({
  ...(summary.iterations === undefined ? {} : { iterations: summary.iterations }),
  ...(summary.dispatchedCount === undefined ? {} : { dispatchedCount: summary.dispatchedCount }),
  ...(summary.error === undefined ? {} : { error: summary.error }),
});

export type LocalRunStoreOptions = {
  readonly stateRoot: string;
  readonly redaction?: PromptRedactionConfig;
};

export type BeginRunOptions = {
  readonly command: RunCommand;
  readonly runnerId: string;
  readonly repository: RunLedgerRecord["repository"];
  readonly cursorMode?: "fake" | "real";
};

export type FinishRunOptions = {
  readonly status: Exclude<RunLifecycleStatus, "running">;
  readonly summary?: RunSummary;
};

export class LocalRunStore {
  readonly #stateRoot: string;
  readonly #redaction: PromptRedactionConfig | undefined;
  readonly #ledgerPath: string;

  constructor(options: LocalRunStoreOptions) {
    this.#stateRoot = options.stateRoot;
    this.#redaction = options.redaction;
    this.#ledgerPath = resolveRunsLedgerPath(options.stateRoot);
  }

  beginRun(options: BeginRunOptions): RunSession {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const eventsPath = eventsPathRelativeToStateRoot(this.#stateRoot, runId);
    const eventsFilePath = resolveRunEventsPath(this.#stateRoot, runId);

    const startedRecord: RunLedgerRecord = {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      phase: "started",
      runId,
      command: options.command,
      runnerId: options.runnerId,
      startedAt,
      status: "running",
      repository: options.repository,
      ...(options.cursorMode === undefined ? {} : { cursorMode: options.cursorMode }),
      eventsPath,
    };

    return new RunSession({
      store: this,
      runId,
      eventsFilePath,
      eventsPath,
      startedRecord,
      command: options.command,
      runnerId: options.runnerId,
      repository: options.repository,
      ...(options.cursorMode === undefined ? {} : { cursorMode: options.cursorMode }),
      redaction: this.#redaction,
    });
  }

  async appendLedgerRecord(record: RunLedgerRecord): Promise<void> {
    const redacted = Schema.decodeUnknownSync(RunLedgerRecordSchema)(
      redactUnknown(record, this.#redaction),
    );
    await appendJsonlLine(this.#ledgerPath, redacted);
  }

  async appendEvent(
    eventsFilePath: string,
    runId: string,
    seq: number,
    event: OrchestratorEvent,
  ): Promise<void> {
    const persisted = {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      runId,
      seq,
      ts: new Date().toISOString(),
      ...event,
    };
    const redacted = Schema.decodeUnknownSync(PersistedOrchestratorEventSchema)(
      redactUnknown(persisted, this.#redaction),
    );
    await appendJsonlLine(eventsFilePath, redacted);
  }

  async listRecentRuns(limit: number): Promise<readonly RunStatusView[]> {
    const parsed = await readJsonlFile(this.#ledgerPath, RunLedgerRecordSchema);

    const byRunId = new Map<string, RunStatusView>();

    for (const record of parsed.entries) {
      const existing = byRunId.get(record.runId);
      if (record.phase === "started") {
        byRunId.set(record.runId, {
          runId: record.runId,
          command: record.command,
          runnerId: record.runnerId,
          startedAt: record.startedAt,
          status: record.status,
          repository: record.repository,
          ...(record.cursorMode === undefined ? {} : { cursorMode: record.cursorMode }),
          eventsPath: record.eventsPath,
        });
        continue;
      }

      byRunId.set(record.runId, {
        runId: record.runId,
        command: record.command,
        runnerId: record.runnerId,
        startedAt: existing?.startedAt ?? record.startedAt,
        ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
        status: record.status,
        repository: record.repository,
        ...(record.cursorMode === undefined
          ? existing?.cursorMode === undefined
            ? {}
            : { cursorMode: existing.cursorMode }
          : { cursorMode: record.cursorMode }),
        eventsPath: record.eventsPath,
        ...(record.summary === undefined ? {} : { summary: normalizeRunSummary(record.summary) }),
      });
    }

    return [...byRunId.values()]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, Math.max(0, limit));
  }

  async readRunEvents(
    eventsPath: string,
    limit: number,
  ): Promise<{
    readonly events: readonly DecodedPersistedEvent[];
    readonly corruptLineCount: number;
  }> {
    const eventsFilePath = eventsPath.startsWith("/")
      ? eventsPath
      : `${this.#stateRoot}/${eventsPath}`;
    const parsed = await readJsonlFile(eventsFilePath, PersistedOrchestratorEventSchema);

    const events =
      limit <= 0
        ? parsed.entries
        : parsed.entries.slice(Math.max(0, parsed.entries.length - limit));

    return {
      events,
      corruptLineCount: parsed.corruptLineCount,
    };
  }
}

type RunSessionOptions = {
  readonly store: LocalRunStore;
  readonly runId: string;
  readonly eventsFilePath: string;
  readonly eventsPath: string;
  readonly startedRecord: RunLedgerRecord;
  readonly command: RunCommand;
  readonly runnerId: string;
  readonly repository: RunLedgerRecord["repository"];
  readonly cursorMode?: "fake" | "real";
  readonly redaction: PromptRedactionConfig | undefined;
};

export class RunSession {
  readonly #store: LocalRunStore;
  readonly #runId: string;
  readonly #eventsFilePath: string;
  readonly #eventsPath: string;
  readonly #startedRecord: RunLedgerRecord;
  readonly #command: RunCommand;
  readonly #runnerId: string;
  readonly #repository: RunLedgerRecord["repository"];
  readonly #cursorMode: "fake" | "real" | undefined;
  readonly #redaction: PromptRedactionConfig | undefined;
  #seq = 0;
  #finished = false;

  constructor(options: RunSessionOptions) {
    this.#store = options.store;
    this.#runId = options.runId;
    this.#eventsFilePath = options.eventsFilePath;
    this.#eventsPath = options.eventsPath;
    this.#startedRecord = options.startedRecord;
    this.#command = options.command;
    this.#runnerId = options.runnerId;
    this.#repository = options.repository;
    this.#cursorMode = options.cursorMode;
    this.#redaction = options.redaction;
  }

  get runId(): string {
    return this.#runId;
  }

  get eventsPath(): string {
    return this.#eventsPath;
  }

  async open(): Promise<void> {
    await this.#store.appendLedgerRecord(this.#startedRecord);
    await this.record({
      type: "run.started",
      command: this.#command,
      runnerId: this.#runnerId,
      repository: this.#repository,
      ...(this.#cursorMode === undefined ? {} : { cursorMode: this.#cursorMode }),
    });
  }

  async record(event: OrchestratorEvent): Promise<void> {
    if (this.#finished) {
      return;
    }

    this.#seq += 1;
    await this.#store.appendEvent(this.#eventsFilePath, this.#runId, this.#seq, event);
  }

  async finish(options: FinishRunOptions): Promise<void> {
    if (this.#finished) {
      return;
    }

    this.#finished = true;
    const finishedAt = new Date().toISOString();
    const summary =
      options.summary === undefined
        ? undefined
        : normalizeRunSummary(
            Schema.decodeUnknownSync(RunSummarySchema)(
              redactUnknown(options.summary, this.#redaction),
            ),
          );

    await this.record({
      type: "run.finished",
      status: options.status,
      ...(summary === undefined ? {} : { summary }),
    });

    const finishedRecord: RunLedgerRecord = {
      ...this.#startedRecord,
      phase: "finished",
      finishedAt,
      status: options.status,
      ...(summary === undefined ? {} : { summary }),
    };
    await this.#store.appendLedgerRecord(finishedRecord);
  }
}
