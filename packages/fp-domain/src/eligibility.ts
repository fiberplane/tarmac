import type { OpenIssueIndex, TarmacIssue } from "./models";
import { decodeTarmacProperties, type DecodeFailure } from "./properties";

export type IneligibilityReason =
  | {
      readonly kind: "not-todo";
      readonly status: string;
    }
  | {
      readonly kind: "not-ready";
    }
  | {
      readonly kind: "already-running";
    }
  | {
      readonly kind: "already-dispatched";
    }
  | {
      readonly kind: "blocked-by-dependency";
      readonly dependencyId: string;
    }
  | {
      readonly kind: "blocked-by-open-child";
      readonly childId: string;
    }
  | {
      readonly kind: "malformed-tarmac-properties";
      readonly failures: readonly DecodeFailure[];
    };

export type EligibleIssue = {
  readonly issue: TarmacIssue;
  readonly claimBasis: {
    readonly issueId: string;
    readonly displayId?: string;
  };
};

export type EligibilityResult =
  | {
      readonly kind: "eligible";
      readonly value: EligibleIssue;
    }
  | {
      readonly kind: "ineligible";
      readonly reason: IneligibilityReason;
    };

const OPEN_STATUSES = new Set(["todo", "in-progress"]);

export const buildOpenIssueIndex = (issues: readonly TarmacIssue[]): OpenIssueIndex => {
  const ids = new Set<string>();
  const childrenByParent = new Map<string, string[]>();

  for (const issue of issues) {
    if (!OPEN_STATUSES.has(issue.status)) {
      continue;
    }

    ids.add(issue.id);

    if (issue.parent === undefined) {
      continue;
    }

    const children = childrenByParent.get(issue.parent) ?? [];
    children.push(issue.id);
    childrenByParent.set(issue.parent, children);
  }

  return {
    ids,
    childrenByParent,
  };
};

export const isEligible = (
  issue: TarmacIssue,
  openIssueIndex: OpenIssueIndex,
  runningIssueIds: ReadonlySet<string> = new Set(),
): EligibilityResult => {
  const decoded = decodeTarmacProperties(issue.properties);
  if (decoded.kind === "invalid") {
    return {
      kind: "ineligible",
      reason: {
        kind: "malformed-tarmac-properties",
        failures: decoded.failures,
      },
    };
  }

  if (issue.status !== "todo") {
    return {
      kind: "ineligible",
      reason: {
        kind: "not-todo",
        status: issue.status,
      },
    };
  }

  if (decoded.properties.ready !== "true") {
    return {
      kind: "ineligible",
      reason: {
        kind: "not-ready",
      },
    };
  }

  if (runningIssueIds.has(issue.id)) {
    return {
      kind: "ineligible",
      reason: {
        kind: "already-running",
      },
    };
  }

  if (decoded.properties.agentId !== undefined || decoded.properties.runId !== undefined) {
    return {
      kind: "ineligible",
      reason: {
        kind: "already-dispatched",
      },
    };
  }

  for (const dependencyId of issue.dependencies) {
    if (openIssueIndex.ids.has(dependencyId)) {
      return {
        kind: "ineligible",
        reason: {
          kind: "blocked-by-dependency",
          dependencyId,
        },
      };
    }
  }

  const children = openIssueIndex.childrenByParent.get(issue.id) ?? [];
  const openChildId = children[0];
  if (openChildId !== undefined) {
    return {
      kind: "ineligible",
      reason: {
        kind: "blocked-by-open-child",
        childId: openChildId,
      },
    };
  }

  const claimBasis =
    issue.displayId === undefined
      ? {
          issueId: issue.id,
        }
      : {
          issueId: issue.id,
          displayId: issue.displayId,
        };

  return {
    kind: "eligible",
    value: {
      issue,
      claimBasis,
    },
  };
};
