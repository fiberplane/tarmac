import type { IneligibilityReason } from "@tarmac/fp-domain";
import { Data } from "effect";

export class CliUsageError extends Data.TaggedError("CliUsageError")<{
  readonly messageText: string;
}> {
  get message(): string {
    return this.messageText;
  }
}

export class MissingCursorWorkerEnvError extends Data.TaggedError("MissingCursorWorkerEnvError")<{
  readonly names: readonly string[];
}> {
  get message(): string {
    return `Missing required Cursor worker FP env names: ${this.names.join(", ")}`;
  }
}

export class FpCliCommandError extends Data.TaggedError("FpCliCommandError")<{
  readonly args: readonly string[];
  readonly stderr?: string;
  readonly cause: unknown;
}> {
  get message(): string {
    const command = ["fp", ...this.args].join(" ");
    return this.stderr === undefined
      ? `FP CLI command failed: ${command}`
      : `FP CLI command failed: ${command}\n${this.stderr}`;
  }
}

export class GitCommandError extends Data.TaggedError("GitCommandError")<{
  readonly args: readonly string[];
  readonly stderr?: string;
  readonly cause: unknown;
}> {
  get message(): string {
    const command = ["git", ...this.args].join(" ");
    return this.stderr === undefined
      ? `Git command failed: ${command}`
      : `Git command failed: ${command}\n${this.stderr}`;
  }
}

export class RemoteRefNotFoundError extends Data.TaggedError("RemoteRefNotFoundError")<{
  readonly remote: string;
  readonly ref: string;
}> {
  get message(): string {
    return `Remote ref not found: ${this.remote} ${this.ref}`;
  }
}

export class UncommittedLaunchFilesError extends Data.TaggedError("UncommittedLaunchFilesError")<{
  readonly files: readonly string[];
}> {
  get message(): string {
    return `Refusing real Cursor launch with uncommitted launch files: ${this.files.join(", ")}`;
  }
}

export class UnpushedBaseError extends Data.TaggedError("UnpushedBaseError")<{
  readonly localHead: string;
  readonly remoteHead: string;
  readonly ref: string;
}> {
  get message(): string {
    return `Refusing real Cursor launch because local HEAD ${this.localHead} does not match remote ${this.ref} ${this.remoteHead}`;
  }
}

export class IssueNotFoundError extends Data.TaggedError("IssueNotFoundError")<{
  readonly issueId: string;
}> {
  get message(): string {
    return `Issue not found: ${this.issueId}`;
  }
}

export class IssueIneligibleError extends Data.TaggedError("IssueIneligibleError")<{
  readonly issueId: string;
  readonly reason: IneligibilityReason;
}> {
  get message(): string {
    return `Issue is not eligible for dispatch: ${this.issueId} (${this.reason.kind})`;
  }
}

export class ClaimLostError extends Data.TaggedError("ClaimLostError")<{
  readonly issueId: string;
  readonly reason: string;
}> {
  get message(): string {
    return `Claim lost for ${this.issueId}: ${this.reason}`;
  }
}

export class MissingRunMetadataError extends Data.TaggedError("MissingRunMetadataError")<{
  readonly issueId: string;
}> {
  get message(): string {
    return `Issue does not have Cursor run metadata: ${this.issueId}`;
  }
}
