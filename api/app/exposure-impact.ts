import { createHash, randomUUID } from "node:crypto";

import type {
  ExposureEvaluation,
  ExposureMode,
} from "../../shared/schemas/exposure-graph.ts";
import type {
  ExposureDependencyEdge,
  ExposureDependencyImpact,
  ExposureImpactLayer,
  ExposureImpactPlan,
  ExposureImpactPlanInput,
  ExposureImpactProvenance,
  ExposureImpactSnapshot,
  ExposureImpactSourceMode,
  ExposureSimulationSession,
  ExposureWhatIfScenario,
} from "../../shared/schemas/exposure-impact.ts";
import type {
  ExposureAccountingState,
  ExposurePlanPolicy,
  ExposureSourceProvenance,
} from "./exposure-plan-engine.ts";
import { formatFixedUnits } from "./exposure-policy.ts";

export type ExposureImpactBuildInput = {
  evaluation_ref: string;
  evaluation: ExposureEvaluation;
  accounting_state: ExposureAccountingState;
  policy: ExposurePlanPolicy;
  source: {
    mode: ExposureMode;
    provenance: ExposureSourceProvenance;
    graph_hash: string;
    block_number: number;
    block_hash: string;
  };
  plans: ExposureImpactPlanInput[];
  parent_session_id?: string;
  scenario: ExposureWhatIfScenario;
};

function planCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(planCanonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${planCanonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function planHash(plan: ExposureImpactPlanInput["plan"]): string {
  return createHash("sha256").update(planCanonicalJson(plan)).digest("hex");
}

function actualDisplayLabel(provenance: ExposureImpactProvenance): string {
  if (provenance === "LIVE_SOURCE") return "LIVE SOURCE";
  if (provenance === "FIXTURE") return "FIXTURE";
  if (provenance === "REPLAY") return "REPLAY";
  return "MODELED";
}

function sourceMode(mode: ExposureMode): ExposureImpactSourceMode {
  return mode;
}

function snapshot(
  input: ExposureImpactBuildInput,
  options: { simulated: boolean },
): ExposureImpactSnapshot {
  const state = input.accounting_state;
  const provenance = input.source.provenance as ExposureImpactProvenance;
  return {
    display_label: options.simulated ? "WHAT-IF / SIMULATION" : actualDisplayLabel(provenance),
    mode: options.simulated ? "what_if" : sourceMode(input.source.mode),
    // The hypothetical overlay retains the base provenance; its display mode
    // is what-if and never relabels fixture evidence as live evidence.
    provenance,
    graph_hash: input.source.graph_hash,
    block_number: input.source.block_number,
    block_hash: input.source.block_hash,
    direct_available_raw: state.direct_available_raw.toString(),
    direct_available_units: formatFixedUnits(state.direct_available_raw),
    aave_exposure_raw: options.simulated ? null : state.aave_exposure_raw.toString(),
    aave_exposure_units: options.simulated ? null : formatFixedUnits(state.aave_exposure_raw),
    total_exposure_raw: options.simulated ? null : state.total_exposure_raw.toString(),
    total_exposure_units: options.simulated ? null : formatFixedUnits(state.total_exposure_raw),
    dependency_cap_raw: state.dependency_cap_raw.toString(),
    dependency_cap_units: formatFixedUnits(state.dependency_cap_raw),
    aave_cap_raw: state.aave_cap_raw.toString(),
    aave_cap_units: formatFixedUnits(state.aave_cap_raw),
    status: options.simulated ? "partial_unavailable" : "complete",
  };
}

function predicateLayer(simulated: boolean): Record<string, { status: "established" | "unavailable"; reason: string }> {
  return {
    aave_evidence: simulated
      ? { status: "unavailable", reason: "aave_evidence_unavailable" }
      : { status: "established", reason: "aave_user_reserve_available" },
    total_exposure_cap: simulated
      ? { status: "unavailable", reason: "aave_evidence_unavailable" }
      : { status: "established", reason: "aave_user_reserve_available" },
  };
}

function touchesAave(plan: ExposureImpactPlanInput["plan"]): boolean {
  return plan.goal.kind === "supply_up_to"
    || plan.goal.kind === "reduce_aave_exposure"
    || plan.steps.some((step) => step.kind === "supply_aave" || step.kind === "withdraw_aave_to_wallet");
}

function planImpact(input: ExposureImpactPlanInput): ExposureImpactPlan {
  const hash = input.plan_hash ?? planHash(input.plan);
  const reservationId = input.reservation_id ?? null;
  const permitCheckId = input.permit_check_id ?? null;
  const reservationStatus = reservationId ? "accepted_reserved" : "not_admitted";
  const permitStatus = permitCheckId
    ? "recorded_check"
    : reservationId
      ? "not_recorded"
      : "not_admitted";
  return {
    original_plan_hash: hash,
    agent_id: input.plan.agent_id,
    plan: {
      schema_version: input.plan.schema_version,
      agent_id: input.plan.agent_id,
      goal: { ...input.plan.goal },
      steps: input.plan.steps.map((step) => ({ ...step })),
    },
    touches_aave: touchesAave(input.plan),
    dependency_scope: touchesAave(input.plan)
      ? "direct_and_aave_shared_total"
      : "direct_only_shared_total",
    original: {
      ...input.original,
      reservation_status: input.reservation_state ?? reservationStatus,
      permit_status: permitStatus,
    },
    simulated: {
      policy_status: "BLOCKED",
      paper_eligibility: "INELIGIBLE",
      reason_codes: ["total_exposure_cap_unavailable", "aave_evidence_unavailable"],
      reservation_status: reservationId ? "would_require_re_evaluation" : "not_admitted",
      permit_status: permitCheckId
        ? "would_be_rejected"
        : reservationId
          ? "hypothetical_boundary"
          : "not_admitted",
    },
    reservation_id: reservationId,
    permit_check_id: permitCheckId,
    actual_state_changed: false,
  };
}

function causalPath(
  evaluationRef: string,
  plans: ExposureImpactPlan[],
): ExposureDependencyEdge[][] {
  const base: ExposureDependencyEdge[] = [
    {
      id: "edge:aave-evidence-total-cap",
      layer: "data_evidence",
      from: "aave_evidence",
      to: "total_exposure_cap",
      relation: "establishes",
      status: "hypothetical",
      evidence_ref: evaluationRef,
      explanation: "The total exposure predicate depends on the Aave UserReserve evidence path.",
    },
  ];
  return plans.length === 0
    ? [base]
    : plans.map((plan, index) => {
        const planNode = plan.original_plan_hash;
        const reservationNode = plan.reservation_id ?? `reservation_not_admitted_${index + 1}`;
        const permitNode = plan.permit_check_id ?? `permit_not_admitted_${index + 1}`;
        return [
          ...base,
          {
            id: `edge:total-cap-plan:${index}`,
            layer: "economic_exposure",
            from: "total_exposure_cap",
            to: planNode,
            relation: "guards",
            status: "established",
            evidence_ref: evaluationRef,
            explanation: "The proposed plan relies on the shared total exposure predicate.",
          },
          {
            id: `edge:plan-reservation:${index}`,
            layer: "authorization",
            from: planNode,
            to: reservationNode,
            relation: "reserved_by",
            status: plan.reservation_id ? "established" : "hypothetical",
            evidence_ref: plan.reservation_id,
            explanation: plan.reservation_id
              ? "An existing reservation is copied for analysis only; its live state is unchanged."
              : "No reservation exists; this is a hypothetical admission boundary.",
          },
          {
            id: `edge:reservation-permit:${index}`,
            layer: "authorization",
            from: reservationNode,
            to: permitNode,
            relation: "checked_by",
            status: plan.permit_check_id ? "established" : "hypothetical",
            evidence_ref: plan.permit_check_id,
            explanation: plan.permit_check_id
              ? "An actually recorded permit check is copied for analysis and cannot authorize execution."
              : "No permit-check evidence is recorded in this analysis; issuance/check history is not established.",
          },
        ];
      });
}

function simulationSession(
  input: ExposureImpactBuildInput,
  plans: ExposureImpactPlan[],
): ExposureSimulationSession {
  const reservations = plans.flatMap((plan) => plan.reservation_id ? [plan.reservation_id] : []);
  const permits = plans.flatMap((plan) => plan.permit_check_id ? [plan.permit_check_id] : []);
  return {
    session_id: `simulation_${randomUUID().replaceAll("-", "")}`,
    mode: "what_if",
    parent_session_id: input.parent_session_id ?? `evaluation_${createHash("sha256").update(input.evaluation_ref).digest("hex").slice(0, 24)}`,
    base_evaluation_ref: input.evaluation_ref,
    base_graph_hash: input.source.graph_hash,
    reservations_copy: [...reservations],
    simulated_permits_copy: [...permits],
    revision: 1,
  };
}

function layer(input: ExposureImpactBuildInput, simulated: boolean): ExposureImpactLayer {
  return {
    snapshot: snapshot(input, { simulated }),
    predicates: predicateLayer(simulated),
  };
}

export function buildExposureDependencyImpact(input: ExposureImpactBuildInput): ExposureDependencyImpact {
  if (input.scenario !== "aave_evidence_unavailable") {
    throw new Error("unsupported_exposure_what_if_scenario");
  }
  const affectedPlans = input.plans.map(planImpact);
  const causalPaths = causalPath(input.evaluation_ref, affectedPlans);
  const session = simulationSession(input, affectedPlans);
  const original = layer(input, false);
  const simulated = layer(input, true);
  const changedPredicate = {
    predicate: "total_exposure_cap",
    original: original.predicates.total_exposure_cap!,
    simulated: simulated.predicates.total_exposure_cap!,
    explanation: "The total exposure predicate depends on the Aave UserReserve evidence path.",
  };
  return {
    status: "ok",
    mode: "what_if",
    scenario: input.scenario,
    simulation_session_id: session.session_id,
    simulation_session: session,
    original,
    simulated,
    changed_predicates: [changedPredicate],
    unavailable_predicates: ["aave_evidence", "total_exposure_cap"],
    affected_plans: affectedPlans,
    affected_reservations: affectedPlans
      .filter((plan) => plan.reservation_id !== null && plan.original.reservation_status !== "not_admitted")
      .map((plan) => ({
        reservation_id: plan.reservation_id!,
        original_state: plan.original.reservation_status,
        simulated_state: "would_require_re_evaluation" as const,
        actual_state_changed: false as const,
      })),
    causal_path: causalPaths[0] ?? [],
    causal_paths: causalPaths,
    explanation: "Without the Aave evidence path, the shared total exposure predicate is unavailable. This affects Aave-touching plans and direct-only plans that rely on the same total-cap check.",
    execution_boundary: {
      executable: false,
      code: "SIMULATION_NOT_EXECUTABLE",
      explanation: "A cryptographically valid permit is not sufficient permission to execute under changed current conditions.",
    },
  };
}
