import type { RunStatus } from "@cursor/sdk";

export type CursorRepository = {
  readonly url: string;
  readonly startingRef?: string;
};

export type CursorDispatchRequest = {
  readonly name: string;
  readonly prompt: string;
  readonly repository: CursorRepository;
  readonly apiKey?: string;
  readonly modelId?: string;
  readonly autoCreatePR?: boolean;
  readonly idempotencyKey?: string;
  readonly envVars?: Readonly<Record<string, string>>;
};

export type CursorRunReference = {
  readonly agentId: string;
  readonly runId: string;
  readonly apiKey?: string;
};

export type CursorGitBranch = {
  readonly repoUrl: string;
  readonly branch?: string;
  readonly prUrl?: string;
};

export type CursorRunSnapshot = {
  readonly agentId: string;
  readonly runId: string;
  readonly status: RunStatus;
  readonly branches: readonly CursorGitBranch[];
  readonly result?: string;
  readonly durationMs?: number;
  readonly repoUrl?: string;
  readonly branch?: string;
  readonly prUrl?: string;
};

export interface CursorClient {
  dispatch(request: CursorDispatchRequest): Promise<CursorRunSnapshot>;
  getRun(reference: CursorRunReference): Promise<CursorRunSnapshot>;
}
