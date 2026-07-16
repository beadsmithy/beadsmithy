export interface HarnessInputs {
  readonly fixtureA: string;
  readonly fixtureB?: string;
  readonly fixtureBSecond?: string;
  readonly phase: Phase;
  readonly scenario: Scenario;
  readonly storePath: string;
}

type ValidatedHarnessInputs =
  | (HarnessInputs & {
      readonly fixtureB: string;
      readonly fixtureBSecond: string;
      readonly scenario: "atomic-switch";
    })
  | (HarnessInputs & {
      readonly fixtureB: string;
      readonly scenario: "empty" | "issues";
    })
  | (HarnessInputs & {
      readonly scenario: "restoration";
    });

export type Phase = "1" | "2";
export type Scenario = "empty" | "issues" | "atomic-switch" | "restoration";

const formatReceived = (value: string | undefined): string =>
  JSON.stringify(value ?? "<missing>");

const phaseError = (value: string | undefined): string =>
  `BEADSMITH_E2E_PHASE must be one of 1|2; received ${formatReceived(value)}`;

const scenarioError = (value: string | undefined): string =>
  `BEADSMITH_E2E_SCENARIO must be one of empty|issues|atomic-switch|restoration; received ${formatReceived(value)}`;

export const isPhase = (value: string | undefined): value is Phase =>
  value === "1" || value === "2";

export const isScenario = (value: string | undefined): value is Scenario =>
  value === "empty" ||
  value === "issues" ||
  value === "atomic-switch" ||
  value === "restoration";

export const parsePhase = (value: string | undefined): Phase => {
  if (!isPhase(value)) {
    throw new Error(phaseError(value));
  }
  return value;
};

export const parseScenario = (value: string | undefined): Scenario => {
  if (!isScenario(value)) {
    throw new Error(scenarioError(value));
  }
  return value;
};

const requireValidatedInput = (
  name: string,
  value: string | undefined
): string => {
  if (!value) {
    throw new Error(`Validated harness input ${name} is unexpectedly missing`);
  }
  return value;
};

export const parseHarnessEnvironment = (
  env: NodeJS.ProcessEnv
): ValidatedHarnessInputs => {
  const rawScenario = env.BEADSMITH_E2E_SCENARIO;
  const rawPhase = env.BEADSMITH_E2E_PHASE ?? "1";
  const errors: string[] = [];

  if (!isScenario(rawScenario)) {
    errors.push(scenarioError(rawScenario));
  }
  if (!isPhase(rawPhase)) {
    errors.push(phaseError(rawPhase));
  }

  const requiredInputs: readonly (readonly [string, string | undefined])[] =
    rawScenario === "restoration"
      ? [
          ["BEADSMITH_E2E_WORKSPACE_A", env.BEADSMITH_E2E_WORKSPACE_A],
          [
            "BEADSMITH_WORKSPACE_STORE_PATH",
            env.BEADSMITH_WORKSPACE_STORE_PATH,
          ],
        ]
      : [
          ["BEADSMITH_E2E_WORKSPACE_A", env.BEADSMITH_E2E_WORKSPACE_A],
          ["BEADSMITH_E2E_WORKSPACE_B", env.BEADSMITH_E2E_WORKSPACE_B],
          [
            "BEADSMITH_WORKSPACE_STORE_PATH",
            env.BEADSMITH_WORKSPACE_STORE_PATH,
          ],
        ];
  for (const [name, value] of requiredInputs) {
    if (!value) {
      errors.push(`${name} is required`);
    }
  }

  if (
    rawScenario === "atomic-switch" &&
    !env.BEADSMITH_E2E_WORKSPACE_B_SECOND
  ) {
    errors.push("BEADSMITH_E2E_WORKSPACE_B_SECOND is required");
  }

  if (errors.length > 0) {
    throw new Error(
      [
        "Invalid Issue List E2E harness environment:",
        ...errors.map((error) => `- ${error}`),
        "Run a `pnpm e2e:issue-list:*` script instead of invoking wdio directly.",
      ].join("\n")
    );
  }

  const commonInputs = {
    fixtureA: requireValidatedInput(
      "BEADSMITH_E2E_WORKSPACE_A",
      env.BEADSMITH_E2E_WORKSPACE_A
    ),
    fixtureB: env.BEADSMITH_E2E_WORKSPACE_B
      ? requireValidatedInput(
          "BEADSMITH_E2E_WORKSPACE_B",
          env.BEADSMITH_E2E_WORKSPACE_B
        )
      : undefined,
    phase: parsePhase(rawPhase),
    storePath: requireValidatedInput(
      "BEADSMITH_WORKSPACE_STORE_PATH",
      env.BEADSMITH_WORKSPACE_STORE_PATH
    ),
  };
  const scenario = parseScenario(rawScenario);

  if (scenario === "restoration") {
    return {
      fixtureA: commonInputs.fixtureA,
      phase: commonInputs.phase,
      scenario,
      storePath: commonInputs.storePath,
    };
  }

  if (scenario === "atomic-switch") {
    return {
      ...commonInputs,
      fixtureB: requireValidatedInput(
        "BEADSMITH_E2E_WORKSPACE_B",
        env.BEADSMITH_E2E_WORKSPACE_B
      ),
      fixtureBSecond: requireValidatedInput(
        "BEADSMITH_E2E_WORKSPACE_B_SECOND",
        env.BEADSMITH_E2E_WORKSPACE_B_SECOND
      ),
      scenario,
    };
  }

  return {
    ...commonInputs,
    fixtureB: requireValidatedInput(
      "BEADSMITH_E2E_WORKSPACE_B",
      env.BEADSMITH_E2E_WORKSPACE_B
    ),
    fixtureBSecond: env.BEADSMITH_E2E_WORKSPACE_B_SECOND,
    scenario,
  };
};
