import {
  EXPOSURE_PLAN_SCHEMA_VERSION,
  type ExposureAgentId,
  type ExposureGoalKind,
  type ExposurePlanAction,
  type ExposurePlanV1,
  type ExposurePlanValidation,
} from "../../shared/schemas/exposure-plan.ts";
import { parseFixedUnits } from "./exposure-policy.ts";

const AGENT_IDS = new Set<ExposureAgentId>(["agent_a", "agent_b"]);
const GOAL_KINDS = new Set<ExposureGoalKind>([
  "acquire_up_to",
  "supply_up_to",
  "reduce_aave_exposure",
  "reduce_total_exposure",
]);
const ACTION_KINDS = new Set<ExposurePlanAction["kind"]>([
  "acquire_wsteth",
  "supply_aave",
  "withdraw_aave_to_wallet",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function invalid(...details: string[]): ExposurePlanValidation {
  return {
    ok: false,
    error: { code: "invalid_exposure_plan", details },
  };
}

function parsePositiveUnits(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return parseFixedUnits(value) > 0n;
  } catch {
    return false;
  }
}

export function validateExposurePlan(input: unknown): ExposurePlanValidation {
  if (!isRecord(input)) return invalid("root_shape");
  if (!hasExactKeys(input, ["schema_version", "agent_id", "goal", "steps"])) {
    return invalid("root_keys");
  }
  if (input.schema_version !== EXPOSURE_PLAN_SCHEMA_VERSION) return invalid("schema_version");
  if (typeof input.agent_id !== "string" || !AGENT_IDS.has(input.agent_id as ExposureAgentId)) {
    return invalid("agent_id");
  }

  if (!isRecord(input.goal)) return invalid("goal_shape");
  if (!hasExactKeys(input.goal, ["kind", "target_units"])) return invalid("goal_keys");
  if (typeof input.goal.kind !== "string" || !GOAL_KINDS.has(input.goal.kind as ExposureGoalKind)) {
    return invalid("goal_kind");
  }
  if (!parsePositiveUnits(input.goal.target_units)) return invalid("goal_target_units");

  if (!Array.isArray(input.steps)) return invalid("steps_shape");
  if (input.steps.length < 1 || input.steps.length > 3) return invalid("steps_count");

  const steps: ExposurePlanAction[] = [];
  for (const step of input.steps) {
    if (!isRecord(step)) return invalid("step_shape");
    if (!hasExactKeys(step, ["kind", "units"])) return invalid("step_keys");
    if (typeof step.kind !== "string" || !ACTION_KINDS.has(step.kind as ExposurePlanAction["kind"])) {
      return invalid("step_kind");
    }
    if (!parsePositiveUnits(step.units)) return invalid("step_units");
    steps.push({
      kind: step.kind as ExposurePlanAction["kind"],
      units: step.units as string,
    } as ExposurePlanAction);
  }

  return {
    ok: true,
    plan: {
      schema_version: EXPOSURE_PLAN_SCHEMA_VERSION,
      agent_id: input.agent_id as ExposureAgentId,
      goal: {
        kind: input.goal.kind as ExposureGoalKind,
        target_units: input.goal.target_units as string,
      },
      steps,
    },
  };
}
