import { describe, expect, it } from "vitest";

import {
  parseHarnessEnvironment,
  parsePhase,
  parseScenario,
} from "./harness-inputs.ts";

describe("parseScenario", () => {
  it.each(["empty", "issues", "atomic-switch", "restoration"] as const)(
    "accepts the %s scenario",
    (scenario) => {
      expect(parseScenario(scenario)).toBe(scenario);
    }
  );

  it("rejects an unknown scenario with the received value", () => {
    expect(() => parseScenario("unknown-scenario")).toThrow(
      'BEADSMITH_E2E_SCENARIO must be one of empty|issues|atomic-switch|restoration; received "unknown-scenario"'
    );
  });
});

describe("parsePhase", () => {
  it.each(["1", "2"] as const)("accepts phase %s", (phase) => {
    expect(parsePhase(phase)).toBe(phase);
  });

  it("rejects an unknown phase", () => {
    expect(() => parsePhase("3")).toThrow(
      'BEADSMITH_E2E_PHASE must be one of 1|2; received "3"'
    );
  });
});

describe("parseHarnessEnvironment", () => {
  it("reports an omitted scenario consistently with other received values", () => {
    expect(() =>
      parseHarnessEnvironment({
        BEADSMITH_E2E_WORKSPACE_A: "/fixtures/a",
        BEADSMITH_E2E_WORKSPACE_B: "/fixtures/b",
        BEADSMITH_WORKSPACE_STORE_PATH: "/stores/workspaces.json",
      })
    ).toThrow(
      '- BEADSMITH_E2E_SCENARIO must be one of empty|issues|atomic-switch|restoration; received "<missing>"'
    );
  });

  it("returns typed inputs when the environment is complete", () => {
    expect(
      parseHarnessEnvironment({
        BEADSMITH_E2E_PHASE: "2",
        BEADSMITH_E2E_SCENARIO: "atomic-switch",
        BEADSMITH_E2E_WORKSPACE_A: "/fixtures/a",
        BEADSMITH_E2E_WORKSPACE_B: "/fixtures/b",
        BEADSMITH_E2E_WORKSPACE_B_SECOND: "/fixtures/b-second",
        BEADSMITH_WORKSPACE_STORE_PATH: "/stores/workspaces.json",
      })
    ).toEqual({
      fixtureA: "/fixtures/a",
      fixtureB: "/fixtures/b",
      fixtureBSecond: "/fixtures/b-second",
      phase: "2",
      scenario: "atomic-switch",
      storePath: "/stores/workspaces.json",
    });
  });

  it("defaults an omitted phase to phase 1", () => {
    expect(
      parseHarnessEnvironment({
        BEADSMITH_E2E_SCENARIO: "issues",
        BEADSMITH_E2E_WORKSPACE_A: "/fixtures/a",
        BEADSMITH_E2E_WORKSPACE_B: "/fixtures/b",
        BEADSMITH_WORKSPACE_STORE_PATH: "/stores/workspaces.json",
      })
    ).toMatchObject({
      fixtureBSecond: undefined,
      phase: "1",
      scenario: "issues",
    });
  });

  it("reports the atomic-switch-only fixture when it is missing", () => {
    expect(() =>
      parseHarnessEnvironment({
        BEADSMITH_E2E_SCENARIO: "atomic-switch",
        BEADSMITH_E2E_WORKSPACE_A: "/fixtures/a",
        BEADSMITH_E2E_WORKSPACE_B: "/fixtures/b",
        BEADSMITH_WORKSPACE_STORE_PATH: "/stores/workspaces.json",
      })
    ).toThrow("- BEADSMITH_E2E_WORKSPACE_B_SECOND is required");
  });

  it("reports every invalid required input in one error", () => {
    expect(() =>
      parseHarnessEnvironment({
        BEADSMITH_E2E_PHASE: "3",
        BEADSMITH_E2E_SCENARIO: "unknown-scenario",
      })
    ).toThrow(
      [
        "Invalid Issue List E2E harness environment:",
        '- BEADSMITH_E2E_SCENARIO must be one of empty|issues|atomic-switch|restoration; received "unknown-scenario"',
        '- BEADSMITH_E2E_PHASE must be one of 1|2; received "3"',
        "- BEADSMITH_E2E_WORKSPACE_A is required",
        "- BEADSMITH_E2E_WORKSPACE_B is required",
        "- BEADSMITH_WORKSPACE_STORE_PATH is required",
        "Run a `pnpm e2e:issue-list:*` script instead of invoking wdio directly.",
      ].join("\n")
    );
  });

  it("accepts the restoration scenario without a B fixture", () => {
    expect(
      parseHarnessEnvironment({
        BEADSMITH_E2E_SCENARIO: "restoration",
        BEADSMITH_E2E_WORKSPACE_A: "/fixtures/a",
        BEADSMITH_WORKSPACE_STORE_PATH: "/stores/workspaces.json",
      })
    ).toEqual({
      fixtureA: "/fixtures/a",
      phase: "1",
      scenario: "restoration",
      storePath: "/stores/workspaces.json",
    });
  });
});
