import type { PromptRedactionConfig, PromptSecret } from "./types";

export const DEFAULT_FORBIDDEN_TERMS: readonly string[] = [
  "CURSOR_API_KEY",
  "FP_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_PAT",
];

const REDACTED_SECRET = "[REDACTED_SECRET]";
const REDACTED_VALUE = "[REDACTED_VALUE]";
const MIN_SECRET_VALUE_LENGTH = 4;

const literalValues = (config: PromptRedactionConfig = {}): readonly string[] => {
  const terms = config.forbiddenTerms ?? DEFAULT_FORBIDDEN_TERMS;
  const secretNames = (config.secrets ?? []).map((secret) => secret.name);
  return [...terms, ...secretNames].filter((value) => value.trim() !== "");
};

const secretValues = (secrets: readonly PromptSecret[] = []): readonly string[] =>
  secrets
    .flatMap((secret) => (secret.value === undefined ? [] : [secret.value]))
    .filter((value) => value.trim().length >= MIN_SECRET_VALUE_LENGTH);

const byLengthDescending = (left: string, right: string): number => right.length - left.length;

export const redactSensitiveText = (text: string, config: PromptRedactionConfig = {}): string => {
  let redacted = text;

  for (const term of [...new Set(literalValues(config))].sort(byLengthDescending)) {
    redacted = redacted.replaceAll(term, REDACTED_SECRET);
  }

  for (const value of [...new Set(secretValues(config.secrets))].sort(byLengthDescending)) {
    redacted = redacted.replaceAll(value, REDACTED_VALUE);
  }

  return redacted;
};

export const findSensitiveLeaks = (
  text: string,
  config: PromptRedactionConfig = {},
): readonly string[] => {
  const forbidden = [...literalValues(config), ...secretValues(config.secrets)].filter(
    (value) => value.trim() !== "",
  );

  return [...new Set(forbidden)].filter((value) => text.includes(value));
};
