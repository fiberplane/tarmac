import type { IneligibilityReason } from "@tarmac/fp-domain";

import type { RunCommand, RunLifecycleStatus, RunSummary } from "../local-state/types";

export type IneligibilityReasonView = IneligibilityReason;

export type IssueTarmacView = {
  readonly ready?: string;
  readonly state?: string;
  readonly cursorUrl?: string;
  readonly agentId?: string;
  readonly runId?: string;
  readonly branch?: string;
  readonly prUrl?: string;
  readonly prNumber?: string;
  readonly baseSha?: string;
  readonly headSha?: string;
  readonly lastError?: string;
};

export type IssueView = {
  readonly id: string;
  readonly displayId?: string;
  readonly title?: string;
  readonly status?: string;
  readonly parent?: string;
  readonly dependencies?: readonly string[];
  readonly tarmac?: IssueTarmacView;
  readonly eligibility?: {
    readonly kind: "eligible" | "ineligible";
    readonly reason?: IneligibilityReasonView;
  };
};

export type ScanView = {
  readonly source: "live" | "cached" | "unavailable";
  readonly scannedAt?: string;
  readonly eligible: readonly IssueView[];
  readonly ineligible: readonly {
    readonly issue: IssueView;
    readonly reason: IneligibilityReasonView;
  }[];
};

export type BoutView = {
  readonly parent: IssueView;
  readonly children: readonly IssueView[];
};

export type RunDispatchView = {
  readonly issue: IssueView;
  readonly claimId?: string;
  readonly cursorUrl?: string;
  readonly branch?: string;
  readonly prUrl?: string;
  readonly prNumber?: string;
  readonly stage?: string;
  readonly error?: string;
  readonly lastEventType?: string;
  readonly lastEventAt?: string;
};

export type RunTimelineEntryView = {
  readonly at?: string;
  readonly label: string;
  readonly status: "ok" | "warn" | "bad" | "running" | "neutral";
  readonly detail?: string;
  readonly issue?: string;
};

export type LogExcerptRowView = {
  readonly timestamp: string;
  readonly type: string;
  readonly issue?: string;
  readonly severity: "info" | "warn" | "error";
  readonly message: string;
};

export type RunCardView = {
  readonly runId: string;
  readonly command: RunCommand;
  readonly status: RunLifecycleStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly runnerId: string;
  readonly cursorMode?: "fake" | "real";
  readonly summary?: RunSummary;
  readonly dispatches: readonly RunDispatchView[];
  readonly logExcerpt: readonly string[];
  readonly logRows: readonly LogExcerptRowView[];
  readonly timeline: readonly RunTimelineEntryView[];
  readonly corruptEventLineCount?: number;
};

export type IssueQueueGroupView = {
  readonly id: string;
  readonly label: string;
  readonly issues: readonly IssueView[];
};

export type DashboardStatus = {
  readonly generatedAt: string;
  readonly stateRoot: string;
  readonly repository?: {
    readonly remoteUrl: string;
    readonly baseBranch: string;
    readonly baseSha: string;
  };
  readonly scan: ScanView;
  readonly issueQueue: readonly IssueQueueGroupView[];
  readonly bouts: readonly BoutView[];
  readonly issues: readonly IssueView[];
  readonly runs: readonly RunCardView[];
};

export type DashboardServerOptions = {
  readonly host: string;
  readonly port: number;
  readonly cwd: string;
  readonly stateRoot: string;
  readonly runLimit: number;
  readonly eventLimit: number;
  readonly liveScan: boolean;
};
