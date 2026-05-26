import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { CursorClient, CursorRunSnapshot } from "@tarmac/cursor-client";
import {
  buildOpenIssueIndex,
  confirmClaimOwnership,
  createClaimId,
  createClaimUpdate,
  decodeTarmacProperties,
  isEligible,
  SameProcessClaimSet,
  type IneligibilityReason,
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
  ClaimLostError,
  IssueIneligibleError,
  IssueNotFoundError,
  MissingRunMetadataError,
} from "./errors";
import type { FpClient, OrchestratorIssue } from "./fp-client";

export type ScanResult = {
  readonly eligible: readonly OrchestratorIssue[];
  readonly ineligible: readonly {
    readonly issue: OrchestratorIssue;
    readonly reason: IneligibilityReason;
  }[];
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
  readonly redaction?: PromptRedactionConfig;
  readonly cursorEnvVars?: Readonly<Record<string, string>>;
};

export class TarmacOrchestrator {
  readonly #fpClient: FpClient;
  readonly #cursorClient: CursorClient;
  readonly #repository: WorkerRepositoryContext;
  readonly #runnerId: string;
  readonly #claimSet: SameProcessClaimSet;
  readonly #redaction: PromptRedactionConfig | undefined;
  readonly #cursorEnvVars: Readonly<Record<string, string>> | undefined;

  constructor(options: OrchestratorOptions) {
    this.#fpClient = options.fpClient;
    this.#cursorClient = options.cursorClient;
    this.#repository = options.repository;
    this.#runnerId = options.runnerId ?? `tarmac-${process.pid}`;
    this.#claimSet = options.claimSet ?? new SameProcessClaimSet();
    this.#cursorEnvVars = options.cursorEnvVars;
    this.#redaction = mergeRedaction(options.redaction, options.cursorEnvVars);
  }

  async scan(): Promise<ScanResult> {
    const issues = await this.#fpClient.listIssues();
    const openIssueIndex = buildOpenIssueIndex(issues);
    const runningIssueIds = new Set<string>();
    const eligible: OrchestratorIssue[] = [];
    const ineligible: Array<{
      issue: OrchestratorIssue;
      reason: IneligibilityReason;
    }> = [];

    for (const issue of issues) {
      const result = isEligible(issue, openIssueIndex, runningIssueIds);
      if (result.kind === "eligible") {
        eligible.push(issue);
      } else {
        ineligible.push({
          issue,
          reason: result.reason,
        });
      }
    }

    return {
      eligible,
      ineligible,
    };
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
      throw new ClaimLostError({
        issueId: issue.id,
        reason: "same-process-claim-exists",
      });
    }

    try {
      const claimId = await this.#claimIssue(issue);
      const claimedIssue = await this.#fpClient.getIssue(issue.id);
      try {
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
        const cursorRun = await this.#cursorClient.dispatch({
          name: `${claimedIssue.displayId ?? claimedIssue.id}: ${claimedIssue.title}`,
          prompt,
          repository: {
            url: this.#repository.remoteUrl,
            startingRef: this.#repository.baseSha,
          },
          autoCreatePR: true,
          idempotencyKey: claimId,
          ...(this.#cursorEnvVars === undefined ? {} : { envVars: this.#cursorEnvVars }),
        });

        await this.#fpClient.updateIssue(
          claimedIssue.id,
          updateFromCursorRun(claimedIssue, cursorRun, this.#repository.baseSha),
        );

        return {
          issue: claimedIssue,
          claimId,
          prompt,
          cursorRun,
        };
      } catch (cause) {
        await this.#recordDispatchFailure(claimedIssue.id, cause);
        throw cause;
      }
    } finally {
      this.#claimSet.release(issue.id);
    }
  }

  async reconcile(issueId: string): Promise<ReconcileResult> {
    const issue = await this.#fpClient.getIssue(issueId);
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
    await this.#fpClient.updateIssue(
      issue.id,
      updateFromCursorRun(issue, cursorRun, this.#repository.baseSha),
    );

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
      const scan = await this.scan();
      for (const issue of scan.eligible) {
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

  async #claimIssue(issue: OrchestratorIssue): Promise<string> {
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

    return claimId;
  }

  async #recordDispatchFailure(issueId: string, cause: unknown): Promise<void> {
    const lastError = redactFailure(cause, this.#redaction);
    await this.#fpClient.updateIssue(issueId, {
      status: "in-progress",
      properties: {
        tarmac_state: "needs-attention",
        tarmac_last_error: lastError,
      },
    });
    await this.#fpClient.commentIssue(
      issueId,
      `Tarmac dispatch failed before Cursor handoff: ${lastError}`,
    );
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
    tarmac_agent_id: run.agentId,
    tarmac_run_id: run.runId,
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
