import type { OrchestratorIssue } from "../fp-client";
import type { IssueRef } from "./types";

export const toIssueRef = (issue: OrchestratorIssue): IssueRef => ({
  issueId: issue.id,
  ...(issue.displayId === undefined ? {} : { displayId: issue.displayId }),
});
