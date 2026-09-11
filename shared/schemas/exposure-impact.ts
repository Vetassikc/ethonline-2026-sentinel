import type { ExposurePlanV1 } from "./exposure-plan.ts";

export const EXPOSURE_WHAT_IF_SCENARIO = "aave_evidence_unavailable" as const;

export type ExposureWhatIfScenario = typeof EXPOSURE_WHAT_IF_SCENARIO;
export type ExposureImpactSourceMode = "live" | "fixture" | "replay" | "what_if";
export type ExposureImpactProvenance = "LIVE_SOURCE" | "FIXTURE" | "REPLAY" | "MODELED";
export type ExposureDependencyLayer = "economic_exposure" | "data_evidence" | "authorization";
export type ExposureImpactPredicateStatus = "established" | "unavailable" | "blocked";

export type ExposureImpactPredicateOutcome = {
  status: ExposureImpactPredicateStatus;
  reason: string;
};

export type ExposureImpactPermitStatus = "recorded_check" | "not_recorded" | "not_admitted";

export type ExposureDependencyEdge = {
  id: string;
  layer: ExposureDependencyLayer;
  from: string;
  to: string;
  relation: string;
  status: "established" | "modeled" | "hypothetical";
  evidence_ref: string | null;
  explanation: string;
};

export type ExposureImpactSnapshot = {
  display_label: string;
  mode: ExposureImpactSourceMode;
  provenance: ExposureImpactProvenance;
  graph_hash: string;
  block_number: number;
  block_hash: string;
  direct_available_raw: string;
  direct_available_units: string;
  aave_exposure_raw: string | null;
  aave_exposure_units: string | null;
  total_exposure_raw: string | null;
  total_exposure_units: string | null;
  dependency_cap_raw: string;
  dependency_cap_units: string;
  aave_cap_raw: string;
  aave_cap_units: string;
  status: "complete" | "partial_unavailable";
};

export type ExposureImpactLayer = {
  snapshot: ExposureImpactSnapshot;
  predicates: Record<string, ExposureImpactPredicateOutcome>;
};

export type ExposureImpactPlanInput = {
  plan: ExposurePlanV1;
  plan_hash?: string;
  original: {
    policy_status: "PASS" | "VIOLATION" | "BLOCKED";
    goal_status: "FULL" | "PARTIAL" | "UNSATISFIED";
    paper_eligibility: "ELIGIBLE" | "INELIGIBLE";
  };
  reservation_id?: string | null;
  reservation_state?: string | null;
  permit_check_id?: string | null;
};

export type ExposureImpactPlan = {
  original_plan_hash: string;
  agent_id: ExposurePlanV1["agent_id"];
  plan: ExposurePlanV1;
  touches_aave: boolean;
  dependency_scope: "direct_only_shared_total" | "direct_and_aave_shared_total";
  original: ExposureImpactPlanInput["original"] & {
    reservation_status: string;
    permit_status: ExposureImpactPermitStatus;
  };
  simulated: {
    policy_status: "BLOCKED";
    paper_eligibility: "INELIGIBLE";
    reason_codes: string[];
    reservation_status: "would_require_re_evaluation" | "not_admitted";
    permit_status: "would_be_rejected" | "not_admitted";
  };
  reservation_id: string | null;
  permit_check_id: string | null;
  actual_state_changed: false;
};

export type ExposureAffectedReservation = {
  reservation_id: string;
  original_state: string;
  simulated_state: "would_require_re_evaluation";
  actual_state_changed: false;
};

export type ExposureSimulationSession = {
  session_id: string;
  mode: "what_if";
  parent_session_id: string;
  base_evaluation_ref: string;
  base_graph_hash: string;
  reservations_copy: string[];
  simulated_permits_copy: string[];
  revision: number;
};

export type ExposureDependencyImpact = {
  status: "ok";
  mode: "what_if";
  scenario: ExposureWhatIfScenario;
  simulation_session_id: string;
  simulation_session: ExposureSimulationSession;
  original: ExposureImpactLayer;
  simulated: ExposureImpactLayer;
  changed_predicates: Array<{
    predicate: string;
    original: ExposureImpactPredicateOutcome;
    simulated: ExposureImpactPredicateOutcome;
    explanation: string;
  }>;
  unavailable_predicates: string[];
  affected_plans: ExposureImpactPlan[];
  affected_reservations: ExposureAffectedReservation[];
  causal_path: ExposureDependencyEdge[];
  causal_paths: ExposureDependencyEdge[][];
  explanation: string;
  execution_boundary: {
    executable: false;
    code: "SIMULATION_NOT_EXECUTABLE";
    explanation: string;
  };
};
