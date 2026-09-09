import test from "node:test";
import assert from "node:assert/strict";

import type { ExposurePlanV1 } from "../../shared/schemas/exposure-plan.ts";
import {
  evaluateExposurePlan,
  replayExposurePlan,
  type ExposureAccountingState,
  type ExposurePlanPolicy,
  type ExposureReservationDelta,
} from "../app/exposure-plan-engine.ts";

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

function plan(
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

test("supply conserves total underlying exposure", () => {
  const result = replayExposurePlan(INITIAL_STATE, [
    { kind: "supply_aave", units: "0.100000000000000000" },
  ], POLICY);

  assert.equal(result.final_state.total_exposure_raw, 800000000000000000n);
  assert.equal(result.final_state.direct_available_raw, 300000000000000000n);
  assert.equal(result.final_state.aave_exposure_raw, 500000000000000000n);
  assert.deepEqual(result.violations, []);
});

test("acquisition, supply, and wallet withdrawal conserve the separate paths", () => {
  const result = replayExposurePlan(INITIAL_STATE, [
    { kind: "acquire_wsteth", units: "0.100000000000000000" },
    { kind: "supply_aave", units: "0.100000000000000000" },
    { kind: "withdraw_aave_to_wallet", units: "0.100000000000000000" },
  ], POLICY);

  assert.deepEqual(result.final_state, {
    ...INITIAL_STATE,
    direct_available_raw: 500000000000000000n,
    aave_exposure_raw: 400000000000000000n,
    total_exposure_raw: 900000000000000000n,
  });
  assert.deepEqual(result.violations, []);
});

test("intermediate total and Aave cap violations are distinct", () => {
  const total = replayExposurePlan(INITIAL_STATE, [
    { kind: "acquire_wsteth", units: "0.300000000000000000" },
  ], POLICY);
  assert.equal(total.violations[0]?.code, "total_cap_exceeded");
  assert.equal(total.violations[0]?.before.total_exposure_raw, 800000000000000000n);
  assert.equal(total.violations[0]?.after.total_exposure_raw, 1100000000000000000n);

  const aave = replayExposurePlan(INITIAL_STATE, [
    { kind: "supply_aave", units: "0.150000000000000000" },
  ], POLICY);
  assert.equal(aave.violations[0]?.code, "aave_cap_exceeded");
  assert.equal(aave.violations[0]?.after.aave_exposure_raw, 550000000000000000n);
});

test("debt-free withdrawal restores existing Aave over-cap exposure", () => {
  const overCapState: ExposureAccountingState = {
    ...INITIAL_STATE,
    direct_available_raw: 200000000000000000n,
    aave_exposure_raw: 600000000000000000n,
    total_exposure_raw: 800000000000000000n,
  };
  const result = evaluateExposurePlan(overCapState, plan("reduce_aave_exposure", "0.200000000000000000", [
    { kind: "withdraw_aave_to_wallet", units: "0.200000000000000000" },
  ]), POLICY, [], {
    source_provenance: "FIXTURE",
    paper_session_eligible: true,
    accept_partial: true,
  });

  assert.equal(result.policy_status, "PASS");
  assert.equal(result.goal_status, "FULL");
  assert.equal(result.execution_mode, "PAPER_AUTHORIZABLE");
  assert.equal(result.final_state.aave_exposure_raw, 400000000000000000n);
  assert.equal(result.resource_requirements.peak_aave_increase_raw, 0n);
  assert.deepEqual(result.violations, []);
});

test("insufficient withdrawal still reports the remaining Aave cap violation", () => {
  const overCapState: ExposureAccountingState = {
    ...INITIAL_STATE,
    direct_available_raw: 200000000000000000n,
    aave_exposure_raw: 600000000000000000n,
    total_exposure_raw: 800000000000000000n,
  };
  const result = evaluateExposurePlan(overCapState, plan("reduce_aave_exposure", "0.200000000000000000", [
    { kind: "withdraw_aave_to_wallet", units: "0.050000000000000000" },
  ]), POLICY);

  assert.equal(result.final_state.aave_exposure_raw, 550000000000000000n);
  assert.equal(result.violations.some((item) => item.code === "aave_cap_exceeded"), true);
  assert.equal(result.execution_mode, "BLOCKED");
});

test("restoring withdrawal does not borrow Aave capacity from an unrelated reservation", () => {
  const overCapState: ExposureAccountingState = {
    ...INITIAL_STATE,
    direct_available_raw: 200000000000000000n,
    aave_exposure_raw: 600000000000000000n,
    total_exposure_raw: 800000000000000000n,
  };
  const active: ExposureReservationDelta[] = [{
    reservation_id: "reservation_a",
    agent_id: "agent_a",
    peak_total_increase_raw: 0n,
    peak_aave_increase_raw: 100000000000000000n,
    required_preexisting_direct_raw: 0n,
    required_preexisting_aave_raw: 0n,
    status: "accepted_reserved",
  }];
  const result = evaluateExposurePlan(overCapState, plan("reduce_aave_exposure", "0.200000000000000000", [
    { kind: "withdraw_aave_to_wallet", units: "0.200000000000000000" },
  ]), POLICY, active);

  assert.equal(result.violations.some((item) => item.code === "reserved_aave_cap_exceeded"), true);
  assert.equal(result.execution_mode, "BLOCKED");
});

test("withdrawal still enforces Aave inventory constraints", () => {
  const lowAaveState: ExposureAccountingState = {
    ...INITIAL_STATE,
    direct_available_raw: 200000000000000000n,
    aave_exposure_raw: 100000000000000000n,
    total_exposure_raw: 300000000000000000n,
  };
  const result = evaluateExposurePlan(lowAaveState, plan("reduce_aave_exposure", "0.200000000000000000", [
    { kind: "withdraw_aave_to_wallet", units: "0.200000000000000000" },
  ]), POLICY);

  assert.equal(result.violations.some((item) => item.code === "aave_inventory_insufficient"), true);
  assert.equal(result.execution_mode, "BLOCKED");
});

test("diagnostic projection continues valid cap violations without authorizing them", () => {
  const canonical = plan("supply_up_to", "0.300000000000000000", [
    { kind: "acquire_wsteth", units: "0.300000000000000000" },
    { kind: "supply_aave", units: "0.300000000000000000" },
  ]);
  const result = evaluateExposurePlan(INITIAL_STATE, canonical, POLICY);

  assert.equal(result.replay_completeness, "STOPPED_ON_VIOLATION");
  assert.deepEqual(result.unevaluated_step_indices, [1]);
  assert.equal(result.final_state.total_exposure_raw, 1100000000000000000n);
  assert.equal(result.diagnostic_projection.status, "COMPLETE");
  assert.equal(result.diagnostic_projection.projected_final_state?.total_exposure_raw, 1100000000000000000n);
  assert.equal(result.diagnostic_projection.projected_final_state?.aave_exposure_raw, 700000000000000000n);
  assert.equal(result.diagnostic_projection.violations.some((item) => item.code === "total_cap_exceeded"), true);
  assert.equal(result.diagnostic_projection.violations.some((item) => item.code === "aave_cap_exceeded"), true);
  assert.equal(result.execution_mode, "BLOCKED");
});

test("diagnostic projection stops at impossible inventory instead of continuing", () => {
  const impossible = plan("supply_up_to", "0.300000000000000000", [
    { kind: "supply_aave", units: "0.500000000000000000" },
    { kind: "acquire_wsteth", units: "0.100000000000000000" },
  ]);
  const result = evaluateExposurePlan(INITIAL_STATE, impossible, POLICY);

  assert.equal(result.diagnostic_projection.status, "UNAVAILABLE");
  assert.equal(result.diagnostic_projection.projected_final_state, null);
  assert.deepEqual(result.diagnostic_projection.unevaluated_step_indices, [0, 1]);
  assert.equal(result.execution_mode, "BLOCKED");
});

test("direct inventory and debt are never hidden by the gross exposure total", () => {
  const direct = replayExposurePlan(INITIAL_STATE, [
    { kind: "supply_aave", units: "0.500000000000000000" },
  ], POLICY);
  assert.equal(direct.violations[0]?.code, "direct_inventory_insufficient");

  const debtState = { ...INITIAL_STATE, debt_raw: 200000000000000000n };
  const supply = replayExposurePlan(debtState, [
    { kind: "supply_aave", units: "0.100000000000000000" },
  ], POLICY);
  assert.equal(supply.final_state.total_exposure_raw, 800000000000000000n);
  assert.equal(supply.final_state.debt_raw, 200000000000000000n);

  const withdrawal = replayExposurePlan(debtState, [
    { kind: "withdraw_aave_to_wallet", units: "0.100000000000000000" },
  ], POLICY);
  assert.equal(withdrawal.violations[0]?.code, "debt_sensitive_withdrawal_unsupported");
});

test("resource requirements retain intermediate peaks and distinguish inventory sources", () => {
  const acquireSupply = replayExposurePlan(INITIAL_STATE, [
    { kind: "acquire_wsteth", units: "0.100000000000000000" },
    { kind: "supply_aave", units: "0.100000000000000000" },
  ], POLICY);
  assert.deepEqual(acquireSupply.resource_requirements, {
    peak_total_increase_raw: 100000000000000000n,
    peak_aave_increase_raw: 100000000000000000n,
    required_preexisting_direct_raw: 0n,
    required_preexisting_aave_raw: 0n,
    internal_acquired_consumed_raw: 100000000000000000n,
  });

  const supplyWithdraw = replayExposurePlan(INITIAL_STATE, [
    { kind: "supply_aave", units: "0.100000000000000000" },
    { kind: "withdraw_aave_to_wallet", units: "0.100000000000000000" },
  ], POLICY);
  assert.equal(supplyWithdraw.final_state.aave_exposure_raw, 400000000000000000n);
  assert.equal(supplyWithdraw.resource_requirements.peak_aave_increase_raw, 100000000000000000n);
  assert.equal(supplyWithdraw.resource_requirements.required_preexisting_direct_raw, 100000000000000000n);
  assert.equal(supplyWithdraw.resource_requirements.required_preexisting_aave_raw, 0n);

  const withdrawalOnly = replayExposurePlan(INITIAL_STATE, [
    { kind: "withdraw_aave_to_wallet", units: "0.150000000000000000" },
  ], POLICY);
  assert.equal(withdrawalOnly.resource_requirements.required_preexisting_aave_raw, 150000000000000000n);

  const excessSupply = replayExposurePlan(INITIAL_STATE, [
    { kind: "acquire_wsteth", units: "0.100000000000000000" },
    { kind: "supply_aave", units: "0.200000000000000000" },
  ], POLICY);
  assert.equal(excessSupply.resource_requirements.internal_acquired_consumed_raw, 100000000000000000n);
  assert.equal(excessSupply.resource_requirements.required_preexisting_direct_raw, 100000000000000000n);
});

test("acquire-only .15 plans contend for .20 shared headroom without Aave increase", () => {
  const firstPlan = plan("acquire_up_to", "0.150000000000000000", [
    { kind: "acquire_wsteth", units: "0.150000000000000000" },
  ]);
  const first = evaluateExposurePlan(INITIAL_STATE, firstPlan, POLICY, [], {
    source_provenance: "FIXTURE",
    paper_session_eligible: true,
    accept_partial: true,
  });
  assert.equal(first.policy_status, "PASS");
  assert.equal(first.goal_status, "FULL");
  assert.equal(first.resource_requirements.peak_total_increase_raw, 150000000000000000n);
  assert.equal(first.resource_requirements.peak_aave_increase_raw, 0n);
  assert.deepEqual(first.violations, []);

  const active: ExposureReservationDelta[] = [{
    reservation_id: "reservation_a",
    agent_id: "agent_a",
    peak_total_increase_raw: first.resource_requirements.peak_total_increase_raw,
    peak_aave_increase_raw: first.resource_requirements.peak_aave_increase_raw,
    required_preexisting_direct_raw: first.resource_requirements.required_preexisting_direct_raw,
    required_preexisting_aave_raw: first.resource_requirements.required_preexisting_aave_raw,
    status: "accepted_reserved",
  }];
  const remainingHeadroom = INITIAL_STATE.dependency_cap_raw
    - INITIAL_STATE.total_exposure_raw
    - first.resource_requirements.peak_total_increase_raw;
  assert.equal(remainingHeadroom, 50000000000000000n);

  const secondPlan: ExposurePlanV1 = { ...firstPlan, agent_id: "agent_b" };
  const second = evaluateExposurePlan(INITIAL_STATE, secondPlan, POLICY, active, {
    source_provenance: "FIXTURE",
    paper_session_eligible: true,
    accept_partial: true,
  });

  assert.equal(second.violations[0]?.code, "reserved_total_cap_exceeded");
  assert.equal(second.violations.some((item) => item.code === "reserved_aave_cap_exceeded"), false);
  assert.equal(second.resource_requirements.peak_aave_increase_raw, 0n);
  assert.equal(second.execution_mode, "BLOCKED");
});

test("evaluation separates policy, goal, provenance, paper eligibility, and real transaction status", () => {
  const repaired = plan("supply_up_to", "0.300000000000000000", [
    { kind: "acquire_wsteth", units: "0.200000000000000000" },
    { kind: "supply_aave", units: "0.100000000000000000" },
  ]);

  const pending = evaluateExposurePlan(INITIAL_STATE, repaired, POLICY, [], {
    source_provenance: "FIXTURE",
    paper_session_eligible: true,
    accept_partial: false,
  });
  assert.equal(pending.policy_status, "PASS");
  assert.equal(pending.goal_status, "PARTIAL");
  assert.equal(pending.paper_eligibility, "INELIGIBLE");
  assert.equal(pending.execution_mode, "BLOCKED");
  assert.equal(pending.real_transaction_status, "UNVERIFIED");
  assert.equal(pending.source_provenance, "FIXTURE");

  const accepted = evaluateExposurePlan(INITIAL_STATE, repaired, POLICY, [], {
    source_provenance: "FIXTURE",
    paper_session_eligible: true,
    accept_partial: true,
  });
  assert.equal(accepted.paper_eligibility, "ELIGIBLE");
  assert.equal(accepted.execution_mode, "PAPER_AUTHORIZABLE");
  assert.equal(accepted.real_transaction_status, "UNVERIFIED");
  assert.equal(accepted.real_transaction_preconditions.includes("purchase_funding_unverified"), true);

  const noSession = evaluateExposurePlan(INITIAL_STATE, repaired, POLICY, [], {
    source_provenance: "LIVE_SOURCE",
    paper_session_eligible: false,
    accept_partial: true,
  });
  assert.equal(noSession.policy_status, "PASS");
  assert.equal(noSession.paper_eligibility, "INELIGIBLE");
  assert.equal(noSession.execution_mode, "BLOCKED");

  const supplyOnly = evaluateExposurePlan(INITIAL_STATE, plan("supply_up_to", "0.100000000000000000", [
    { kind: "supply_aave", units: "0.100000000000000000" },
  ]), POLICY, [], {
    source_provenance: "FIXTURE",
    paper_session_eligible: true,
    accept_partial: true,
  });
  assert.equal(supplyOnly.paper_eligibility, "ELIGIBLE");
  assert.equal(supplyOnly.execution_mode, "PAPER_AUTHORIZABLE");
  assert.equal(supplyOnly.real_transaction_status, "UNVERIFIED");
  assert.equal(supplyOnly.real_transaction_preconditions.includes("aave_supply_approval_and_execution_unverified"), true);
});

test("goal scoring distinguishes full, partial, unsatisfied, and target overshoot", () => {
  const full = evaluateExposurePlan(INITIAL_STATE, plan("acquire_up_to", "0.100000000000000000", [
    { kind: "acquire_wsteth", units: "0.100000000000000000" },
  ]), POLICY);
  assert.equal(full.goal_status, "FULL");

  const partial = evaluateExposurePlan(INITIAL_STATE, plan("acquire_up_to", "0.200000000000000000", [
    { kind: "acquire_wsteth", units: "0.100000000000000000" },
  ]), POLICY);
  assert.equal(partial.goal_status, "PARTIAL");

  const unsatisfied = evaluateExposurePlan(INITIAL_STATE, plan("reduce_total_exposure", "0.100000000000000000", [
    { kind: "withdraw_aave_to_wallet", units: "0.100000000000000000" },
  ]), POLICY);
  assert.equal(unsatisfied.goal_status, "UNSATISFIED");
  assert.equal(unsatisfied.execution_mode, "BLOCKED");

  const overshoot = evaluateExposurePlan(INITIAL_STATE, plan("acquire_up_to", "0.100000000000000000", [
    { kind: "acquire_wsteth", units: "0.200000000000000000" },
  ]), POLICY);
  assert.equal(overshoot.policy_status, "PASS");
  assert.equal(overshoot.violations.some((item) => item.code === "goal_target_overshot"), true);
  assert.equal(overshoot.execution_mode, "BLOCKED");
});
