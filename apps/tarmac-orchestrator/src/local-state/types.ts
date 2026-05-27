import type { IneligibilityReason } from "@tarmac/fp-domain";

export const LOCAL_STATE_SCHEMA_VERSION = 1 as const;

export type RunCommand = "watch" | "daemon" | "scan" | "run-one" | "reconcile";

export type RunLifecycleStatus = "running" | "completed" | "failed";

export type RunLedgerPhase = "started" | "finished";

export type RunLedgerRecord = {
  readonly schemaVersion: typeof LOCAL_STATE_SCHEMA_VERSION;
  readonly phase: RunLedgerPhase;
  readonly runId: string;
  readonly command: RunCommand;
  readonly runnerId: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly status: RunLifecycleStatus;
  readonly repository: {
    readonly remoteUrl: string;
    readonly baseBranch: string;
    readonly baseSha: string;
  };
  readonly cursorMode?: "fake" | "real";
  readonly eventsPath: string;
  readonly summary?: RunSummary;
};

export type RunSummary = {
  readonly iterations?: number;
  readonly dispatchedCount?: number;
  readonly error?: string;
};

export type IssueRef = {
  readonly issueId: string;
  readonly displayId?: string;
};

export type CursorRunRef = {
  readonly agentId: string;
  readonly runId: string;
  readonly branch?: string;
  readonly prUrl?: string;
  readonly prNumber?: string;
};

export type OrchestratorEvent =
  | {
      readonly type: "run.started";
      readonly command: RunCommand;
      readonly runnerId: string;
      readonly repository: RunLedgerRecord["repository"];
      readonly cursorMode?: "fake" | "real";
    }
  | {
      readonly type: "run.finished";
      readonly status: Exclude<RunLifecycleStatus, "running">;
      readonly summary?: RunSummary;
    }
  | {
      readonly type: "scan.started";
    }
  | {
      readonly type: "scan.finished";
      readonly eligible: readonly IssueRef[];
      readonly ineligible: readonly {
        readonly issue: IssueRef;
        readonly reason: IneligibilityReason["kind"];
      }[];
    }
  | {
      readonly type: "issue.ineligible";
      readonly issue: IssueRef;
      readonly reason: IneligibilityReason["kind"];
    }
  | {
      readonly type: "claim.attempt";
      readonly issue: IssueRef;
    }
  | {
      readonly type: "claim.success";
      readonly issue: IssueRef;
      readonly claimId: string;
      readonly attempt: number;
    }
  | {
      readonly type: "claim.lost";
      readonly issue: IssueRef;
      readonly reason: string;
    }
  | {
      readonly type: "cursor.launch";
      readonly issue: IssueRef;
      readonly claimId: string;
      readonly cursorRun: CursorRunRef;
    }
  | {
      readonly type: "metadata.persisted";
      readonly issue: IssueRef;
      readonly claimId?: string;
      readonly cursorRun: CursorRunRef;
      readonly baseSha: string;
      readonly headSha?: string;
      readonly tarmacState?: string;
    }
  | {
      readonly type: "reconcile.started";
      readonly issue: IssueRef;
    }
  | {
      readonly type: "reconcile.finished";
      readonly issue: IssueRef;
      readonly cursorRun: CursorRunRef;
      readonly tarmacState?: string;
    }
  | {
      readonly type: "dispatch.failed";
      readonly issue: IssueRef;
      readonly stage: "pre-launch" | "post-launch";
      readonly error: string;
    }
  | {
      readonly type: "terminal.result";
      readonly issue: IssueRef;
      readonly cursorRun: CursorRunRef;
      readonly prUrl?: string;
    }
  | {
      readonly type: "watch.iteration";
      readonly iteration: number;
    };

export type PersistedOrchestratorEvent = OrchestratorEvent & {
  readonly schemaVersion: typeof LOCAL_STATE_SCHEMA_VERSION;
  readonly runId: string;
  readonly seq: number;
  readonly ts: string;
};

export type RunStatusView = {
  readonly runId: string;
  readonly command: RunCommand;
  readonly runnerId: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly status: RunLifecycleStatus;
  readonly repository: RunLedgerRecord["repository"];
  readonly cursorMode?: "fake" | "real";
  readonly eventsPath: string;
  readonly summary?: RunSummary;
};
