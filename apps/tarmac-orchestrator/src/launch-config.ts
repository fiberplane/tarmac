import type { PromptRedactionConfig } from "@tarmac/worker-prompt";

import { MissingCursorWorkerEnvError } from "./errors";

export type CursorMode = "fake" | "real";

export const REQUIRED_CURSOR_WORKER_FP_ENV = [
  "FP_TOKEN",
  "FP_WORKSPACE",
  "FP_PROJECT_ID",
  "FP_SERVER_URL",
] as const;

const HOST_SECRET_NAMES: readonly string[] = [
  "CURSOR_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_PAT",
];

export type CursorWorkerEnv = Readonly<Record<string, string>>;

export const parseCursorMode = (mode: string | undefined): CursorMode | undefined => {
  if (mode === undefined || mode === "fake") {
    return "fake";
  }
  if (mode === "real") {
    return "real";
  }

  return undefined;
};

export const buildCursorWorkerEnv = (
  mode: CursorMode,
  env: NodeJS.ProcessEnv = process.env,
): CursorWorkerEnv | undefined => {
  if (mode === "fake") {
    return undefined;
  }

  const missing = REQUIRED_CURSOR_WORKER_FP_ENV.filter((name) => {
    const value = env[name]?.trim();
    return value === undefined || value === "";
  });

  if (missing.length > 0) {
    throw new MissingCursorWorkerEnvError({
      names: missing,
    });
  }

  const workerEnv: Record<string, string> = {
    FP_REMOTE: "rest-api",
  };

  for (const name of REQUIRED_CURSOR_WORKER_FP_ENV) {
    const value = env[name]?.trim();
    if (value !== undefined && value !== "") {
      workerEnv[name] = value;
    }
  }

  const projectPrefix = env.FP_PROJECT_PREFIX?.trim();
  if (projectPrefix !== undefined && projectPrefix !== "") {
    workerEnv.FP_PROJECT_PREFIX = projectPrefix;
  }

  return workerEnv;
};

export const buildHostSecretRedaction = (
  env: NodeJS.ProcessEnv = process.env,
): PromptRedactionConfig => ({
  secrets: HOST_SECRET_NAMES.flatMap((name) => {
    const value = env[name]?.trim();
    return value === undefined || value === ""
      ? [
          {
            name,
          },
        ]
      : [
          {
            name,
            value,
          },
        ];
  }),
});
