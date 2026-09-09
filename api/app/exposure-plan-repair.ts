import type { ExposurePlanAction, ExposurePlanV1 } from "../../shared/schemas/exposure-plan.ts";
import { formatFixedUnits, parseFixedUnits } from "./exposure-policy.ts";
import {
  evaluateExposurePlan,
  replayExposurePlan,
  type ExposureAccountingState,
  type ExposurePlanEvaluation,
  type ExposurePlanEvaluationOptions,
  type ExposurePlanPolicy,
  type ExposureReservationDelta,
} from "./exposure-plan-engine.ts";

export type ExposureRepairStatus = "FULL" | "PARTIAL" | "UNSATISFIED" | "NO_SUPPORTED_REPAIR";

export type ExposureRepairResult = {
  status: ExposureRepairStatus;
  repair_algorithm: "left_to_right_max_feasible_v1";
  candidate: ExposurePlanV1 | null;
  evaluation: ExposurePlanEvaluation | null;
  changes: Array<{ step_index: number; requested_units: string; repaired_units: string }>;
};

const REPAIR_ALGORITHM = "left_to_right_max_feasible_v1" as const;
const ZERO_UNITS = "0.000000000000000000";

function repairResult(
  status: ExposureRepairStatus,
  candidate: ExposurePlanV1 | null,
  evaluation: ExposurePlanEvaluation | null,
  changes: Array<{ step_index: number; requested_units: string; repaired_units: string }>,
): ExposureRepairResult {
  return {
    status,
    repair_algorithm: REPAIR_ALGORITHM,
    candidate,
    evaluation,
    changes,
  };
}

function prefixIsFeasible(
  initial: ExposureAccountingState,
  plan: ExposurePlanV1,
  steps: ExposurePlanAction[],
  policy: ExposurePlanPolicy,
  activeReservations: ExposureReservationDelta[],
  target: bigint,
): boolean {
  const replay = replayExposurePlan(initial, steps, policy, activeReservations);
  if (replay.replay_completeness !== "COMPLETE" || replay.violations.length > 0) return false;
  const evaluation = evaluateExposurePlan(initial, {
    ...plan,
    steps,
  }, policy, activeReservations, {
    source_provenance: "FIXTURE",
    paper_session_eligible: true,
    accept_partial: true,
  });
  try {
    return parseFixedUnits(evaluation.fulfilled_units) <= target;
  } catch {
    return false;
  }
}

function minimumWithdrawalQuantity(
  initial: ExposureAccountingState,
  prefix: ExposurePlanAction[],
  policy: ExposurePlanPolicy,
  activeReservations: ExposureReservationDelta[],
): bigint {
  const prefixReplay = replayExposurePlan(initial, prefix, policy, activeReservations);
  if (prefixReplay.replay_completeness !== "COMPLETE" || prefixReplay.violations.length > 0) return 0n;
  try {
    const aaveCap = parseFixedUnits(policy.aave_cap_units);
    return prefixReplay.final_state.aave_exposure_raw > aaveCap
      ? prefixReplay.final_state.aave_exposure_raw - aaveCap
      : 0n;
  } catch {
    return 0n;
  }
}

function maxFeasibleQuantity(
  initial: ExposureAccountingState,
  plan: ExposurePlanV1,
  prefix: ExposurePlanAction[],
  action: ExposurePlanAction,
  policy: ExposurePlanPolicy,
  activeReservations: ExposureReservationDelta[],
  target: bigint,
): bigint {
  let requested: bigint;
  try {
    requested = parseFixedUnits(action.units);
  } catch {
    return 0n;
  }

  const candidateIsFeasible = (quantity: bigint): boolean => prefixIsFeasible(
    initial,
    plan,
    [...prefix, { ...action, units: formatFixedUnits(quantity) } as ExposurePlanAction],
    policy,
    activeReservations,
    target,
  );

  if (action.kind === "withdraw_aave_to_wallet") {
    // Withdrawal feasibility can be a suffix: zero may leave an existing
    // over-cap state invalid, while a larger quantity restores the cap.
    const lower = minimumWithdrawalQuantity(initial, prefix, policy, activeReservations);
    if (lower > requested || !candidateIsFeasible(lower)) return 0n;
    if (candidateIsFeasible(requested)) return requested;

    let low = lower;
    let high = requested;
    while (low < high) {
      const middle = (low + high + 1n) / 2n;
      if (candidateIsFeasible(middle)) {
        low = middle;
      } else {
        high = middle - 1n;
      }
    }
    return low;
  }

  let low = 0n;
  let high = requested;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    if (candidateIsFeasible(middle)) {
      low = middle;
    } else {
      high = middle - 1n;
    }
  }
  return low;
}

export function repairExposurePlan(
  initial: ExposureAccountingState,
  plan: ExposurePlanV1,
  policy: ExposurePlanPolicy,
  activeReservations: ExposureReservationDelta[] = [],
  evaluationOptions: ExposurePlanEvaluationOptions = {},
): ExposureRepairResult {
  if (plan.goal.kind === "reduce_total_exposure") {
    return repairResult("NO_SUPPORTED_REPAIR", null, null, plan.steps.map((step, step_index) => ({
      step_index,
      requested_units: step.units,
      repaired_units: ZERO_UNITS,
    })));
  }

  let target: bigint;
  try {
    target = parseFixedUnits(plan.goal.target_units);
  } catch {
    return repairResult("NO_SUPPORTED_REPAIR", null, null, []);
  }

  const repairedSteps: ExposurePlanAction[] = [];
  const changes: Array<{ step_index: number; requested_units: string; repaired_units: string }> = [];
  for (const [stepIndex, action] of plan.steps.entries()) {
    const repairedRaw = maxFeasibleQuantity(
      initial,
      plan,
      repairedSteps,
      action,
      policy,
      activeReservations,
      target,
    );
    const repairedUnits = formatFixedUnits(repairedRaw);
    if (repairedRaw > 0n) {
      repairedSteps.push({ ...action, units: repairedUnits });
    }
    if (repairedUnits !== action.units) {
      changes.push({
        step_index: stepIndex,
        requested_units: action.units,
        repaired_units: repairedUnits,
      });
    }
  }

  if (repairedSteps.length === 0) {
    return repairResult("NO_SUPPORTED_REPAIR", null, null, changes);
  }

  const candidate: ExposurePlanV1 = {
    ...plan,
    steps: repairedSteps,
  };
  const evaluation = evaluateExposurePlan(
    initial,
    candidate,
    policy,
    activeReservations,
    {
      source_provenance: evaluationOptions.source_provenance ?? "FIXTURE",
      paper_session_eligible: evaluationOptions.paper_session_eligible ?? true,
      accept_partial: evaluationOptions.accept_partial ?? false,
    },
  );
  if (evaluation.violations.length > 0) {
    return repairResult("NO_SUPPORTED_REPAIR", null, null, changes);
  }
  if (evaluation.goal_status === "FULL") return repairResult("FULL", candidate, evaluation, changes);
  if (evaluation.goal_status === "PARTIAL") return repairResult("PARTIAL", candidate, evaluation, changes);
  return repairResult("UNSATISFIED", candidate, evaluation, changes);
}
