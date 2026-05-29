import type { IssueQueueGroupView, IssueView, ScanView } from "./types";

export type IssueQueueGroupId =
  | "active"
  | "needs-attention"
  | "eligible"
  | "blocked"
  | "done"
  | "unknown";

const GROUP_ORDER: readonly IssueQueueGroupId[] = [
  "active",
  "needs-attention",
  "eligible",
  "blocked",
  "done",
  "unknown",
];

const GROUP_LABELS: Record<IssueQueueGroupId, string> = {
  active: "Active",
  "needs-attention": "Needs attention",
  eligible: "Eligible",
  blocked: "Blocked / ineligible",
  done: "Done",
  unknown: "Unknown",
};

const classifyIssue = (
  issue: IssueView,
  eligibleIds: ReadonlySet<string>,
  ineligibleIds: ReadonlySet<string>,
): IssueQueueGroupId => {
  const state = issue.tarmac?.state;
  if (state === "active") {
    return "active";
  }
  if (state === "needs-attention") {
    return "needs-attention";
  }
  if (issue.status === "done" || state === "end") {
    return "done";
  }
  if (eligibleIds.has(issue.id)) {
    return "eligible";
  }
  if (ineligibleIds.has(issue.id)) {
    return "blocked";
  }
  return "unknown";
};

export const buildIssueQueue = (
  issues: readonly IssueView[],
  scan: ScanView,
): readonly IssueQueueGroupView[] => {
  const eligibleIds = new Set(scan.eligible.map((issue) => issue.id));
  const ineligibleIds = new Set(scan.ineligible.map((entry) => entry.issue.id));
  const buckets = new Map<IssueQueueGroupId, IssueView[]>();

  for (const issue of issues) {
    const group = classifyIssue(issue, eligibleIds, ineligibleIds);
    const bucket = buckets.get(group) ?? [];
    bucket.push(issue);
    buckets.set(group, bucket);
  }

  return GROUP_ORDER.flatMap((groupId) => {
    const groupIssues = buckets.get(groupId);
    if (groupIssues === undefined || groupIssues.length === 0) {
      return [];
    }

    return [
      {
        id: groupId,
        label: GROUP_LABELS[groupId],
        issues: [...groupIssues].sort((left, right) =>
          (left.displayId ?? left.id).localeCompare(right.displayId ?? right.id),
        ),
      },
    ];
  });
};
