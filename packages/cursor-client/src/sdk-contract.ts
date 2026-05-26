import type { AgentOptions, GetRunOptions, Run, SDKAgent } from "@cursor/sdk";

export const cloudCreateOptionsContract = {
  apiKey: "contract-key",
  name: "Tarmac contract",
  model: {
    id: "composer-2",
  },
  cloud: {
    repos: [
      {
        url: "https://github.com/fiberplane/tarmac.git",
        startingRef: "main",
      },
    ],
    autoCreatePR: true,
    envVars: {
      FP_REMOTE: "rest-api",
    },
  },
} satisfies AgentOptions;

export const cloudGetRunOptionsContract = {
  runtime: "cloud",
  agentId: "bc-00000000-0000-4000-8000-000000000001",
  apiKey: "contract-key",
} satisfies GetRunOptions;

export type CursorAgentNamespaceContract = {
  readonly create: (options: AgentOptions) => Promise<SDKAgent>;
  readonly getRun: (runId: string, options: GetRunOptions) => Promise<Run>;
};
