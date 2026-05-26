import { describe, expect, test } from "bun:test";

import { parseDirtyFiles, parseLsRemoteOutput } from "../src";

describe("repository context", () => {
  test("parses the sha from ls-remote output", () => {
    expect(
      parseLsRemoteOutput(
        "abc123def4567890\trefs/heads/main\n1111111111111111\trefs/heads/other\n",
      ),
    ).toBe("abc123def4567890");
  });

  test("returns undefined for an empty remote ref result", () => {
    expect(parseLsRemoteOutput("")).toBeUndefined();
  });

  test("parses dirty files from whole-worktree status output", () => {
    expect(parseDirtyFiles(" M tsconfig.json\n?? rules/new-rule.yml\n")).toEqual([
      "tsconfig.json",
      "rules/new-rule.yml",
    ]);
  });
});
