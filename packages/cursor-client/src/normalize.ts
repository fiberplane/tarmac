import type { Run, RunResult } from "@cursor/sdk";

import type { CursorGitBranch, CursorRunSnapshot } from "./types";

type RunGitBranchInfo = NonNullable<Run["git"]>["branches"][number];

const normalizeBranches = (
  branches: readonly RunGitBranchInfo[] | undefined,
): readonly CursorGitBranch[] =>
  (branches ?? []).map((branch) => ({
    repoUrl: branch.repoUrl,
    ...(branch.branch === undefined ? {} : { branch: branch.branch }),
    ...(branch.prUrl === undefined ? {} : { prUrl: branch.prUrl }),
  }));

const withFirstBranch = (
  snapshot: Omit<CursorRunSnapshot, "repoUrl" | "branch" | "prUrl">,
): CursorRunSnapshot => {
  const firstBranch = snapshot.branches[0];
  if (firstBranch === undefined) {
    return snapshot;
  }

  return {
    ...snapshot,
    repoUrl: firstBranch.repoUrl,
    ...(firstBranch.branch === undefined ? {} : { branch: firstBranch.branch }),
    ...(firstBranch.prUrl === undefined ? {} : { prUrl: firstBranch.prUrl }),
  };
};

export const normalizeRun = (run: Run): CursorRunSnapshot =>
  withFirstBranch({
    agentId: run.agentId,
    runId: run.id,
    status: run.status,
    branches: normalizeBranches(run.git?.branches),
    ...(run.result === undefined ? {} : { result: run.result }),
    ...(run.durationMs === undefined ? {} : { durationMs: run.durationMs }),
  });

export const normalizeRunResult = (agentId: string, result: RunResult): CursorRunSnapshot =>
  withFirstBranch({
    agentId,
    runId: result.id,
    status: result.status,
    branches: normalizeBranches(result.git?.branches),
    ...(result.result === undefined ? {} : { result: result.result }),
    ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
  });
