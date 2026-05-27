import { inferCursorRunUrl } from "@tarmac/cursor-client";
import {
  buildOpenIssueIndex,
  decodeTarmacProperties,
  isEligible,
  type IneligibilityReason,
} from "@tarmac/fp-domain";
import type { PromptRedactionConfig } from "@tarmac/worker-prompt";

import { Schema } from "effect";

import type { FpClient, OrchestratorIssue } from "../fp-client";
import { LocalRunStore } from "../local-state";
import { PersistedOrchestratorEventSchema } from "../local-state/schemas";
import type { IssueRef, PersistedOrchestratorEvent } from "../local-state/types";
import type {
  BoutView,
  DashboardStatus,
  IssueTarmacView,
  IssueView,
  RunCardView,
  RunDispatchView,
  ScanView,
} from "./types";

export type BuildDashboardStatusOptions = {
  readonly stateRoot: string;
  readonly redaction?: PromptRedactionConfig;
  readonly fpClient?: FpClient;
  readonly runLimit?: number;
  readonly eventLimit?: number;
};

type DecodedPersistedEvent = Schema.Schema.Type<typeof PersistedOrchestratorEventSchema>;

const asPersistedEvents = (events: readonly DecodedPersistedEvent[]): PersistedOrchestratorEvent[] =>
  events as PersistedOrchestratorEvent[];

const issueRefKey = (issue: IssueRef): string => issue.displayId ?? issue.issueId;

const toIssueViewFromRef = (issue: IssueRef): IssueView => ({
  id: issue.issueId,
  ...(issue.displayId === undefined ? {} : { displayId: issue.displayId }),
});

const toTarmacView = (issue: OrchestratorIssue): IssueTarmacView | undefined => {
  const decoded = decodeTarmacProperties(issue.properties);
  if (decoded.kind !== "valid") {
    return undefined;
  }

  const props = decoded.properties;
  return {
    ready: props.ready,
    state: props.state,
    ...(props.agentId === undefined ? {} : { agentId: props.agentId }),
    ...(props.runId === undefined ? {} : { runId: props.runId }),
    ...(props.cursorUrl === undefined ? {} : { cursorUrl: props.cursorUrl }),
    ...(props.branch === undefined ? {} : { branch: props.branch }),
    ...(props.prUrl === undefined ? {} : { prUrl: props.prUrl }),
    ...(props.prNumber === undefined ? {} : { prNumber: props.prNumber }),
    ...(props.baseSha === undefined ? {} : { baseSha: props.baseSha }),
    ...(props.headSha === undefined ? {} : { headSha: props.headSha }),
    ...(props.lastError === undefined ? {} : { lastError: props.lastError }),
  };
};

const toIssueView = (issue: OrchestratorIssue, reason?: IneligibilityReason): IssueView => {
  const tarmac = toTarmacView(issue);
  return {
    id: issue.id,
    ...(issue.displayId === undefined ? {} : { displayId: issue.displayId }),
    title: issue.title,
    status: issue.status,
    ...(issue.parent === undefined ? {} : { parent: issue.parent }),
    dependencies: issue.dependencies,
    ...(tarmac === undefined ? {} : { tarmac }),
    eligibility:
      reason === undefined
        ? { kind: "eligible" }
        : {
            kind: "ineligible",
            reason,
          },
  };
};

const mergeIssueViews = (left: IssueView, right: IssueView): IssueView => {
  const displayId = left.displayId ?? right.displayId;
  const title = left.title ?? right.title;
  const status = left.status ?? right.status;
  const parent = left.parent ?? right.parent;
  const dependencies = left.dependencies ?? right.dependencies;
  const tarmac = left.tarmac ?? right.tarmac;
  const eligibility = left.eligibility ?? right.eligibility;

  return {
    id: left.id,
    ...(displayId === undefined ? {} : { displayId }),
    ...(title === undefined ? {} : { title }),
    ...(status === undefined ? {} : { status }),
    ...(parent === undefined ? {} : { parent }),
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(tarmac === undefined ? {} : { tarmac }),
    ...(eligibility === undefined ? {} : { eligibility }),
  };
};

const buildLiveScan = (issues: readonly OrchestratorIssue[]): ScanView => {
  const openIssueIndex = buildOpenIssueIndex(issues);
  const runningIssueIds = new Set<string>();
  const eligible: IssueView[] = [];
  const ineligible: Array<{ issue: IssueView; reason: IneligibilityReason }> = [];

  for (const issue of issues) {
    const result = isEligible(issue, openIssueIndex, runningIssueIds);
    if (result.kind === "eligible") {
      eligible.push(toIssueView(issue));
    } else {
      ineligible.push({
        issue: toIssueView(issue, result.reason),
        reason: result.reason,
      });
    }
  }

  return {
    source: "live",
    scannedAt: new Date().toISOString(),
    eligible,
    ineligible,
  };
};

const buildCachedScan = (events: readonly PersistedOrchestratorEvent[]): ScanView | undefined => {
  const scanFinished = [...events].reverse().find((event) => event.type === "scan.finished");
  if (scanFinished === undefined || scanFinished.type !== "scan.finished") {
    return undefined;
  }

  return {
    source: "cached",
    scannedAt: scanFinished.ts,
    eligible: scanFinished.eligible.map(toIssueViewFromRef),
    ineligible: scanFinished.ineligible.map((entry) => ({
      issue: toIssueViewFromRef(entry.issue),
      reason: { kind: entry.reason } as IneligibilityReason,
    })),
  };
};

const buildBouts = (issues: readonly IssueView[]): readonly BoutView[] => {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const childrenByParent = new Map<string, IssueView[]>();

  for (const issue of issues) {
    if (issue.parent === undefined) {
      continue;
    }

    const children = childrenByParent.get(issue.parent) ?? [];
    children.push(issue);
    childrenByParent.set(issue.parent, children);
  }

  return [...childrenByParent.entries()]
    .map(([parentId, children]) => {
      const parent = byId.get(parentId);
      if (parent === undefined) {
        return {
          parent: {
            id: parentId,
          },
          children,
        };
      }

      return { parent, children };
    })
    .sort((left, right) =>
      (left.parent.displayId ?? left.parent.id).localeCompare(
        right.parent.displayId ?? right.parent.id,
      ),
    );
};

const formatLogLine = (event: PersistedOrchestratorEvent): string => {
  const issueLabel =
    "issue" in event && event.issue !== undefined
      ? (event.issue.displayId ?? event.issue.issueId)
      : undefined;
  const prefix = `[${event.ts}] ${event.type}`;
  if (issueLabel === undefined) {
    return prefix;
  }

  if (event.type === "dispatch.failed") {
    return `${prefix} ${issueLabel} (${event.stage}): ${event.error}`;
  }

  if (event.type === "cursor.launch" || event.type === "metadata.persisted") {
    const url = event.cursorRun.prUrl ?? inferCursorRunUrl(event.cursorRun.agentId);
    return `${prefix} ${issueLabel} → ${url}`;
  }

  return `${prefix} ${issueLabel}`;
};

const buildDispatches = (events: readonly PersistedOrchestratorEvent[]): RunDispatchView[] => {
  const byIssue = new Map<string, RunDispatchView>();

  for (const event of events) {
    if (!("issue" in event) || event.issue === undefined) {
      continue;
    }

    const key = issueRefKey(event.issue);
    const existing = byIssue.get(key) ?? {
      issue: toIssueViewFromRef(event.issue),
    };

    let next: RunDispatchView = {
      ...existing,
      lastEventType: event.type,
      lastEventAt: event.ts,
    };

    if (event.type === "cursor.launch" || event.type === "metadata.persisted") {
      next = {
        ...next,
        issue: mergeIssueViews(next.issue, toIssueViewFromRef(event.issue)),
        ...(event.claimId === undefined ? {} : { claimId: event.claimId }),
        cursorUrl: inferCursorRunUrl(event.cursorRun.agentId),
        ...(event.cursorRun.branch === undefined
          ? next.branch === undefined
            ? {}
            : { branch: next.branch }
          : { branch: event.cursorRun.branch }),
        ...(event.cursorRun.prUrl === undefined
          ? next.prUrl === undefined
            ? {}
            : { prUrl: next.prUrl }
          : { prUrl: event.cursorRun.prUrl }),
        ...(event.cursorRun.prNumber === undefined
          ? next.prNumber === undefined
            ? {}
            : { prNumber: next.prNumber }
          : { prNumber: event.cursorRun.prNumber }),
      };
    }

    if (event.type === "terminal.result") {
      next = {
        ...next,
        cursorUrl: inferCursorRunUrl(event.cursorRun.agentId),
        ...(event.prUrl ?? event.cursorRun.prUrl
          ? { prUrl: event.prUrl ?? event.cursorRun.prUrl }
          : next.prUrl === undefined
            ? {}
            : { prUrl: next.prUrl }),
        ...(event.cursorRun.prNumber === undefined
          ? next.prNumber === undefined
            ? {}
            : { prNumber: next.prNumber }
          : { prNumber: event.cursorRun.prNumber }),
        ...(event.cursorRun.branch === undefined
          ? next.branch === undefined
            ? {}
            : { branch: next.branch }
          : { branch: event.cursorRun.branch }),
      };
    }

    if (event.type === "dispatch.failed") {
      next = {
        ...next,
        stage: event.stage,
        error: event.error,
      };
    }

    if (event.type === "reconcile.finished") {
      next = {
        ...next,
        cursorUrl: inferCursorRunUrl(event.cursorRun.agentId),
        ...(event.cursorRun.prUrl === undefined
          ? next.prUrl === undefined
            ? {}
            : { prUrl: next.prUrl }
          : { prUrl: event.cursorRun.prUrl }),
        ...(event.cursorRun.prNumber === undefined
          ? next.prNumber === undefined
            ? {}
            : { prNumber: next.prNumber }
          : { prNumber: event.cursorRun.prNumber }),
        ...(event.cursorRun.branch === undefined
          ? next.branch === undefined
            ? {}
            : { branch: next.branch }
          : { branch: event.cursorRun.branch }),
      };
    }

    byIssue.set(key, next);
  }

  return [...byIssue.values()];
};

const buildRunCard = async (
  store: LocalRunStore,
  run: Awaited<ReturnType<LocalRunStore["listRecentRuns"]>>[number],
  eventLimit: number,
): Promise<RunCardView> => {
  const { events, corruptLineCount } = await store.readRunEvents(run.eventsPath, eventLimit);
  const persistedEvents = asPersistedEvents(events);
  const excerpt = persistedEvents.slice(-Math.min(eventLimit, 20)).map(formatLogLine);

  return {
    runId: run.runId,
    command: run.command,
    status: run.status,
    startedAt: run.startedAt,
    ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
    runnerId: run.runnerId,
    ...(run.cursorMode === undefined ? {} : { cursorMode: run.cursorMode }),
    ...(run.summary === undefined ? {} : { summary: run.summary }),
    dispatches: buildDispatches(persistedEvents),
    logExcerpt: excerpt,
    ...(corruptLineCount === 0 ? {} : { corruptEventLineCount: corruptLineCount }),
  };
};

export const buildDashboardStatus = async (
  options: BuildDashboardStatusOptions,
): Promise<DashboardStatus> => {
  const runLimit = options.runLimit ?? 10;
  const eventLimit = options.eventLimit ?? 50;
  const store = new LocalRunStore({
    stateRoot: options.stateRoot,
    ...(options.redaction === undefined ? {} : { redaction: options.redaction }),
  });

  const runs = await store.listRecentRuns(runLimit);
  const runCards = await Promise.all(runs.map((run) => buildRunCard(store, run, eventLimit)));

  let scan: ScanView = {
    source: "unavailable",
    eligible: [],
    ineligible: [],
  };
  let issues: IssueView[] = [];

  if (options.fpClient !== undefined) {
    try {
      const fpIssues = await options.fpClient.listIssues();
      scan = buildLiveScan(fpIssues);
      issues = fpIssues.map((issue) => toIssueView(issue));
    } catch {
      scan = {
        source: "unavailable",
        eligible: [],
        ineligible: [],
      };
    }
  }

  if (scan.source === "unavailable") {
    const allEvents = (
      await Promise.all(
        runs.slice(0, 3).map((run) => store.readRunEvents(run.eventsPath, eventLimit)),
      )
    ).flatMap((result) => asPersistedEvents(result.events));

    const cached = buildCachedScan(allEvents);
    if (cached !== undefined) {
      scan = cached;
      issues = [...cached.eligible, ...cached.ineligible.map((entry) => entry.issue)];
    }
  }

  const issueMap = new Map<string, IssueView>();
  for (const issue of issues) {
    issueMap.set(issue.id, issue);
  }

  for (const run of runCards) {
    for (const dispatch of run.dispatches) {
      const existing = issueMap.get(dispatch.issue.id);
      issueMap.set(
        dispatch.issue.id,
        existing === undefined ? dispatch.issue : mergeIssueViews(existing, dispatch.issue),
      );
    }
  }

  const mergedIssues = [...issueMap.values()].sort((left, right) =>
    (left.displayId ?? left.id).localeCompare(right.displayId ?? right.id),
  );

  return {
    generatedAt: new Date().toISOString(),
    stateRoot: options.stateRoot,
    ...(runs[0] === undefined ? {} : { repository: runs[0].repository }),
    scan,
    bouts: buildBouts(mergedIssues),
    issues: mergedIssues,
    runs: runCards,
  };
};
