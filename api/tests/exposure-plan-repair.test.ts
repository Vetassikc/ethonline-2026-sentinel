import test from "node:test";
import assert from "node:assert/strict";

import {
  type ExposureAccountingState,
  type ExposurePlanPolicy,
  type ExposureReservationDelta,
} from "../app/exposure-plan-engine.ts";
import { repairExposurePlan } from "../app/exposure-plan-repair.ts";
import { type ExposurePlanV1 } from "../../shared/schemas/exposure-plan.ts";

const POLICY: ExposurePlanPolicy = {
  policy_version: "exposure-plan-wsteth-v1",
  dependency_cap_units: "1.000000000000000000",
  aave_cap_units: "0.500000000000000000",
  unit: "wstETH",
};

const INITIAL_STATE: ExposureAccountingState = {
  direct_available_raw: 400000000000000000n,
  aave_exposure_raw: 400000000000000000n,
  total_exposure_raw: 800000000000000000n,
  debt_raw: 0n,
  dependency_cap_raw: 1000000000000000000n,
  aave_cap_raw: 500000000000000000n,
};

function makePlan(
  kind: ExposurePlanV1["goal"]["kind"],
  target_units: string,
  steps: ExposurePlanV1["steps"],
): ExposurePlanV1 {
  return {
    schema_version: "exposure_plan.v1",
    agent_id: "agent_a",
    goal: { kind, target_units },
    steps,
  };
}

test("canonical over-limit plan repairs left-to-right to .20 acquire and .10 supply", () => {
  const result = repairExposurePlan(INITIAL_STATE, makePlan("supply_up_to", "0.300000000000000000", [
    { kind: "acquire_wsteth", units: "0.300000000000000000" },
    { kind: "supply_aave", units: "0.300000000000000000" },
  ]), POLICY);

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.repair_algorithm, "left_to_right_max_feasible_v1");
  assert.deepEqual(result.candidate?.steps, [
    { kind: "acquire_wsteth", units: "0.200000000000000000" },
    { kind: "supply_aave", units: "0.100000000000000000" },
  ]);
  assert.equal(result.evaluation?.final_state.total_exposure_raw, 1000000000000000000n);
  assert.equal(result.evaluation?.goal_status, "PARTIAL");
  assert.equal(result.evaluation?.resource_requirements.peak_total_increase_raw, 200000000000000000n);
  assert.equal(result.evaluation?.resource_requirements.peak_aave_increase_raw, 100000000000000000n);
  assert.deepEqual(result.changes, [
    { step_index: 0, requested_units: "0.300000000000000000", repaired_units: "0.200000000000000000" },
    { step_index: 1, requested_units: "0.300000000000000000", repaired_units: "0.100000000000000000" },
  ]);
});

test("repair clamps an acquire target without overshooting it", () => {
  const result = repairExposurePlan(INITIAL_STATE, makePlan("acquire_up_to", "0.100000000000000000", [
    { kind: "acquire_wsteth", units: "0.300000000000000000" },
  ]), POLICY);

  assert.equal(result.status, "FULL");
  assert.deepEqual(result.candidate?.steps, [
    { kind: "acquire_wsteth", units: "0.100000000000000000" },
  ]);
  assert.equal(result.evaluation?.violations.some((item) => item.code === "goal_target_overshot"), false);
});

test("repair never uses a later withdrawal to free earlier total-cap capacity", () => {
  const result = repairExposurePlan(INITIAL_STATE, makePlan("acquire_up_to", "0.300000000000000000", [
    { kind: "acquire_wsteth", units: "0.300000000000000000" },
    { kind: "withdraw_aave_to_wallet", units: "0.400000000000000000" },
  ]), POLICY);

  assert.deepEqual(result.candidate?.steps[0], {
    kind: "acquire_wsteth",
    units: "0.200000000000000000",
  });
});

test("repair returns no supported repair for total-exposure reduction", () => {
  const result = repairExposurePlan(INITIAL_STATE, makePlan("reduce_total_exposure", "0.100000000000000000", [
    { kind: "withdraw_aave_to_wallet", units: "0.100000000000000000" },
  ]), POLICY);

  assert.equal(result.status, "NO_SUPPORTED_REPAIR");
  assert.equal(result.candidate, null);
  assert.equal(result.evaluation, null);
});

test("repair finds a cap-restoring withdrawal even when zero quantity is infeasible", () => {
  const overCapState: ExposureAccountingState = {
    ...INITIAL_STATE,
    direct_available_raw: 200000000000000000n,
    aave_exposure_raw: 600000000000000000n,
    total_exposure_raw: 800000000000000000n,
  };
  const result = repairExposurePlan(overCapState, makePlan("reduce_aave_exposure", "0.200000000000000000", [
    { kind: "withdraw_aave_to_wallet", units: "0.200000000000000000" },
  ]), POLICY);

  assert.equal(result.status, "FULL");
  assert.deepEqual(result.candidate?.steps, [
    { kind: "withdraw_aave_to_wallet", units: "0.200000000000000000" },
  ]);
  assert.equal(result.evaluation?.policy_status, "PASS");
  assert.equal(result.evaluation?.final_state.aave_exposure_raw, 400000000000000000n);
});

test("repair searches the feasible withdrawal interval when the request exceeds inventory", () => {
  const overCapState: ExposureAccountingState = {
    ...INITIAL_STATE,
    direct_available_raw: 200000000000000000n,
    aave_exposure_raw: 600000000000000000n,
    total_exposure_raw: 800000000000000000n,
  };
  const result = repairExposurePlan(overCapState, makePlan("reduce_aave_exposure", "0.700000000000000000", [
    { kind: "withdraw_aave_to_wallet", units: "0.700000000000000000" },
  ]), POLICY);

  assert.equal(result.status, "PARTIAL");
  assert.deepEqual(result.candidate?.steps, [
    { kind: "withdraw_aave_to_wallet", units: "0.600000000000000000" },
  ]);
  assert.equal(result.evaluation?.policy_status, "PASS");
  assert.equal(result.evaluation?.final_state.aave_exposure_raw, 0n);
});

test("repair respects active shared capacity and reports a partial candidate", () => {
  const active: ExposureReservationDelta[] = [{
    reservation_id: "reservation_a",
    agent_id: "agent_a",
    peak_total_increase_raw: 150000000000000000n,
    peak_aave_increase_raw: 0n,
    required_preexisting_direct_raw: 0n,
    required_preexisting_aave_raw: 0n,
    status: "accepted_reserved",
  }];
  const result = repairExposurePlan(INITIAL_STATE, makePlan("acquire_up_to", "0.150000000000000000", [
    { kind: "acquire_wsteth", units: "0.150000000000000000" },
  ]), POLICY, active);

  assert.equal(result.status, "PARTIAL");
  assert.deepEqual(result.candidate?.steps, [
    { kind: "acquire_wsteth", units: "0.050000000000000000" },
  ]);
});
