import { createHash } from "node:crypto";

import type {
  ExposureAgentId,
  ExposureGoalKind,
  ExposurePlanAction,
  ExposurePlanV1,
} from "../../shared/schemas/exposure-plan.ts";
import { formatFixedUnits, parseFixedUnits } from "./exposure-policy.ts";

export type ExposureAccountingState = {
  direct_available_raw: bigint;
  aave_exposure_raw: bigint;
  total_exposure_raw: bigint;
  debt_raw: bigint;
  dependency_cap_raw: bigint;
  aave_cap_raw: bigint;
};

export type ExposurePlanPolicy = {
  policy_version: "exposure-plan-wsteth-v1";
  dependency_cap_units: string;
  aave_cap_units: string;
  unit: "wstETH";
};

export type ExposurePlanResourceRequirements = {
  peak_total_increase_raw: bigint;
  peak_aave_increase_raw: bigint;
  required_preexisting_direct_raw: bigint;
  required_preexisting_aave_raw: bigint;
  internal_acquired_consumed_raw: bigint;
};

export type ExposureReservationDelta = {
  reservation_id: string;
  agent_id: ExposureAgentId;
  peak_total_increase_raw: bigint;
  peak_aave_increase_raw: bigint;
  required_preexisting_direct_raw: bigint;
  required_preexisting_aave_raw: bigint;
  status: "accepted_reserved" | "executing";
};

export type ExposurePolicyStatus = "PASS" | "VIOLATION" | "BLOCKED";
export type ExposureGoalStatus = "FULL" | "PARTIAL" | "UNSATISFIED";
export type ExposureSourceProvenance = "LIVE_SOURCE" | "FIXTURE" | "REPLAY" | "MODELED";
export type ExposurePaperEligibility = "ELIGIBLE" | "INELIGIBLE";
export type ExposureRealTransactionStatus = "NOT_REQUIRED" | "UNVERIFIED" | "BLOCKED";
export type ExposureExecutionMode = "PAPER_AUTHORIZABLE" | "BLOCKED";

export type ExposurePlanEvaluationOptions = {
  source_provenance?: ExposureSourceProvenance;
  paper_session_eligible?: boolean;
  accept_partial?: boolean;
};

export type ExposurePlanViolation = {
  step_index: number;
  code: string;
  before: ExposureAccountingState;
  after: ExposureAccountingState;
};

export type ExposureReplayCompleteness = "COMPLETE" | "STOPPED_ON_VIOLATION" | "INVALID";

export type ExposureDiagnosticProjection = {
  status: "COMPLETE" | "UNAVAILABLE";
  projected_final_state: ExposureAccountingState | null;
  intermediate_states: ExposureAccountingState[];
  violations: ExposurePlanViolation[];
  unevaluated_step_indices: number[];
  reason: string | null;
};

export type ExposureReplayResult = {
  final_state: ExposureAccountingState;
  intermediate_states: ExposureAccountingState[];
  violations: ExposurePlanViolation[];
  replay_completeness: ExposureReplayCompleteness;
  unevaluated_step_indices: number[];
  resource_requirements: ExposurePlanResourceRequirements;
  execution_preconditions: string[];
  real_transaction_preconditions: string[];
};

export type ExposurePlanEvaluation = {
  source_provenance: ExposureSourceProvenance;
  policy_status: ExposurePolicyStatus;
  goal_status: ExposureGoalStatus;
  paper_eligibility: ExposurePaperEligibility;
  real_transaction_status: ExposureRealTransactionStatus;
  execution_mode: ExposureExecutionMode;
  plan_hash: string;
  original_steps: ExposurePlanAction[];
  initial_state: ExposureAccountingState;
  final_state: ExposureAccountingState;
  final_state_semantics: "COMPLETE_REPLAY" | "PARTIAL_REPLAY";
  replay_completeness: ExposureReplayCompleteness;
  unevaluated_step_indices: number[];
  diagnostic_projection: ExposureDiagnosticProjection;
  intermediate_states: ExposureAccountingState[];
  violations: ExposurePlanViolation[];
  fulfilled_units: string;
  target_units: string;
  execution_preconditions: string[];
  real_transaction_preconditions: string[];
  resource_requirements: ExposurePlanResourceRequirements;
};

const ZERO_RESOURCES: ExposurePlanResourceRequirements = {
  peak_total_increase_raw: 0n,
  peak_aave_increase_raw: 0n,
  required_preexisting_direct_raw: 0n,
  required_preexisting_aave_raw: 0n,
  internal_acquired_consumed_raw: 0n,
};

type ResourceTracker = ExposurePlanResourceRequirements & {
  internal_acquired_available_raw: bigint;
  internal_supplied_available_raw: bigint;
  internal_withdrawn_direct_available_raw: bigint;
};

function cloneState(state: ExposureAccountingState): ExposureAccountingState {
  return { ...state };
}

function cloneResources(resources: ExposurePlanResourceRequirements): ExposurePlanResourceRequirements {
  return { ...resources };
}

function publicResources(tracker: ResourceTracker): ExposurePlanResourceRequirements {
  return {
    peak_total_increase_raw: tracker.peak_total_increase_raw,
    peak_aave_increase_raw: tracker.peak_aave_increase_raw,
    required_preexisting_direct_raw: tracker.required_preexisting_direct_raw,
    required_preexisting_aave_raw: tracker.required_preexisting_aave_raw,
    internal_acquired_consumed_raw: tracker.internal_acquired_consumed_raw,
  };
}

function resourceTracker(): ResourceTracker {
  return {
    ...ZERO_RESOURCES,
    internal_acquired_available_raw: 0n,
    internal_supplied_available_raw: 0n,
    internal_withdrawn_direct_available_raw: 0n,
  };
}

function minRaw(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function aaveCapacityBaselineRaw(
  initial: ExposureAccountingState,
  policyCaps: { aave_cap_raw: bigint },
): bigint {
  // Existing over-cap exposure is already a policy condition. It is not new
  // capacity that this plan or another pending plan may reserve.
  return minRaw(initial.aave_exposure_raw, policyCaps.aave_cap_raw);
}

function parsePolicy(policy: ExposurePlanPolicy): { dependency_cap_raw: bigint; aave_cap_raw: bigint } | null {
  if (policy.unit !== "wstETH" || policy.policy_version !== "exposure-plan-wsteth-v1") return null;
  try {
    const dependency_cap_raw = parseFixedUnits(policy.dependency_cap_units);
    const aave_cap_raw = parseFixedUnits(policy.aave_cap_units);
    if (dependency_cap_raw < 0n || aave_cap_raw < 0n) return null;
    return { dependency_cap_raw, aave_cap_raw };
  } catch {
    return null;
  }
}

function initialStateError(state: ExposureAccountingState, policyCaps: { dependency_cap_raw: bigint; aave_cap_raw: bigint } | null): string[] {
  const errors: string[] = [];
  for (const value of [
    state.direct_available_raw,
    state.aave_exposure_raw,
    state.total_exposure_raw,
    state.debt_raw,
    state.dependency_cap_raw,
    state.aave_cap_raw,
  ]) {
    if (value < 0n) errors.push("negative_initial_quantity");
  }
  if (state.total_exposure_raw !== state.direct_available_raw + state.aave_exposure_raw) {
    errors.push("initial_exposure_inconsistent");
  }
  if (policyCaps === null) {
    errors.push("invalid_policy");
  } else {
    if (state.dependency_cap_raw !== policyCaps.dependency_cap_raw) errors.push("dependency_cap_mismatch");
    if (state.aave_cap_raw !== policyCaps.aave_cap_raw) errors.push("aave_cap_mismatch");
  }
  return [...new Set(errors)];
}

function applyAction(state: ExposureAccountingState, action: ExposurePlanAction, quantity: bigint): ExposureAccountingState {
  switch (action.kind) {
    case "acquire_wsteth":
      return {
        ...state,
        direct_available_raw: state.direct_available_raw + quantity,
        total_exposure_raw: state.total_exposure_raw + quantity,
      };
    case "supply_aave":
      return {
        ...state,
        direct_available_raw: state.direct_available_raw - quantity,
        aave_exposure_raw: state.aave_exposure_raw + quantity,
      };
    case "withdraw_aave_to_wallet":
      return {
        ...state,
        direct_available_raw: state.direct_available_raw + quantity,
        aave_exposure_raw: state.aave_exposure_raw - quantity,
      };
  }
}

function trackResources(tracker: ResourceTracker, action: ExposurePlanAction, quantity: bigint): void {
  switch (action.kind) {
    case "acquire_wsteth":
      tracker.internal_acquired_available_raw += quantity;
      break;
    case "supply_aave": {
      const fromAcquired = minRaw(quantity, tracker.internal_acquired_available_raw);
      tracker.internal_acquired_available_raw -= fromAcquired;
      tracker.internal_acquired_consumed_raw += fromAcquired;
      const afterAcquired = quantity - fromAcquired;
      const fromWithdrawn = minRaw(afterAcquired, tracker.internal_withdrawn_direct_available_raw);
      tracker.internal_withdrawn_direct_available_raw -= fromWithdrawn;
      tracker.required_preexisting_direct_raw += afterAcquired - fromWithdrawn;
      tracker.internal_supplied_available_raw += quantity;
      break;
    }
    case "withdraw_aave_to_wallet": {
      const fromSupplied = minRaw(quantity, tracker.internal_supplied_available_raw);
      tracker.internal_supplied_available_raw -= fromSupplied;
      tracker.required_preexisting_aave_raw += quantity - fromSupplied;
      tracker.internal_withdrawn_direct_available_raw += quantity;
      break;
    }
  }
}

function activeResourceTotals(activeReservations: ExposureReservationDelta[]): ExposurePlanResourceRequirements {
  return activeReservations.reduce((total, reservation) => ({
    peak_total_increase_raw: total.peak_total_increase_raw + reservation.peak_total_increase_raw,
    peak_aave_increase_raw: total.peak_aave_increase_raw + reservation.peak_aave_increase_raw,
    required_preexisting_direct_raw: total.required_preexisting_direct_raw + reservation.required_preexisting_direct_raw,
    required_preexisting_aave_raw: total.required_preexisting_aave_raw + reservation.required_preexisting_aave_raw,
    internal_acquired_consumed_raw: total.internal_acquired_consumed_raw,
  }), cloneResources(ZERO_RESOURCES));
}

function stateViolations(
  before: ExposureAccountingState,
  after: ExposureAccountingState,
  stepIndex: number,
  initial: ExposureAccountingState,
  policyCaps: { dependency_cap_raw: bigint; aave_cap_raw: bigint },
  active: ExposurePlanResourceRequirements,
  resources: ExposurePlanResourceRequirements,
): ExposurePlanViolation[] {
  const codes: string[] = [];
  if (after.direct_available_raw < 0n) codes.push("direct_inventory_insufficient");
  if (after.aave_exposure_raw < 0n) codes.push("aave_inventory_insufficient");
  if (after.aave_exposure_raw > policyCaps.aave_cap_raw) codes.push("aave_cap_exceeded");
  if (after.total_exposure_raw < 0n) codes.push("negative_total_exposure");
  if (after.total_exposure_raw > policyCaps.dependency_cap_raw) codes.push("total_cap_exceeded");
  if (after.total_exposure_raw !== after.direct_available_raw + after.aave_exposure_raw) {
    codes.push("exposure_conservation_broken");
  }
  if (active.peak_total_increase_raw + resources.peak_total_increase_raw
      + initial.total_exposure_raw > policyCaps.dependency_cap_raw) {
    codes.push("reserved_total_cap_exceeded");
  }
  if (active.peak_aave_increase_raw + resources.peak_aave_increase_raw
      + aaveCapacityBaselineRaw(initial, policyCaps) > policyCaps.aave_cap_raw) {
    codes.push("reserved_aave_cap_exceeded");
  }
  if (active.required_preexisting_direct_raw + resources.required_preexisting_direct_raw
      > initial.direct_available_raw) {
    codes.push("reserved_direct_inventory_exceeded");
  }
  if (active.required_preexisting_aave_raw + resources.required_preexisting_aave_raw
      > initial.aave_exposure_raw) {
    codes.push("reserved_aave_inventory_exceeded");
  }
  return codes.map((code) => ({
    step_index: stepIndex,
    code,
    before: cloneState(before),
    after: cloneState(after),
  }));
}

function progressForGoal(
  goal: ExposureGoalKind,
  initial: ExposureAccountingState,
  current: ExposureAccountingState,
): bigint {
  switch (goal) {
    case "acquire_up_to":
      return current.total_exposure_raw > initial.total_exposure_raw
        ? current.total_exposure_raw - initial.total_exposure_raw
        : 0n;
    case "supply_up_to":
      return current.aave_exposure_raw > initial.aave_exposure_raw
        ? current.aave_exposure_raw - initial.aave_exposure_raw
        : 0n;
    case "reduce_aave_exposure":
      return initial.aave_exposure_raw > current.aave_exposure_raw
        ? initial.aave_exposure_raw - current.aave_exposure_raw
        : 0n;
    case "reduce_total_exposure":
      return initial.total_exposure_raw > current.total_exposure_raw
        ? initial.total_exposure_raw - current.total_exposure_raw
        : 0n;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function planHash(plan: ExposurePlanV1): string {
  return createHash("sha256").update(canonicalJson(plan)).digest("hex");
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function remainingStepIndices(steps: ExposurePlanAction[], fromIndex: number): number[] {
  return steps.map((_, index) => index).filter((index) => index >= fromIndex);
}

function diagnosticViolationCodes(
  after: ExposureAccountingState,
  policyCaps: { dependency_cap_raw: bigint; aave_cap_raw: bigint },
): string[] {
  const codes: string[] = [];
  if (after.direct_available_raw < 0n) codes.push("direct_inventory_insufficient");
  if (after.aave_exposure_raw < 0n) codes.push("aave_inventory_insufficient");
  if (after.aave_exposure_raw > policyCaps.aave_cap_raw) codes.push("aave_cap_exceeded");
  if (after.total_exposure_raw < 0n) codes.push("negative_total_exposure");
  if (after.total_exposure_raw > policyCaps.dependency_cap_raw) codes.push("total_cap_exceeded");
  if (after.total_exposure_raw !== after.direct_available_raw + after.aave_exposure_raw) {
    codes.push("exposure_conservation_broken");
  }
  return codes;
}

function isSupportedAction(action: ExposurePlanAction): boolean {
  return action.kind === "acquire_wsteth"
    || action.kind === "supply_aave"
    || action.kind === "withdraw_aave_to_wallet";
}

function unavailableProjection(
  steps: ExposurePlanAction[],
  reason: string,
  intermediateStates: ExposureAccountingState[],
  violations: ExposurePlanViolation[],
  fromIndex: number,
): ExposureDiagnosticProjection {
  return {
    status: "UNAVAILABLE",
    projected_final_state: null,
    intermediate_states: intermediateStates,
    violations,
    unevaluated_step_indices: remainingStepIndices(steps, fromIndex),
    reason,
  };
}

/**
 * Project every step for explanation only. This deliberately ignores
 * authorization reservations and continues through cap-only violations, but
 * stops before claiming a projection when inventory or action semantics fail.
 */
export function projectExposurePlan(
  initial: ExposureAccountingState,
  steps: ExposurePlanAction[],
  policy: ExposurePlanPolicy,
): ExposureDiagnosticProjection {
  const policyCaps = parsePolicy(policy);
  const errors = initialStateError(initial, policyCaps);
  if (errors.length > 0 || policyCaps === null) {
    return unavailableProjection(steps, errors[0] ?? "invalid_policy", [], [], 0);
  }

  const intermediateStates: ExposureAccountingState[] = [];
  const violations: ExposurePlanViolation[] = [];
  let current = cloneState(initial);

  for (const [stepIndex, action] of steps.entries()) {
    let quantity: bigint;
    try {
      quantity = parseFixedUnits(action.units);
    } catch {
      const before = cloneState(current);
      violations.push({ step_index: stepIndex, code: "invalid_step_quantity", before, after: before });
      return unavailableProjection(steps, "invalid_step_quantity", intermediateStates, violations, stepIndex);
    }

    if (!isSupportedAction(action)) {
      const before = cloneState(current);
      violations.push({ step_index: stepIndex, code: "unsupported_action", before, after: before });
      return unavailableProjection(steps, "unsupported_action", intermediateStates, violations, stepIndex);
    }
    if (action.kind === "withdraw_aave_to_wallet" && current.debt_raw > 0n) {
      const before = cloneState(current);
      violations.push({
        step_index: stepIndex,
        code: "debt_sensitive_withdrawal_unsupported",
        before,
        after: before,
      });
      return unavailableProjection(
        steps,
        "debt_sensitive_withdrawal_unsupported",
        intermediateStates,
        violations,
        stepIndex,
      );
    }

    const before = cloneState(current);
    const after = applyAction(current, action, quantity);
    const codes = diagnosticViolationCodes(after, policyCaps);
    for (const code of codes) {
      violations.push({ step_index: stepIndex, code, before, after: cloneState(after) });
    }
    const hardCodes = codes.filter((code) => code !== "total_cap_exceeded" && code !== "aave_cap_exceeded");
    if (hardCodes.length > 0) {
      return unavailableProjection(steps, hardCodes[0]!, intermediateStates, violations, stepIndex);
    }

    current = after;
    intermediateStates.push(cloneState(current));
  }

  return {
    status: "COMPLETE",
    projected_final_state: cloneState(current),
    intermediate_states: intermediateStates,
    violations,
    unevaluated_step_indices: [],
    reason: null,
  };
}

export function replayExposurePlan(
  initial: ExposureAccountingState,
  steps: ExposurePlanAction[],
  policy: ExposurePlanPolicy,
  activeReservations: ExposureReservationDelta[] = [],
): ExposureReplayResult {
  const policyCaps = parsePolicy(policy);
  const errors = initialStateError(initial, policyCaps);
  const executionPreconditions: string[] = [];
  const realTransactionPreconditions: string[] = [];
  const intermediateStates: ExposureAccountingState[] = [];
  const violations: ExposurePlanViolation[] = [];
  const tracker = resourceTracker();
  const active = activeResourceTotals(activeReservations.filter((reservation) =>
    reservation.status === "accepted_reserved" || reservation.status === "executing"));
  let current = cloneState(initial);
  let replayCompleteness: ExposureReplayCompleteness = "COMPLETE";
  let unevaluatedStepIndices: number[] = [];

  if (errors.length > 0 || policyCaps === null) {
    for (const code of errors) {
      violations.push({ step_index: -1, code, before: cloneState(initial), after: cloneState(initial) });
    }
    return {
      final_state: current,
      intermediate_states: intermediateStates,
      violations,
      replay_completeness: "INVALID",
      unevaluated_step_indices: remainingStepIndices(steps, 0),
      resource_requirements: publicResources(tracker),
      execution_preconditions: ["invalid_initial_state_or_policy"],
      real_transaction_preconditions: realTransactionPreconditions,
    };
  }

  for (const [stepIndex, action] of steps.entries()) {
    let quantity: bigint;
    try {
      quantity = parseFixedUnits(action.units);
    } catch {
      violations.push({ step_index: stepIndex, code: "invalid_step_quantity", before: cloneState(current), after: cloneState(current) });
      addUnique(executionPreconditions, "invalid_step_quantity");
      replayCompleteness = "INVALID";
      unevaluatedStepIndices = remainingStepIndices(steps, stepIndex);
      break;
    }
    if (!isSupportedAction(action)) {
      violations.push({ step_index: stepIndex, code: "unsupported_action", before: cloneState(current), after: cloneState(current) });
      addUnique(executionPreconditions, "unsupported_action");
      replayCompleteness = "INVALID";
      unevaluatedStepIndices = remainingStepIndices(steps, stepIndex);
      break;
    }
    trackResources(tracker, action, quantity);
    if (action.kind === "acquire_wsteth") addUnique(realTransactionPreconditions, "purchase_funding_unverified");
    if (action.kind === "supply_aave") addUnique(realTransactionPreconditions, "aave_supply_approval_and_execution_unverified");
    if (action.kind === "withdraw_aave_to_wallet") addUnique(realTransactionPreconditions, "aave_liquidity_and_health_unverified");

    const before = cloneState(current);
    if (action.kind === "withdraw_aave_to_wallet" && current.debt_raw > 0n) {
      violations.push({
        step_index: stepIndex,
        code: "debt_sensitive_withdrawal_unsupported",
        before,
        after: cloneState(current),
      });
      addUnique(executionPreconditions, "debt_sensitive_withdrawal_unsupported");
      intermediateStates.push(cloneState(current));
      replayCompleteness = "STOPPED_ON_VIOLATION";
      unevaluatedStepIndices = remainingStepIndices(steps, stepIndex + 1);
      break;
    }

    const after = applyAction(current, action, quantity);
    const totalIncrease = after.total_exposure_raw - initial.total_exposure_raw;
    if (totalIncrease > tracker.peak_total_increase_raw) tracker.peak_total_increase_raw = totalIncrease;
    const aaveIncrease = after.aave_exposure_raw - initial.aave_exposure_raw;
    if (aaveIncrease > tracker.peak_aave_increase_raw) tracker.peak_aave_increase_raw = aaveIncrease;
    const currentResources = publicResources(tracker);
    const stepViolations = stateViolations(before, after, stepIndex, initial, policyCaps, active, currentResources);
    current = after;
    intermediateStates.push(cloneState(current));
    violations.push(...stepViolations);
    if (stepViolations.length > 0) {
      for (const violation of stepViolations) addUnique(executionPreconditions, violation.code);
      replayCompleteness = "STOPPED_ON_VIOLATION";
      unevaluatedStepIndices = remainingStepIndices(steps, stepIndex + 1);
      break;
    }
  }

  return {
    final_state: current,
    intermediate_states: intermediateStates,
    violations,
    replay_completeness: replayCompleteness,
    unevaluated_step_indices: unevaluatedStepIndices,
    resource_requirements: publicResources(tracker),
    execution_preconditions: executionPreconditions,
    real_transaction_preconditions: realTransactionPreconditions,
  };
}

function policyStatus(replay: ExposureReplayResult): ExposurePolicyStatus {
  const policyViolations = replay.violations.filter((violation) => violation.code !== "goal_target_overshot");
  if (policyViolations.some((violation) => [
    "negative_initial_quantity",
    "initial_exposure_inconsistent",
    "invalid_policy",
    "dependency_cap_mismatch",
    "aave_cap_mismatch",
    "debt_sensitive_withdrawal_unsupported",
    "unsupported_action",
    "invalid_step_quantity",
  ].includes(violation.code))) return "BLOCKED";
  if (policyViolations.length > 0) return "VIOLATION";
  return "PASS";
}

function goalStatus(progress: bigint, target: bigint): ExposureGoalStatus {
  if (progress === 0n) return "UNSATISFIED";
  if (progress >= target) return "FULL";
  return "PARTIAL";
}

function appendGoalOvershoot(
  replay: ExposureReplayResult,
  plan: ExposurePlanV1,
  initial: ExposureAccountingState,
  target: bigint,
): void {
  for (const [index, state] of replay.intermediate_states.entries()) {
    if (progressForGoal(plan.goal.kind, initial, state) > target) {
      const before = index === 0 ? initial : replay.intermediate_states[index - 1]!;
      replay.violations.push({
        step_index: index,
        code: "goal_target_overshot",
        before: cloneState(before),
        after: cloneState(state),
      });
      addUnique(replay.execution_preconditions, "goal_target_overshot");
      return;
    }
  }
}

export function evaluateExposurePlan(
  initial: ExposureAccountingState,
  plan: ExposurePlanV1,
  policy: ExposurePlanPolicy,
  activeReservations: ExposureReservationDelta[] = [],
  options: ExposurePlanEvaluationOptions = {},
): ExposurePlanEvaluation {
  let target: bigint;
  try {
    target = parseFixedUnits(plan.goal.target_units);
  } catch {
    target = 0n;
  }
  const replay = replayExposurePlan(initial, plan.steps, policy, activeReservations);
  const diagnosticProjection = projectExposurePlan(initial, plan.steps, policy);
  appendGoalOvershoot(replay, plan, initial, target);
  const progress = progressForGoal(plan.goal.kind, initial, replay.final_state);
  const status = policyStatus(replay);
  const satisfaction = goalStatus(progress, target);
  const sourceProvenance = options.source_provenance ?? "FIXTURE";
  const paperSessionEligible = options.paper_session_eligible !== false;
  const acceptedPartial = options.accept_partial === true;
  const hasGoalOvershoot = replay.violations.some((violation) => violation.code === "goal_target_overshot");
  const hasUnsupported = replay.violations.some((violation) => [
    "negative_initial_quantity",
    "initial_exposure_inconsistent",
    "invalid_policy",
    "dependency_cap_mismatch",
    "aave_cap_mismatch",
    "debt_sensitive_withdrawal_unsupported",
    "unsupported_action",
    "invalid_step_quantity",
  ].includes(violation.code));
  const realTransactionStatus: ExposureRealTransactionStatus = hasUnsupported
    ? "BLOCKED"
    : replay.real_transaction_preconditions.length > 0 ? "UNVERIFIED" : "NOT_REQUIRED";
  const executionPreconditions = [...replay.execution_preconditions];
  if (status !== "PASS") addUnique(executionPreconditions, "policy_not_pass");
  if (satisfaction === "UNSATISFIED") addUnique(executionPreconditions, "goal_unsatisfied");
  if (satisfaction === "PARTIAL" && !acceptedPartial) addUnique(executionPreconditions, "partial_requires_operator_acceptance");
  if (!paperSessionEligible) addUnique(executionPreconditions, "paper_session_ineligible");
  const eligible = status === "PASS"
    && !hasGoalOvershoot
    && !hasUnsupported
    && satisfaction !== "UNSATISFIED"
    && (satisfaction === "FULL" || acceptedPartial)
    && paperSessionEligible;

  return {
    source_provenance: sourceProvenance,
    policy_status: status,
    goal_status: satisfaction,
    paper_eligibility: eligible ? "ELIGIBLE" : "INELIGIBLE",
    real_transaction_status: realTransactionStatus,
    execution_mode: eligible ? "PAPER_AUTHORIZABLE" : "BLOCKED",
    plan_hash: planHash(plan),
    original_steps: plan.steps.map((step) => ({ ...step })),
    initial_state: cloneState(initial),
    final_state: cloneState(replay.final_state),
    final_state_semantics: replay.replay_completeness === "COMPLETE" ? "COMPLETE_REPLAY" : "PARTIAL_REPLAY",
    replay_completeness: replay.replay_completeness,
    unevaluated_step_indices: [...replay.unevaluated_step_indices],
    diagnostic_projection: diagnosticProjection,
    intermediate_states: replay.intermediate_states.map(cloneState),
    violations: replay.violations,
    fulfilled_units: formatFixedUnits(progress),
    target_units: plan.goal.target_units,
    execution_preconditions: executionPreconditions,
    real_transaction_preconditions: replay.real_transaction_preconditions,
    resource_requirements: replay.resource_requirements,
  };
}
