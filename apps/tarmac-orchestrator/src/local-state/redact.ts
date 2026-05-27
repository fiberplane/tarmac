import { redactSensitiveText, type PromptRedactionConfig } from "@tarmac/worker-prompt";
import { Schema } from "effect";

export const redactUnknown = (
  value: unknown,
  redaction: PromptRedactionConfig | undefined,
): unknown => {
  const serialized = JSON.stringify(value);
  const redacted = redactSensitiveText(serialized, redaction);
  return Schema.decodeUnknownSync(Schema.Unknown)(JSON.parse(redacted));
};

export const redactText = (text: string, redaction: PromptRedactionConfig | undefined): string =>
  redactSensitiveText(text, redaction);
