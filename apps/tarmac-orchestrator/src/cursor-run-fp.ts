import { inferCursorRunUrl } from "@tarmac/cursor-client";
import type { CursorRunSnapshot } from "@tarmac/cursor-client";

import type { OrchestratorIssue } from "./fp-client";

export const cursorRunUrlFor = (run: CursorRunSnapshot): string => inferCursorRunUrl(run.agentId);

export const issueCommentsIncludeUrl = (issue: OrchestratorIssue, url: string): boolean =>
  issue.comments.some((comment) => comment.body.includes(url));

export const formatLaunchCursorRunComment = (cursorUrl: string): string =>
  `Tarmac launched a Cursor Cloud run: ${cursorUrl}`;

export const formatTerminalReconcileComment = (
  cursorUrl: string,
  prUrl: string | undefined,
): string => {
  if (prUrl === undefined) {
    return `Cursor run finished. Run: ${cursorUrl}`;
  }

  return `Cursor run finished. Run: ${cursorUrl}. PR: ${prUrl}`;
};
