import { describe, expect, test } from "bun:test";

import { inferCursorRunUrl } from "../src/run-url";

describe("inferCursorRunUrl", () => {
  test("builds a deterministic agents deep link from the agent id", () => {
    const agentId = "bc-00000000-0000-4000-8000-000000000001";

    expect(inferCursorRunUrl(agentId)).toBe(
      "https://cursor.com/agents/bc-00000000-0000-4000-8000-000000000001",
    );
  });

  test("percent-encodes reserved characters in agent ids", () => {
    expect(inferCursorRunUrl("agent/with space")).toBe(
      "https://cursor.com/agents/agent%2Fwith%20space",
    );
  });
});
