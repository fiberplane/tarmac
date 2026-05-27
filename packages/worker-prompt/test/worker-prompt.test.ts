import { describe, expect, test } from "bun:test";

import {
  findSensitiveLeaks,
  redactSensitiveText,
  renderWorkerPrompt,
  type PromptRedactionConfig,
} from "../src";

const redaction: PromptRedactionConfig = {
  secrets: [
    {
      name: "CURSOR_API_KEY",
      value: "cur_secret_123",
    },
    {
      name: "FP_TOKEN",
      value: "fp_secret_456",
    },
    {
      name: "GITHUB_TOKEN",
      value: "ghp_secret_789",
    },
    {
      name: "DOTENV_PRIVATE",
      value: "dotenv-secret-value",
    },
  ],
};

describe("redactSensitiveText", () => {
  test("redacts registered secret names and values", () => {
    const text = "CURSOR_API_KEY=cur_secret_123 FP_TOKEN=fp_secret_456 DOTENV_PRIVATE";

    expect(redactSensitiveText(text, redaction)).toBe(
      "[REDACTED_SECRET]=[REDACTED_VALUE] [REDACTED_SECRET]=[REDACTED_VALUE] [REDACTED_SECRET]",
    );
  });

  test("reports leaks before redaction", () => {
    expect(findSensitiveLeaks("GITHUB_TOKEN ghp_secret_789", redaction)).toEqual([
      "GITHUB_TOKEN",
      "ghp_secret_789",
    ]);
  });
});

describe("renderWorkerPrompt", () => {
  test("renders FP, base SHA, PR, and verification instructions", () => {
    const prompt = renderWorkerPrompt({
      issue: {
        id: "issue-1",
        displayId: "TARM-1",
        title: "Dispatch a Cursor worker",
        description: "Implement the next tracebullet.",
      },
      repository: {
        remoteUrl: "https://github.com/fiberplane/tarmac.git",
        baseBranch: "main",
        baseSha: "abc123",
      },
      redaction,
    });

    expect(prompt).toContain("Issue: TARM-1");
    expect(prompt).toContain("Required base SHA: abc123");
    expect(prompt).toContain("FP remote no-clone access");
    expect(prompt).toContain("thermo-nuclear-code-quality-review");
    expect(prompt).toContain("pull_request_template.md");
    expect(prompt).toContain("Cursor auto PR creation is enabled");
    expect(prompt).toContain("tarmac state to needs-attention");
  });

  test("redacts secret names and values from issue context and boilerplate", () => {
    const prompt = renderWorkerPrompt({
      issue: {
        id: "issue-1",
        displayId: "TARM-1",
        title: "Do not leak CURSOR_API_KEY",
        description: "The token value is fp_secret_456 and dotenv-secret-value.",
        comments: [
          {
            author: "boots",
            body: "Saw GITHUB_TOKEN and ghp_secret_789 in old logs.",
            createdAt: "2026-05-26T16:00:00.000Z",
          },
        ],
      },
      repository: {
        remoteUrl: "https://github.com/fiberplane/tarmac.git",
        baseBranch: "main",
        baseSha: "abc123",
      },
      redaction,
    });

    expect(prompt).not.toContain("CURSOR_API_KEY");
    expect(prompt).not.toContain("FP_TOKEN");
    expect(prompt).not.toContain("GITHUB_TOKEN");
    expect(prompt).not.toContain("cur_secret_123");
    expect(prompt).not.toContain("fp_secret_456");
    expect(prompt).not.toContain("ghp_secret_789");
    expect(prompt).not.toContain("dotenv-secret-value");
    expect(findSensitiveLeaks(prompt, redaction)).toEqual([]);
  });
});
