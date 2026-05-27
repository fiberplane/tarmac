import type { CursorRunSnapshot } from "@tarmac/cursor-client";

import type { CursorRunRef } from "./types";

const prNumberFromUrl = (prUrl: string | undefined): string | undefined => {
  if (prUrl === undefined) {
    return undefined;
  }

  const match = /\/pull\/(\d+)(?:$|[/?#])/u.exec(prUrl);
  return match?.[1];
};

export const toCursorRunRef = (run: CursorRunSnapshot): CursorRunRef => {
  const prNumber = prNumberFromUrl(run.prUrl);

  return {
    agentId: run.agentId,
    runId: run.runId,
    ...(run.branch === undefined ? {} : { branch: run.branch }),
    ...(run.prUrl === undefined ? {} : { prUrl: run.prUrl }),
    ...(prNumber === undefined ? {} : { prNumber }),
  };
};
