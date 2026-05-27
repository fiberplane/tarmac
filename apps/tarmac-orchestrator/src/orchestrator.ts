import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { CursorClient, CursorRunSnapshot } from "@tarmac/cursor-client";
import {
  buildActiveRunSnapshot,
  buildOpenIssueIndex,
  confirmClaimOwnership,
  createClaimId,
  createClaimUpdate,
  decodeTarmacProperties,
  isEligible,
  partitionByCapacity,
  rollupParentBouts,
  SameProcessClaimSet,
  type IneligibilityReason,
  type ParentBoutRollup,
  type TarmacIssueUpdate,
  type TarmacPropertyKey,
} from "@tarmac/fp-domain";
import {
  renderWorkerPrompt,
  redactSensitiveText,
  type PromptRedactionConfig,
  type WorkerRepositoryContext,
} from "@tarmac/worker-prompt";

import {
  cursorRunUrlFor,
  formatLaunchCursorRunComment,
  formatTerminalReconcileComment,
  issueCommentsIncludeText,
} from "./cursor-run-fp";
import {
  ClaimLostError,
  IssueIneligibleError,
  IssueNotFoundError,
  MissingRunMetadataError,
} from "./errors";
import type { FpClient, OrchestratorIssue } from "./fp-client";
import type { OrchestratorObserver } from "./local-state/observer";

export type ScanResult = {
  readonly eligible: readonly OrchestratorIssue[];
  readonly ineligible: readonly {
    readonly issue: OrchestratorIssue;
    readonly reason: IneligibilityReason;
  }[];
  readonly activeRunCount: number;
  readonly maxConcurrentRuns: number;
  readonly parentRollups: readonly ParentBoutRollup[];
};

export type DispatchResult = {
  readonly issue: OrchestratorIssue;
  readonly claimId: string;
  readonly prompt: string;
  readonly cursorRun: CursorRunSnapshot;
};

export type ReconcileResult = {
  readonly issue: OrchestratorIssue;
  readonly cursorRun: CursorRunSnapshot;
};

export type WatchResult = {
  readonly iterations: number;
  readonly dispatched: readonly DispatchResult[];
};

export type OrchestratorOptions = {
  readonly fpClient: FpClient;
  readonly cursorClient: CursorClient;
  readonly repository: WorkerRepositoryContext;
  readonly runnerId?: string;
  readonly claimSet?: SameProcessClaimSet;
  readonly maxConcurrentRuns?: number;
  readonly redaction?: PromptRedactionConfig;
  readonly cursorEnvVars?: Readonly<Record<string, string>>;
  readonly observer?: OrchestratorObserver;
};

export class TarmacOrchestrator {
  readonly #fpClient: FpClient;
  readonly #cursorClient: CursorClient;
  readonly #repository: WorkerRepositoryContext;
  readonly #runnerId: string;
  readonly #claimSet: SameProcessClaimSet;
  readonly #maxConcurrentRuns: number;
  readonly #redaction: PromptRedactionConfig | undefined;
  readonly #cursorEnvVars: Readonly<Record<string, string>> | undefined;
  readonly #observer: OrchestratorObserver | undefined;

  constructor(options: OrchestratorOptions) {
    this.#fpClient = options.fpClient;
    this.#cursorClient = options.cursorClient;
    this.#repository = options.repository;
    this.#runnerId = options.runnerId ?? `tarmac-${process.pid}`;
    this.#claimSet = options.claimSet ?? new SameProcessClaimSet();
    this.#maxConcurrentRuns = options.maxConcurrentRuns ?? 1;
    this.#cursorEnvVars = options.cursorEnvVars;
    this.#redaction = mergeRedaction(options.redaction, options.cursorEnvVars);
    this.#observer = options.observer;
  }

  async scan(): Promise<ScanResult> {
    await this.#observer?.onScanStarted?.();
    const issues = await this.#fpClient.listIssues();
    const openIssueIndex = buildOpenIssueIndex(issues);
    const activeRuns = buildActiveRunSnapshot(issues, this.#claimSet);
    const runningIssueIds = new Set(activeRuns.issueIds);
    const capacityEligible: OrchestratorIssue[] = [];
    const ineligible: Array<{
      issue: OrchestratorIssue;
      reason: IneligibilityReason;
    }> = [];

    for (const issue of issues) {
      const result = isEligible(issue, openIssueIndex, runningIssueIds);
      if (result.kind === "eligible") {
        capacityEligible.push(issue);
      } else {
        ineligible.push({
          issue,
          reason: result.reason,
        });
      }
    }

    const { dispatchable, deferred } = partitionByCapacity(
      capacityEligible,
      activeRuns.count,
      this.#maxConcurrentRuns,
    );

    for (const issue of deferred) {
      ineligible.push({
        issue,
        reason: {
          kind: "blocked-by-capacity",
          activeRunCount: activeRuns.count,
          maxConcurrentRuns: this.#maxConcurrentRuns,
        },
      });
    }

    const result = {
      eligible: dispatchable,
      ineligible,
      activeRunCount: activeRuns.count,
      maxConcurrentRuns: this.#maxConcurrentRuns,
      parentRollups: rollupParentBouts(issues),
    };
    await this.#observer?.onScanFinished?.(result);
    return result;
  }

  async runOne(issueId: string): Promise<DispatchResult> {
    const issues = await this.#fpClient.listIssues();
    const issue = findIssue(issues, issueId);
    if (issue === undefined) {
      throw new IssueNotFoundError({
        issueId,
      });
    }

    const eligibility = isEligible(issue, buildOpenIssueIndex(issues));
    if (eligibility.kind === "ineligible") {
      throw new IssueIneligibleError({
        issueId,
        reason: eligibility.reason,
      });
    }

    if (!this.#claimSet.acquire(issue.id)) {
      const reason = "same-process-claim-exists";
      await this.#observer?.onClaimLost?.(issue, reason);
      throw new ClaimLostError({
        issueId: issue.id,
        reason,
      });
    }

    try {
      await this.#observer?.onClaimAttempt?.(issue);
      const claim = await this.#claimIssue(issue);
      const claimId = claim.claimId;
      await this.#observer?.onClaimSuccess?.(issue, claimId, claim.attempt);
      const claimedIssue = await this.#fpClient.getIssue(issue.id);
      const prompt = renderWorkerPrompt({
        issue: {
          id: claimedIssue.id,
          ...(claimedIssue.displayId === undefined ? {} : { displayId: claimedIssue.displayId }),
          title: claimedIssue.title,
          ...(claimedIssue.description === undefined
            ? {}
            : { description: claimedIssue.description }),
          comments: claimedIssue.comments,
        },
        repository: this.#repository,
        ...(this.#redaction === undefined ? {} : { redaction: this.#redaction }),
      });

      let cursorRun: CursorRunSnapshot;
      try {
        cursorRun = await this.#cursorClient.dispatch({
          name: `${claimedIssue.displayId ?? claimedIssue.id}: ${claimedIssue.title}`,
          prompt,
          repository: {
            url: this.#repository.remoteUrl,
            startingRef: this.#repository.baseBranch,
          },
          autoCreatePR: true,
          idempotencyKey: claimId,
          ...(this.#cursorEnvVars === undefined ? {} : { envVars: this.#cursorEnvVars }),
        });
        await this.#observer?.onCursorLaunch?.(claimedIssue, claimId, cursorRun);
      } catch (cause) {
        await this.#recordDispatchFailure(claimedIssue, cause, "pre-launch");
        throw cause;
      }

      try {
        const update = updateFromCursorRun(claimedIssue, cursorRun, this.#repository.baseSha);
        await this.#fpClient.updateIssue(claimedIssue.id, update);
        await this.#observer?.onMetadataPersisted?.(claimedIssue, update, claimId, cursorRun);
        await this.#maybeCommentCursorRunLaunch(claimedIssue, cursorRun);
        return {
          issue: claimedIssue,
          claimId,
          prompt,
          cursorRun,
        };
      } catch (cause) {
        await this.#recordPostLaunchPersistenceFailure(claimedIssue, cursorRun, cause);
        throw cause;
      }
    } catch (cause) {
      if (cause instanceof ClaimLostError) {
        await this.#observer?.onClaimLost?.(issue, cause.reason);
      }
      throw cause;
    } finally {
      this.#claimSet.release(issue.id);
    }
  }

  async reconcile(issueId: string): Promise<ReconcileResult> {
    const issue = await this.#fpClient.getIssue(issueId);
    await this.#observer?.onReconcileStarted?.(issue);
    const decoded = decodeTarmacProperties(issue.properties);
    if (decoded.kind === "invalid") {
      throw new MissingRunMetadataError({
        issueId,
      });
    }

    const agentId = decoded.properties.agentId;
    const runId = decoded.properties.runId;
    if (agentId === undefined || runId === undefined) {
      throw new MissingRunMetadataError({
        issueId,
      });
    }

    const cursorRun = await this.#cursorClient.getRun({
      agentId,
      runId,
    });
    const update = updateFromCursorRun(issue, cursorRun, this.#repository.baseSha);
    await this.#fpClient.updateIssue(issue.id, update);
    await this.#observer?.onReconcileFinished?.(
      {
        issue,
        cursorRun,
      },
      update,
    );
    await this.#maybeCommentTerminalReconcile(issue, cursorRun, update);

    return {
      issue,
      cursorRun,
    };
  }

  async watch(
    options: {
      readonly pollIntervalMs?: number;
      readonly maxIterations?: number;
    } = {},
  ): Promise<WatchResult> {
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY;
    const dispatched: DispatchResult[] = [];
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations += 1;
      await this.#observer?.onWatchIteration?.(iterations);
      const scan = await this.scan();
      for (const issue of scan.eligible) {
        const activeRuns = buildActiveRunSnapshot(
          await this.#fpClient.listIssues(),
          this.#claimSet,
        );
        if (activeRuns.count >= this.#maxConcurrentRuns) {
          break;
        }

        dispatched.push(await this.runOne(issue.displayId ?? issue.id));
      }

      if (iterations >= maxIterations) {
        break;
      }

      await sleep(pollIntervalMs);
    }

    return {
      iterations,
      dispatched,
    };
  }

  async #claimIssue(
    issue: OrchestratorIssue,
  ): Promise<{ readonly claimId: string; readonly attempt: number }> {
    const decoded = decodeTarmacProperties(issue.properties);
    const previousAttempt =
      decoded.kind === "valid" ? Number.parseInt(decoded.properties.attempt ?? "0", 10) : 0;
    const attempt = Number.isFinite(previousAttempt) ? previousAttempt + 1 : 1;
    const draft = {
      runnerId: this.#runnerId,
      attempt,
      claimId: randomUUID(),
    };
    const claimId = createClaimId(draft);

    await this.#fpClient.updateIssue(issue.id, createClaimUpdate(draft));

    const claimedIssue = await this.#fpClient.getIssue(issue.id);
    const confirmation = confirmClaimOwnership(claimedIssue, claimId);
    if (confirmation.kind === "lost") {
      throw new ClaimLostError({
        issueId: issue.id,
        reason: confirmation.reason,
      });
    }

    return {
      claimId,
      attempt,
    };
  }

  async #recordDispatchFailure(
    issue: OrchestratorIssue,
    cause: unknown,
    stage: "pre-launch" | "post-launch",
  ): Promise<void> {
    const lastError = redactFailure(cause, this.#redaction);
    await this.#observer?.onDispatchFailed?.(issue, stage, lastError);
    await this.#fpClient.updateIssue(issue.id, {
      status: "in-progress",
      properties: {
        tarmac_state: "needs-attention",
        tarmac_last_error: lastError,
      },
    });
    await this.#fpClient.commentIssue(
      issue.id,
      `Tarmac dispatch failed before Cursor handoff: ${lastError}`,
    );
  }

  async #recordPostLaunchPersistenceFailure(
    issue: OrchestratorIssue,
    run: CursorRunSnapshot,
    cause: unknown,
  ): Promise<void> {
    const lastError = `Cursor launched but FP metadata persistence failed: ${redactFailure(
      cause,
      this.#redaction,
    )}`;
    await this.#observer?.onDispatchFailed?.(issue, "post-launch", lastError);
    await this.#fpClient.updateIssue(issue.id, {
      status: "in-progress",
      properties: postLaunchFailureProperties(run, this.#repository.baseSha, lastError),
    });
    const cursorUrl = cursorRunUrlFor(run);
    await this.#fpClient.commentIssue(
      issue.id,
      `Cursor launched (${cursorUrl}), but Tarmac failed to persist terminal metadata. Run metadata was recorded for reconciliation: ${lastError}`,
    );
  }

  async #maybeCommentCursorRunLaunch(
    issue: OrchestratorIssue,
    run: CursorRunSnapshot,
  ): Promise<void> {
    const cursorUrl = cursorRunUrlFor(run);
    const comment = formatLaunchCursorRunComment(cursorUrl);
    if (issueCommentsIncludeText(issue, comment)) {
      return;
    }

    await this.#fpClient.commentIssue(issue.id, comment);
  }

  async #maybeCommentTerminalReconcile(
    issue: OrchestratorIssue,
    run: CursorRunSnapshot,
    update: TarmacIssueUpdate,
  ): Promise<void> {
    if (update.properties.tarmac_state !== "end") {
      return;
    }

    const cursorUrl = cursorRunUrlFor(run);
    const prUrl = update.properties.tarmac_pr_url ?? run.prUrl;
    const comment = formatTerminalReconcileComment(cursorUrl, prUrl);
    if (issueCommentsIncludeText(issue, comment)) {
      return;
    }

    await this.#fpClient.commentIssue(issue.id, comment);
  }
}

const findIssue = (
  issues: readonly OrchestratorIssue[],
  issueId: string,
): OrchestratorIssue | undefined =>
  issues.find((issue) => {
    const displayId = issue.displayId;
    return (
      issue.id === issueId ||
      issue.id.startsWith(issueId) ||
      displayId === issueId ||
      displayId === `TARM-${issueId}`
    );
  });

export const updateFromCursorRun = (
  issue: OrchestratorIssue,
  run: CursorRunSnapshot,
  baseSha: string,
): TarmacIssueUpdate => {
  const decoded = decodeTarmacProperties(issue.properties);
  const existingPrUrl = decoded.kind === "valid" ? decoded.properties.prUrl : undefined;
  const hasPrEvidence = run.prUrl !== undefined || existingPrUrl !== undefined;
  const finishedWithPr = run.status === "finished" && hasPrEvidence;
  const finishedWithoutPr = run.status === "finished" && !hasPrEvidence;
  const needsAttention = run.status === "error" || run.status === "cancelled" || finishedWithoutPr;
  const properties: Partial<Record<TarmacPropertyKey, string>> = {
    ...cursorRunIdentityProperties(run),
    tarmac_base_sha: baseSha,
    tarmac_state: finishedWithPr ? "end" : needsAttention ? "needs-attention" : "active",
  };

  if (run.branch !== undefined) {
    properties.tarmac_branch = run.branch;
  }
  if (run.prUrl !== undefined) {
    properties.tarmac_pr_url = run.prUrl;
  }
  if (finishedWithoutPr) {
    properties.tarmac_last_error = "Cursor run finished without PR metadata.";
  }
  if (run.status === "error" || run.status === "cancelled") {
    properties.tarmac_last_error = `Cursor run ended with status ${run.status}.`;
  }

  return {
    status: finishedWithPr ? "done" : "in-progress",
    properties,
  };
};

const postLaunchFailureProperties = (
  run: CursorRunSnapshot,
  baseSha: string,
  lastError: string,
): Partial<Record<TarmacPropertyKey, string>> => {
  const properties: Partial<Record<TarmacPropertyKey, string>> = {
    ...cursorRunIdentityProperties(run),
    tarmac_base_sha: baseSha,
    tarmac_state: "needs-attention",
    tarmac_last_error: lastError,
  };

  if (run.branch !== undefined) {
    properties.tarmac_branch = run.branch;
  }
  if (run.prUrl !== undefined) {
    properties.tarmac_pr_url = run.prUrl;
  }

  return properties;
};

const cursorRunIdentityProperties = (
  run: CursorRunSnapshot,
): Partial<Record<TarmacPropertyKey, string>> => ({
  tarmac_agent_id: run.agentId,
  tarmac_run_id: run.runId,
  tarmac_cursor_url: cursorRunUrlFor(run),
});

const redactFailure = (cause: unknown, redaction: PromptRedactionConfig | undefined): string => {
  const rawMessage = cause instanceof Error ? cause.message : String(cause);
  const redacted = redactSensitiveText(rawMessage, redaction);
  return redacted.length > 500 ? `${redacted.slice(0, 497)}...` : redacted;
};

const mergeRedaction = (
  redaction: PromptRedactionConfig | undefined,
  envVars: Readonly<Record<string, string>> | undefined,
): PromptRedactionConfig | undefined => {
  if (envVars === undefined) {
    return redaction;
  }

  const envSecrets = Object.entries(envVars).map(([name, value]) => ({
    name,
    value,
  }));

  return {
    forbiddenTerms: [...(redaction?.forbiddenTerms ?? []), ...Object.keys(envVars)],
    secrets: [...(redaction?.secrets ?? []), ...envSecrets],
  };
};
