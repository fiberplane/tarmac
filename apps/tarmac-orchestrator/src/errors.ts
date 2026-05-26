import type { IneligibilityReason } from "@tarmac/fp-domain";
import { Data } from "effect";

export class CliUsageError extends Data.TaggedError("CliUsageError")<{
  readonly messageText: string;
}> {
  get message(): string {
    return this.messageText;
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
