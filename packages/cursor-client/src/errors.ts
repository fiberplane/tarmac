import { Data } from "effect";

export class MissingCursorApiKeyError extends Data.TaggedError("MissingCursorApiKeyError")<{}> {
  get message(): string {
    return "CURSOR_API_KEY is required for real Cursor SDK operations.";
  }
}

export class UnknownFakeCursorRunError extends Data.TaggedError("UnknownFakeCursorRunError")<{
  readonly agentId: string;
  readonly runId: string;
}> {
  get message(): string {
    return `Unknown fake Cursor run: ${this.agentId}/${this.runId}`;
  }
}
