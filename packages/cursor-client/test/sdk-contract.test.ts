import { describe, expect, test } from "bun:test";

import { cloudCreateOptionsContract, cloudGetRunOptionsContract } from "../src/sdk-contract";

describe("@cursor/sdk contract", () => {
  test("keeps Tarmac pinned to the current cloud agent SDK surface", () => {
    expect(cloudCreateOptionsContract.cloud?.autoCreatePR).toBe(true);
    expect(cloudCreateOptionsContract.cloud?.repos?.[0]?.startingRef).toBe("main");
    expect(cloudCreateOptionsContract.cloud?.envVars?.FP_REMOTE).toBe("rest-api");
    expect(cloudGetRunOptionsContract.runtime).toBe("cloud");
  });
});
