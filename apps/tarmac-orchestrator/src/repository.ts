import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { WorkerRepositoryContext } from "@tarmac/worker-prompt";

import { GitCommandError } from "./errors";

const execFileAsync = promisify(execFile);

const stderrFromCause = (cause: unknown): string | undefined => {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "stderr" in cause &&
    typeof cause.stderr === "string"
  ) {
    return cause.stderr;
  }

  return undefined;
};

const runGit = async (args: readonly string[], cwd: string): Promise<string> => {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim();
  } catch (cause) {
    const stderr = stderrFromCause(cause);
    throw new GitCommandError({
      args,
      ...(stderr === undefined ? {} : { stderr }),
      cause,
    });
  }
};

export const readRepositoryContext = async (
  cwd: string = process.cwd(),
): Promise<WorkerRepositoryContext> => ({
  remoteUrl: await runGit(["remote", "get-url", "origin"], cwd),
  baseBranch: await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
  baseSha: await runGit(["rev-parse", "HEAD"], cwd),
});
