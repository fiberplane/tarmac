import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { TarmacIssue, TarmacIssueUpdate } from "@tarmac/fp-domain";
import type { WorkerComment } from "@tarmac/worker-prompt";
import { Schema } from "effect";

import { FpCliCommandError } from "./errors";

const execFileAsync = promisify(execFile);

const FpListIssue = Schema.Struct({
  id: Schema.String,
});

const FpIssueListResponse = Schema.Struct({
  issues: Schema.Array(FpListIssue),
});

const FpIssueComment = Schema.Struct({
  author: Schema.optional(Schema.String),
  content: Schema.String,
  createdAt: Schema.optional(Schema.String),
});

const FpIssueShowResponse = Schema.Struct({
  id: Schema.String,
  displayId: Schema.optional(Schema.String),
  title: Schema.String,
  description: Schema.optional(Schema.String),
  status: Schema.String,
  parent: Schema.optional(Schema.Union(Schema.String, Schema.Null)),
  dependencies: Schema.Array(Schema.String),
  properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  comments: Schema.optional(Schema.Array(FpIssueComment)),
});

type FpIssueShowResponse = Schema.Schema.Type<typeof FpIssueShowResponse>;

export type OrchestratorIssue = TarmacIssue & {
  readonly title: string;
  readonly description?: string;
  readonly comments: readonly WorkerComment[];
};

export interface FpClient {
  listIssues(): Promise<readonly OrchestratorIssue[]>;
  getIssue(issueId: string): Promise<OrchestratorIssue>;
  updateIssue(issueId: string, update: TarmacIssueUpdate): Promise<void>;
  commentIssue(issueId: string, comment: string): Promise<void>;
}

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

const runFp = async (args: readonly string[], cwd: string): Promise<string> => {
  try {
    const result = await execFileAsync("fp", [...args], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return result.stdout;
  } catch (cause) {
    const stderr = stderrFromCause(cause);
    throw new FpCliCommandError({
      args,
      ...(stderr === undefined ? {} : { stderr }),
      cause,
    });
  }
};

const decodeJson = <A, I>(schema: Schema.Schema<A, I>, json: string): A =>
  Schema.decodeUnknownSync(schema)(JSON.parse(json));

const mapIssue = (issue: FpIssueShowResponse): OrchestratorIssue => ({
  id: issue.id,
  ...(issue.displayId === undefined ? {} : { displayId: issue.displayId }),
  title: issue.title,
  ...(issue.description === undefined ? {} : { description: issue.description }),
  status: issue.status,
  ...(issue.parent === undefined || issue.parent === null ? {} : { parent: issue.parent }),
  dependencies: issue.dependencies,
  properties: issue.properties,
  comments: (issue.comments ?? []).map((comment) => ({
    ...(comment.author === undefined ? {} : { author: comment.author }),
    body: comment.content,
    ...(comment.createdAt === undefined ? {} : { createdAt: comment.createdAt }),
  })),
});

export class FpCliClient implements FpClient {
  constructor(private readonly cwd: string = process.cwd()) {}

  async listIssues(): Promise<readonly OrchestratorIssue[]> {
    const stdout = await runFp(["issue", "list", "--format", "json", "--limit", "500"], this.cwd);
    const response = decodeJson(FpIssueListResponse, stdout);
    return Promise.all(response.issues.map((issue) => this.getIssue(issue.id)));
  }

  async getIssue(issueId: string): Promise<OrchestratorIssue> {
    const stdout = await runFp(["issue", "show", issueId, "--format", "json"], this.cwd);
    return mapIssue(decodeJson(FpIssueShowResponse, stdout));
  }

  async updateIssue(issueId: string, update: TarmacIssueUpdate): Promise<void> {
    const args = ["issue", "update", issueId];
    if (update.status !== undefined) {
      args.push("--status", update.status);
    }

    for (const [key, value] of Object.entries(update.properties)) {
      if (value !== undefined) {
        args.push("--property", `${key}=${value}`);
      }
    }

    await runFp(args, this.cwd);
  }

  async commentIssue(issueId: string, comment: string): Promise<void> {
    await runFp(["comment", "add", issueId, comment], this.cwd);
  }
}
