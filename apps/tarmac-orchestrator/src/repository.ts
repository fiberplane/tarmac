import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { WorkerRepositoryContext } from "@tarmac/worker-prompt";

import {
  GitCommandError,
  RemoteRefNotFoundError,
  UncommittedLaunchFilesError,
  UnpushedBaseError,
} from "./errors";

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

export type RepositoryContextOptions = {
  readonly baseRef?: string;
  readonly requireLocalHeadAtRemote?: boolean;
};

export const parseLsRemoteOutput = (output: string): string | undefined => {
  const firstLine = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return firstLine?.split(/\s+/)[0];
};

export const parseDirtyFiles = (statusOutput: string): readonly string[] =>
  statusOutput
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter((line) => line !== "");

const assertLocalLaunchStatePushed = async (
  cwd: string,
  baseRef: string,
  remoteSha: string,
): Promise<void> => {
  const status = await runGit(["status", "--porcelain", "--untracked-files=all"], cwd);
  const dirtyFiles = parseDirtyFiles(status);
  if (dirtyFiles.length > 0) {
    throw new UncommittedLaunchFilesError({
      files: dirtyFiles,
    });
  }

  const localHead = await runGit(["rev-parse", "HEAD"], cwd);
  if (localHead !== remoteSha) {
    throw new UnpushedBaseError({
      localHead,
      remoteHead: remoteSha,
      ref: baseRef,
    });
  }
};

export const readRepositoryContext = async (
  cwd: string = process.cwd(),
  options: RepositoryContextOptions = {},
): Promise<WorkerRepositoryContext> => {
  const baseRef = options.baseRef ?? process.env.CURSOR_BASE_REF ?? "main";
  const [remoteUrl, lsRemoteOutput] = await Promise.all([
    runGit(["remote", "get-url", "origin"], cwd),
    runGit(["ls-remote", "origin", baseRef], cwd),
  ]);
  const remoteSha = parseLsRemoteOutput(lsRemoteOutput);
  if (remoteSha === undefined) {
    throw new RemoteRefNotFoundError({
      remote: "origin",
      ref: baseRef,
    });
  }

  if (options.requireLocalHeadAtRemote === true) {
    await assertLocalLaunchStatePushed(cwd, baseRef, remoteSha);
  }

  return {
    remoteUrl,
    baseBranch: baseRef,
    baseSha: remoteSha,
  };
};
