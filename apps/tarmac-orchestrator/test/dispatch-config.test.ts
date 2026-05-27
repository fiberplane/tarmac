import { describe, expect, test } from "bun:test";

import { readDispatchCapacityConfig } from "../src/dispatch-config";

describe("readDispatchCapacityConfig", () => {
  test("prefers cli override over environment", () => {
    expect(
      readDispatchCapacityConfig(
        {
          TARMAC_MAX_CONCURRENT_RUNS: "5",
        },
        "2",
      ),
    ).toEqual({
      maxConcurrentRuns: 2,
    });
  });

  test("reads environment when cli is unset", () => {
    expect(
      readDispatchCapacityConfig({
        TARMAC_MAX_CONCURRENT_RUNS: "4",
      }),
    ).toEqual({
      maxConcurrentRuns: 4,
    });
  });
});
