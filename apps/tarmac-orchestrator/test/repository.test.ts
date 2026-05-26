import { describe, expect, test } from "bun:test";

import { parseLsRemoteOutput } from "../src";

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
});
