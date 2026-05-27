import { DEFAULT_MAX_CONCURRENT_RUNS, parseMaxConcurrentRuns } from "@tarmac/fp-domain";

export type DispatchCapacityConfig = {
  readonly maxConcurrentRuns: number;
};

export const readDispatchCapacityConfig = (
  env: NodeJS.ProcessEnv = process.env,
  cliMaxConcurrentRuns: string | undefined = undefined,
): DispatchCapacityConfig => {
  const fromCli = cliMaxConcurrentRuns?.trim();
  if (fromCli !== undefined && fromCli !== "") {
    return {
      maxConcurrentRuns: parseMaxConcurrentRuns(fromCli),
    };
  }

  return {
    maxConcurrentRuns: parseMaxConcurrentRuns(env.TARMAC_MAX_CONCURRENT_RUNS),
  };
};

export const dispatchCapacityConfigHelp = (): string =>
  `Global Cursor run cap (default ${DEFAULT_MAX_CONCURRENT_RUNS}). Set TARMAC_MAX_CONCURRENT_RUNS or pass --max-concurrent-runs. Per-bout caps may be added later.`;
