import type { SameProcessClaimSet } from "./claim";
import type { TarmacIssue } from "./models";
import { decodeTarmacProperties } from "./properties";

export const DEFAULT_MAX_CONCURRENT_RUNS = 1;

export type ParentBoutRollup = {
  readonly parentId: string;
  readonly parentDisplayId?: string;
  readonly openChildCount: number;
  readonly doneChildCount: number;
  readonly activeChildRunCount: number;
  readonly dispatchBlockedByOpenChildren: boolean;
};

export type ActiveRunSnapshot = {
  readonly issueIds: ReadonlySet<string>;
  readonly count: number;
};

export const parseMaxConcurrentRuns = (value: string | undefined): number => {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_MAX_CONCURRENT_RUNS;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_CONCURRENT_RUNS;
  }

  return parsed;
};

export const hasFpActiveCursorRun = (issue: TarmacIssue): boolean => {
  const decoded = decodeTarmacProperties(issue.properties);
  if (decoded.kind === "invalid") {
    return false;
  }

  const hasRunIdentity =
    decoded.properties.agentId !== undefined || decoded.properties.runId !== undefined;
  if (!hasRunIdentity) {
    return false;
  }

  if (issue.status === "done" || issue.status === "cancelled") {
    return false;
  }

  if (decoded.properties.state === "end") {
    return false;
  }

  return true;
};

export const collectFpActiveRunIssueIds = (issues: readonly TarmacIssue[]): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const issue of issues) {
    if (hasFpActiveCursorRun(issue)) {
      ids.add(issue.id);
    }
  }

  return ids;
};

export const buildActiveRunSnapshot = (
  issues: readonly TarmacIssue[],
  claimSet: Pick<SameProcessClaimSet, "activeIssueIds">,
): ActiveRunSnapshot => {
  const issueIds = new Set(collectFpActiveRunIssueIds(issues));
  for (const issueId of claimSet.activeIssueIds()) {
    issueIds.add(issueId);
  }

  return {
    issueIds,
    count: issueIds.size,
  };
};

const dispatchSortKey = (issue: TarmacIssue): string => issue.displayId ?? issue.id;

export const compareDispatchOrder = (left: TarmacIssue, right: TarmacIssue): number =>
  dispatchSortKey(left).localeCompare(dispatchSortKey(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });

export const sortForDispatch = <T extends TarmacIssue>(issues: readonly T[]): T[] =>
  [...issues].sort(compareDispatchOrder);

export const partitionByCapacity = <T extends TarmacIssue>(
  eligible: readonly T[],
  activeRunCount: number,
  maxConcurrentRuns: number,
): {
  readonly dispatchable: readonly T[];
  readonly deferred: readonly T[];
} => {
  const availableSlots = Math.max(0, maxConcurrentRuns - activeRunCount);
  const ordered = sortForDispatch(eligible);
  return {
    dispatchable: ordered.slice(0, availableSlots),
    deferred: ordered.slice(availableSlots),
  };
};

const TERMINAL_CHILD_STATUSES = new Set(["done", "cancelled"]);

export const rollupParentBouts = (issues: readonly TarmacIssue[]): readonly ParentBoutRollup[] => {
  const issuesById = new Map(issues.map((issue) => [issue.id, issue]));
  const childrenByParent = new Map<string, TarmacIssue[]>();

  for (const issue of issues) {
    if (issue.parent === undefined) {
      continue;
    }

    const children = childrenByParent.get(issue.parent) ?? [];
    children.push(issue);
    childrenByParent.set(issue.parent, children);
  }

  const rollups: ParentBoutRollup[] = [];
  for (const [parentId, children] of childrenByParent) {
    const parent = issuesById.get(parentId);
    let openChildCount = 0;
    let doneChildCount = 0;
    let activeChildRunCount = 0;

    for (const child of children) {
      if (TERMINAL_CHILD_STATUSES.has(child.status)) {
        doneChildCount += 1;
      } else {
        openChildCount += 1;
      }

      if (hasFpActiveCursorRun(child)) {
        activeChildRunCount += 1;
      }
    }

    rollups.push({
      parentId,
      ...(parent?.displayId === undefined ? {} : { parentDisplayId: parent.displayId }),
      openChildCount,
      doneChildCount,
      activeChildRunCount,
      dispatchBlockedByOpenChildren: openChildCount > 0,
    });
  }

  return rollups.sort((left, right) =>
    (left.parentDisplayId ?? left.parentId).localeCompare(
      right.parentDisplayId ?? right.parentId,
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    ),
  );
};
