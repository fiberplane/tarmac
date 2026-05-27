import type { CursorRunSnapshot } from "@tarmac/cursor-client";
import type { TarmacIssueUpdate } from "@tarmac/fp-domain";

import type { OrchestratorIssue } from "../fp-client";
import type { ReconcileResult, ScanResult } from "../orchestrator";
import { toCursorRunRef } from "./cursor-ref";
import { toIssueRef } from "./issue-ref";
import type { RunSession } from "./store";

export type OrchestratorObserver = {
  readonly onScanStarted?: () => void | Promise<void>;
  readonly onScanFinished?: (scan: ScanResult) => void | Promise<void>;
  readonly onWatchIteration?: (iteration: number) => void | Promise<void>;
  readonly onClaimAttempt?: (issue: OrchestratorIssue) => void | Promise<void>;
  readonly onClaimSuccess?: (
    issue: OrchestratorIssue,
    claimId: string,
    attempt: number,
  ) => void | Promise<void>;
  readonly onClaimLost?: (issue: OrchestratorIssue, reason: string) => void | Promise<void>;
  readonly onCursorLaunch?: (
    issue: OrchestratorIssue,
    claimId: string,
    run: CursorRunSnapshot,
  ) => void | Promise<void>;
  readonly onMetadataPersisted?: (
    issue: OrchestratorIssue,
    update: TarmacIssueUpdate,
    claimId: string | undefined,
    run: CursorRunSnapshot,
  ) => void | Promise<void>;
  readonly onDispatchFailed?: (
    issue: OrchestratorIssue,
    stage: "pre-launch" | "post-launch",
    error: string,
  ) => void | Promise<void>;
  readonly onReconcileStarted?: (issue: OrchestratorIssue) => void | Promise<void>;
  readonly onReconcileFinished?: (
    result: ReconcileResult,
    update: TarmacIssueUpdate,
  ) => void | Promise<void>;
};

export const createRunSessionObserver = (session: RunSession): OrchestratorObserver => ({
  onScanStarted: async () => {
    await session.record({ type: "scan.started" });
  },
  onScanFinished: async (scan) => {
    await session.record({
      type: "scan.finished",
      eligible: scan.eligible.map(toIssueRef),
      ineligible: scan.ineligible.map((entry) => ({
        issue: toIssueRef(entry.issue),
        reason: entry.reason.kind,
      })),
    });
    for (const entry of scan.ineligible) {
      await session.record({
        type: "issue.ineligible",
        issue: toIssueRef(entry.issue),
        reason: entry.reason.kind,
      });
    }
  },
  onWatchIteration: async (iteration) => {
    await session.record({
      type: "watch.iteration",
      iteration,
    });
  },
  onClaimAttempt: async (issue) => {
    await session.record({
      type: "claim.attempt",
      issue: toIssueRef(issue),
    });
  },
  onClaimSuccess: async (issue, claimId, attempt) => {
    await session.record({
      type: "claim.success",
      issue: toIssueRef(issue),
      claimId,
      attempt,
    });
  },
  onClaimLost: async (issue, reason) => {
    await session.record({
      type: "claim.lost",
      issue: toIssueRef(issue),
      reason,
    });
  },
  onCursorLaunch: async (issue, claimId, run) => {
    await session.record({
      type: "cursor.launch",
      issue: toIssueRef(issue),
      claimId,
      cursorRun: toCursorRunRef(run),
    });
  },
  onMetadataPersisted: async (issue, update, claimId, run) => {
    await session.record({
      type: "metadata.persisted",
      issue: toIssueRef(issue),
      ...(claimId === undefined ? {} : { claimId }),
      cursorRun: toCursorRunRef(run),
      baseSha: update.properties.tarmac_base_sha ?? "",
      ...(update.properties.tarmac_head_sha === undefined
        ? {}
        : { headSha: update.properties.tarmac_head_sha }),
      ...(update.properties.tarmac_state === undefined
        ? {}
        : { tarmacState: update.properties.tarmac_state }),
    });
    if (update.properties.tarmac_state === "end") {
      await session.record({
        type: "terminal.result",
        issue: toIssueRef(issue),
        cursorRun: toCursorRunRef(run),
        ...(update.properties.tarmac_pr_url === undefined
          ? run.prUrl === undefined
            ? {}
            : { prUrl: run.prUrl }
          : { prUrl: update.properties.tarmac_pr_url }),
      });
    }
  },
  onDispatchFailed: async (issue, stage, error) => {
    await session.record({
      type: "dispatch.failed",
      issue: toIssueRef(issue),
      stage,
      error,
    });
  },
  onReconcileStarted: async (issue) => {
    await session.record({
      type: "reconcile.started",
      issue: toIssueRef(issue),
    });
  },
  onReconcileFinished: async (result, update) => {
    await session.record({
      type: "reconcile.finished",
      issue: toIssueRef(result.issue),
      cursorRun: toCursorRunRef(result.cursorRun),
      ...(update.properties.tarmac_state === undefined
        ? {}
        : { tarmacState: update.properties.tarmac_state }),
    });
    if (update.properties.tarmac_state === "end") {
      await session.record({
        type: "terminal.result",
        issue: toIssueRef(result.issue),
        cursorRun: toCursorRunRef(result.cursorRun),
        ...(update.properties.tarmac_pr_url === undefined
          ? result.cursorRun.prUrl === undefined
            ? {}
            : { prUrl: result.cursorRun.prUrl }
          : { prUrl: update.properties.tarmac_pr_url }),
      });
    }
  },
});
