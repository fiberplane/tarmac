import { Schema } from "effect";

import { LOCAL_STATE_SCHEMA_VERSION } from "./types";

const RepositorySchema = Schema.Struct({
  remoteUrl: Schema.String,
  baseBranch: Schema.String,
  baseSha: Schema.String,
});

export const RunSummarySchema = Schema.Struct({
  iterations: Schema.optional(Schema.Number),
  dispatchedCount: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
});

export const RunLedgerRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(LOCAL_STATE_SCHEMA_VERSION),
  phase: Schema.Literal("started", "finished"),
  runId: Schema.String,
  command: Schema.Literal("watch", "daemon", "scan", "run-one", "reconcile"),
  runnerId: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.optional(Schema.String),
  status: Schema.Literal("running", "completed", "failed"),
  repository: RepositorySchema,
  cursorMode: Schema.optional(Schema.Literal("fake", "real")),
  eventsPath: Schema.String,
  summary: Schema.optional(RunSummarySchema),
});

export const PersistedOrchestratorEventSchema = Schema.Struct(
  {
    schemaVersion: Schema.Literal(LOCAL_STATE_SCHEMA_VERSION),
    runId: Schema.String,
    seq: Schema.Number,
    ts: Schema.String,
    type: Schema.String,
  },
  Schema.Record({
    key: Schema.String,
    value: Schema.Unknown,
  }),
);
