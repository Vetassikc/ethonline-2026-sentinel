import test from "node:test";
import assert from "node:assert/strict";

import { validateExposurePlan } from "../app/exposure-plan-request.ts";

const VALID = {
  schema_version: "exposure_plan.v1",
  agent_id: "agent_a",
  goal: { kind: "supply_up_to", target_units: "0.300000000000000000" },
  steps: [
    { kind: "acquire_wsteth", units: "0.300000000000000000" },
    { kind: "supply_aave", units: "0.300000000000000000" },
  ],
};

test("validateExposurePlan accepts the bounded canonical shape", () => {
  const result = validateExposurePlan(VALID);

  assert.deepEqual(result, { ok: true, plan: VALID });
});

test("validateExposurePlan accepts both agents, every goal, and one to three actions", () => {
  const goals = [
    "acquire_up_to",
    "supply_up_to",
    "reduce_aave_exposure",
    "reduce_total_exposure",
  ] as const;
  const actions = [
    { kind: "acquire_wsteth", units: "0.100000000000000000" },
    { kind: "supply_aave", units: "0.100000000000000000" },
    { kind: "withdraw_aave_to_wallet", units: "0.100000000000000000" },
  ] as const;

  for (const agent_id of ["agent_a", "agent_b"] as const) {
    for (const kind of goals) {
      for (const steps of [actions.slice(0, 1), actions.slice(0, 2), actions]) {
        const result = validateExposurePlan({
          ...VALID,
          agent_id,
          goal: { kind, target_units: "0.100000000000000000" },
          steps,
        });
        assert.equal(result.ok, true, `${agent_id}/${kind}/${steps.length}`);
      }
    }
  }
});

test("validateExposurePlan preserves the exact step order and decimal strings", () => {
  const input = {
    ...VALID,
    steps: [
      { kind: "withdraw_aave_to_wallet", units: "1.230000000000000001" },
      { kind: "supply_aave", units: "0.000000000000000001" },
    ],
  };

  const result = validateExposurePlan(input);

  assert.deepEqual(result, { ok: true, plan: input });
});

test("validateExposurePlan rejects unknown fields and caller-controlled authority inputs", () => {
  for (const input of [
    { ...VALID, account: "0x0000000000000000000000000000000000000001" },
    { ...VALID, chain_id: 8453 },
    { ...VALID, policy: { dependency_cap_units: "999" } },
    { ...VALID, provider_url: "https://example.invalid" },
    { ...VALID, steps: [{ ...VALID.steps[0], token: "wstETH" }] },
  ]) {
    const result = validateExposurePlan(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "invalid_exposure_plan");
  }
});

test("validateExposurePlan rejects unsupported and zero actions", () => {
  for (const steps of [
    [{ kind: "withdraw_aave_to_exit", units: "0.100000000000000000" }],
    [{ kind: "dispose_wsteth", units: "0.100000000000000000" }],
    [{ kind: "acquire_wsteth", units: "0" }],
    [{ kind: "supply_aave", units: "-0.100000000000000000" }],
    [{ kind: "withdraw_aave_to_wallet", units: "0.1000000000000000001" }],
  ]) {
    const result = validateExposurePlan({ ...VALID, steps });
    assert.equal(result.ok, false);
  }
});

test("validateExposurePlan rejects malformed goals and step counts", () => {
  const cases: unknown[] = [
    { ...VALID, goal: { kind: "unknown", target_units: "0.1" } },
    { ...VALID, goal: { kind: "supply_up_to" } },
    { ...VALID, goal: { kind: "supply_up_to", target_units: 0.1 } },
    { ...VALID, goal: { kind: "supply_up_to", target_units: "0" } },
    { ...VALID, goal: { kind: "supply_up_to", target_units: "1", extra: true } },
    { ...VALID, steps: [] },
    { ...VALID, steps: [VALID.steps[0], VALID.steps[0], VALID.steps[0], VALID.steps[0]] },
  ];

  for (const input of cases) assert.equal(validateExposurePlan(input).ok, false);
});

test("validateExposurePlan rejects negative, over-precision, and overflow quantities", () => {
  const overflow = "1".repeat(79);
  for (const units of ["-1", "1.0000000000000000001", overflow]) {
    const result = validateExposurePlan({
      ...VALID,
      steps: [{ kind: "acquire_wsteth", units }],
    });
    assert.equal(result.ok, false);
  }
});

test("validateExposurePlan returns sanitized stable detail categories", () => {
  const result = validateExposurePlan({ ...VALID, unknown: true });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "invalid_exposure_plan");
    assert.deepEqual(result.error.details, ["root_keys"]);
  }
});
