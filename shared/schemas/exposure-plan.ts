export const EXPOSURE_PLAN_SCHEMA_VERSION = "exposure_plan.v1" as const;

export type ExposureAgentId = "agent_a" | "agent_b";

export type ExposureGoalKind =
  | "acquire_up_to"
  | "supply_up_to"
  | "reduce_aave_exposure"
  | "reduce_total_exposure";

export type ExposurePlanAction =
  | { kind: "acquire_wsteth"; units: string }
  | { kind: "supply_aave"; units: string }
  | { kind: "withdraw_aave_to_wallet"; units: string };

export type ExposurePlanV1 = {
  schema_version: typeof EXPOSURE_PLAN_SCHEMA_VERSION;
  agent_id: ExposureAgentId;
  goal: { kind: ExposureGoalKind; target_units: string };
  steps: ExposurePlanAction[];
};

export type ExposurePlanValidation =
  | { ok: true; plan: ExposurePlanV1 }
  | { ok: false; error: { code: "invalid_exposure_plan"; details: string[] } };
