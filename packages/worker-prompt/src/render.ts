import { findSensitiveLeaks, redactSensitiveText } from "./redaction";
import type { WorkerComment, WorkerPromptInput } from "./types";

const issueLabel = (input: WorkerPromptInput): string => input.issue.displayId ?? input.issue.id;

const renderComment = (comment: WorkerComment, index: number): string => {
  const author = comment.author ?? "unknown";
  const createdAt = comment.createdAt ?? "unknown time";
  return [`Comment ${index + 1} (${author}, ${createdAt}):`, comment.body].join("\n");
};

const renderComments = (comments: readonly WorkerComment[] | undefined): string => {
  if (comments === undefined || comments.length === 0) {
    return "No issue comments were provided.";
  }

  return comments.map(renderComment).join("\n\n");
};

export const renderWorkerPrompt = (input: WorkerPromptInput): string => {
  const redaction = input.redaction;
  const rawPrompt = [
    "# Tarmac Cursor Worker Task",
    "",
    `Issue: ${issueLabel(input)}`,
    `Title: ${input.issue.title}`,
    "",
    "Repository:",
    `- Remote: ${input.repository.remoteUrl}`,
    `- Base branch: ${input.repository.baseBranch}`,
    `- Required base SHA: ${input.repository.baseSha}`,
    "",
    "Before Editing:",
    "- Confirm the checkout is this repository and not a nested clone.",
    "- Run `git rev-parse HEAD` and stop if it does not match the required base SHA.",
    "- Read the issue context below before changing files.",
    "",
    "FP Access:",
    "- The shell is preconfigured for FP remote no-clone access.",
    "- Use the `fp` CLI for issue reads, comments, and tarmac property updates.",
    "- Do not print, echo, commit, comment, or place credential environment names or values in artifacts.",
    "",
    "Issue Description:",
    input.issue.description?.trim() || "No issue description was provided.",
    "",
    "Issue Comments:",
    renderComments(input.issue.comments),
    "",
    "Implementation Expectations:",
    "- Keep the change scoped to this issue.",
    "- Prefer a red-green tracebullet: first prove the failing behavior, then implement the smallest useful path.",
    "- Run focused tests first, then the repository check suite.",
    "- Leave unrelated user work untouched.",
    "",
    "Completion Expectations:",
    "- Before opening or updating a PR, run `.agents/skills/thermo-nuclear-code-quality-review/SKILL.md` and complete the thermo-nuclear section in `.github/pull_request_template.md` (human/agent attestation, not CI).",
    "- Cursor auto PR creation is enabled; use the PR Cursor creates.",
    "- Update FP with branch, PR URL, head SHA, and terminal tarmac state when those values are available.",
    "- If blocked, add a concise FP comment and set tarmac state to needs-attention with a redacted error.",
    "- Never include credential names or values in FP comments, PR text, logs, artifacts, or final summaries.",
  ].join("\n");

  const prompt = redactSensitiveText(rawPrompt, redaction);
  const leaks = findSensitiveLeaks(prompt, redaction);

  if (leaks.length > 0) {
    return redactSensitiveText(prompt, {
      ...redaction,
      forbiddenTerms: leaks,
    });
  }

  return prompt;
};
