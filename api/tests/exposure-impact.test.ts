import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExposureDependencyImpact,
  type ExposureImpactPlanInput,
} from "../app/exposure-impact.ts";
import {
  createExposureRuntimeState,
  type StoredExposureEvaluation,
} from "../app/exposure-service.ts";
import {
  evaluateExposurePlanRequest,
  issueExposurePlanFixtureReference,
} from "../app/exposure-plan-service.ts";
import {
  acceptExposurePlanForOperator,
  createExposurePlanOperatorSession,
  executeExposurePlanReservation,
  getExposurePlanAuthorizationRuntime,
  issueExposurePlanPermitForReservation,
} from "../app/exposure-plan-authorization.ts";
import { issueExposurePlanPermit } from "../app/exposure-plan-permit.ts";
import { handleJudgeModeRequest } from "../app/server.ts";
import type { ExposureEvaluation } from "../../shared/schemas/exposure-graph.ts";
import type { ExposurePlanV1 } from "../../shared/schemas/exposure-plan.ts";

const NOW = new Date("2026-09-09T10:00:00.000Z");
const REF = `exposure_${"ab".repeat(16)}`;
const GRAPH_HASH = `0x${"22".repeat(32)}`;
const BLOCK_HASH = `0x${"11".repeat(32)}`;
const ACCOUNT = "0x9999999999999999999999999999999999999999";

const CANONICAL_PLAN: ExposurePlanV1 = {
  schema_version: "exposure_plan.v1",
  agent_id: "agent_a",
  goal: { kind: "supply_up_to", target_units: "0.300000000000000000" },
  steps: [
    { kind: "acquire_wsteth", units: "0.300000000000000000" },
    { kind: "supply_aave", units: "0.300000000000000000" },
  ],
};

const DIRECT_ONLY_PLAN: ExposurePlanV1 = {
  schema_version: "exposure_plan.v1",
  agent_id: "agent_b",
  goal: { kind: "acquire_up_to", target_units: "0.100000000000000000" },
  steps: [{ kind: "acquire_wsteth", units: "0.100000000000000000" }],
};

function evaluation(): ExposureEvaluation {
  return {
    schema_version: "exposure_evaluation.v1",
    mode: "fixture",
    request: {
      schema_version: "sentinel-exposure-buy.v1",
      action: "BUY_EXPOSURE",
      asset: "wstETH",
      unit: "wstETH",
      requested_units: "0.300000000000000000",
    },
    graph: {
      schema_version: "exposure_graph.v1",
      mode: "fixture",
      source_status: "ok",
      subject: { account: ACCOUNT, chain_id: 8453 },
      source: {
        graph_subgraph_id: "fixture-subgraph",
        graph_endpoint: "fixture://sentinel-exposure-graph",
        rpc_endpoint: "fixture://base-rpc",
        block: { number: 1_000_001, hash: BLOCK_HASH, timestamp: 1_788_800_000 },
      },
      nodes: [],
      edges: [],
      paths: [
        {
          id: "path:fixture:direct",
          kind: "direct_holding",
          unit: "wstETH",
          asset_id: "asset:fixture:wsteth",
          raw_quantity: "400000000000000000",
          decimal_quantity: "0.400000000000000000",
          decimals: 18,
          capital_contribution: true,
          representation_of: "asset:fixture:wsteth",
          edge_ids: [],
        },
        {
          id: "path:fixture:aave",
          kind: "aave_supply",
          unit: "wstETH",
          asset_id: "asset:fixture:wsteth",
          raw_quantity: "400000000000000000",
          decimal_quantity: "0.400000000000000000",
          decimals: 18,
          capital_contribution: true,
          representation_of: "asset:fixture:wsteth",
          edge_ids: [],
        },
      ],
      debt: [],
      gaps: ["usd_valuation_unavailable"],
      graph_hash: GRAPH_HASH,
    },
    policy: {
      verdict: "DENY",
      requested_units: "0.300000000000000000",
      allowed_units: "0.000000000000000000",
      dependency_cap_units: "1.000000000000000000",
      gross_exposure_units: "0.800000000000000000",
      headroom_units: "0.200000000000000000",
      binding_constraint: "dependency_cap",
      policy_version: "exposure-wsteth-v1",
      unit: "wstETH",
      reason_codes: ["fixture_source_for_plan_review"],
      debt_units: "0.000000000000000000",
    },
    created_at: NOW.toISOString(),
    expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
  };
}

function impactInput(
  storedEvaluation: ExposureEvaluation = evaluation(),
  plans: ExposureImpactPlanInput[] = [],
) {
  return {
    evaluation_ref: REF,
    evaluation: storedEvaluation,
    policy: {
      policy_version: "exposure-plan-wsteth-v1" as const,
      dependency_cap_units: "1.000000000000000000",
      aave_cap_units: "0.500000000000000000",
      unit: "wstETH" as const,
    },
    accounting_state: {
      direct_available_raw: 400000000000000000n,
      aave_exposure_raw: 400000000000000000n,
      total_exposure_raw: 800000000000000000n,
      debt_raw: 0n,
      dependency_cap_raw: 1000000000000000000n,
      aave_cap_raw: 500000000000000000n,
    },
    source: {
      mode: "fixture" as const,
      provenance: "FIXTURE" as const,
      graph_hash: storedEvaluation.graph.graph_hash,
      block_number: storedEvaluation.graph.source.block.number,
      block_hash: storedEvaluation.graph.source.block.hash,
    },
    plans,
    parent_session_id: "evaluation_context_fixture",
    scenario: "aave_evidence_unavailable" as const,
  };
}

function planInput(plan: ExposurePlanV1, options: Partial<ExposureImpactPlanInput> = {}): ExposureImpactPlanInput {
  return {
    plan,
    original: {
      policy_status: "PASS",
      goal_status: "FULL",
      paper_eligibility: "ELIGIBLE",
    },
    ...options,
  };
}

function storedState(stored: ExposureEvaluation = evaluation(), expiresAtMs = NOW.getTime() + 60_000) {
  const state = createExposureRuntimeState();
  const storedEvaluation: StoredExposureEvaluation = {
    evaluation: stored,
    expires_at_ms: expiresAtMs,
  };
  state.evaluations.set(REF, storedEvaluation);
  return state;
}

test("Aave evidence outage changes the total predicate and propagates to Aave and direct-only plans", () => {
  const acceptedReservation = planInput(CANONICAL_PLAN, {
    reservation_id: "reservation_a",
    reservation_state: "accepted_reserved",
    permit_check_id: "permit_check_a",
  });
  const directOnly = planInput(DIRECT_ONLY_PLAN);
  const impact = buildExposureDependencyImpact(impactInput(evaluation(), [acceptedReservation, directOnly]));

  assert.equal(impact.mode, "what_if");
  assert.equal(impact.scenario, "aave_evidence_unavailable");
  assert.notEqual(impact.simulation_session.session_id, "evaluation_context_fixture");
  assert.deepEqual(impact.changed_predicates, [{
    predicate: "total_exposure_cap",
    original: { status: "established", reason: "aave_user_reserve_available" },
    simulated: { status: "unavailable", reason: "aave_evidence_unavailable" },
    explanation: "The total exposure predicate depends on the Aave UserReserve evidence path.",
  }]);
  assert.equal(impact.original.predicates.total_exposure_cap.status, "established");
  assert.equal(impact.simulated.predicates.total_exposure_cap.status, "unavailable");
  assert.equal(impact.original.snapshot.provenance, "FIXTURE");
  assert.equal(impact.simulated.snapshot.display_label, "WHAT-IF / SIMULATION");
  assert.equal(impact.simulated.snapshot.provenance, "FIXTURE");
  assert.equal(impact.simulated.snapshot.aave_exposure_raw, null);
  assert.equal(impact.simulated.snapshot.total_exposure_raw, null);
  assert.equal(impact.affected_plans.length, 2);
  assert.equal(impact.affected_plans[0]?.agent_id, "agent_a");
  assert.equal(impact.affected_plans[1]?.agent_id, "agent_b");
  assert.equal(impact.affected_plans[0]?.simulated.reservation_status, "would_require_re_evaluation");
  assert.equal(impact.affected_plans[1]?.simulated.reservation_status, "not_admitted");
  assert.deepEqual(impact.affected_reservations, [{
    reservation_id: "reservation_a",
    original_state: "accepted_reserved",
    simulated_state: "would_require_re_evaluation",
    actual_state_changed: false,
  }]);
  assert.deepEqual(impact.causal_path.map((edge) => [edge.from, edge.to]), [
    ["aave_evidence", "total_exposure_cap"],
    ["total_exposure_cap", impact.affected_plans[0]?.original_plan_hash],
    [impact.affected_plans[0]?.original_plan_hash, "reservation_a"],
    ["reservation_a", "permit_check_a"],
  ]);
  assert.equal(impact.execution_boundary.code, "SIMULATION_NOT_EXECUTABLE");
  assert.equal(impact.execution_boundary.executable, false);
});

test("unrelated block and graph metadata changes do not become a dependency failure", () => {
  const baseline = buildExposureDependencyImpact(impactInput(evaluation(), [planInput(DIRECT_ONLY_PLAN)]));
  const changed = evaluation();
  changed.graph.source.block.number += 9;
  changed.graph.source.block.hash = `0x${"44".repeat(32)}`;
  changed.graph.graph_hash = `0x${"55".repeat(32)}`;
  const impact = buildExposureDependencyImpact(impactInput(changed, [planInput(DIRECT_ONLY_PLAN)]));

  assert.equal(impact.original.snapshot.block_number, 1_000_010);
  assert.equal(impact.original.snapshot.graph_hash, `0x${"55".repeat(32)}`);
  assert.deepEqual(impact.changed_predicates, baseline.changed_predicates);
  assert.deepEqual(
    impact.affected_plans.map((plan) => plan.simulated.reason_codes),
    baseline.affected_plans.map((plan) => plan.simulated.reason_codes),
  );
  assert.equal(impact.changed_predicates[0]?.predicate, "total_exposure_cap");
  assert.equal(impact.simulated.predicates.total_exposure_cap.reason, "aave_evidence_unavailable");
  assert.equal(impact.affected_plans.length, 1);
});

test("route accepts exactly the allowlisted what-if request and leaves original state unchanged", async () => {
  const state = createExposureRuntimeState();
  const source = issueExposurePlanFixtureReference("repair_over_limit", { runtimeState: state, now: NOW });
  assert.equal(source.statusCode, 200);
  const sourcePayload = source.payload as { evaluation_ref: string; template: ExposurePlanV1 };
  const validation = evaluateExposurePlanRequest({
    evaluation_ref: sourcePayload.evaluation_ref,
    plan: sourcePayload.template,
  }, { runtimeState: state, now: NOW });
  assert.equal(validation.statusCode, 200);

  const before = structuredClone({
    evaluations: [...state.evaluations.entries()],
    reservations: [...state.reservation_runtime.reservations.entries()],
    idempotency: [...state.reservation_runtime.idempotency.entries()],
  });
  const result = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/what-if",
    JSON.stringify({ evaluation_ref: sourcePayload.evaluation_ref, scenario: "aave_evidence_unavailable" }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
  );
  assert.equal(result.statusCode, 200);
  const payload = result.payload as Record<string, any>;
  assert.equal(payload.status, "ok");
  assert.equal(payload.mode, "what_if");
  assert.equal(payload.original.snapshot.provenance, "FIXTURE");
  assert.equal(payload.changed_predicates[0].simulated.reason, "aave_evidence_unavailable");
  assert.equal(payload.original.snapshot.direct_available_raw, "400000000000000000");
  assert.equal(payload.simulated.snapshot.total_exposure_raw, null);
  assert.deepEqual(payload.affected_plans[0].plan, sourcePayload.template);
  assert.equal(JSON.stringify(payload).includes("0000000000000000000000000000000000000001"), false);
  assert.deepEqual(structuredClone({
    evaluations: [...state.evaluations.entries()],
    reservations: [...state.reservation_runtime.reservations.entries()],
    idempotency: [...state.reservation_runtime.idempotency.entries()],
  }), before);

  const repeat = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/what-if",
    JSON.stringify({ evaluation_ref: sourcePayload.evaluation_ref, scenario: "aave_evidence_unavailable" }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
  );
  assert.equal(repeat.statusCode, 200);
  assert.notEqual(
    (repeat.payload as { simulation_session_id: string }).simulation_session_id,
    payload.simulation_session_id,
  );
});

test("route does not fabricate a permit check for an accepted reservation", async () => {
  const state = createExposureRuntimeState();
  const source = issueExposurePlanFixtureReference("repair_over_limit", { runtimeState: state, now: NOW });
  const sourcePayload = source.payload as { evaluation_ref: string };
  const session = createExposurePlanOperatorSession(state, {
    now: NOW,
    boundary: { allowed_origin: "http://127.0.0.1:8787", allowed_host: "127.0.0.1:8787" },
  }).session;
  const accepted = acceptExposurePlanForOperator(state, session, {
    evaluation_ref: sourcePayload.evaluation_ref,
    plan: {
      schema_version: "exposure_plan.v1",
      agent_id: "agent_a",
      goal: { kind: "supply_up_to", target_units: "0.050000000000000000" },
      steps: [{ kind: "supply_aave", units: "0.050000000000000000" }],
    },
    idempotency_key: "what-if-accepted-copy",
    accept_partial: false,
  }, { now: NOW });
  assert.equal(accepted.statusCode, 200);
  const acceptedPayload = accepted.payload as { reservation: { reservation_id: string } };
  const authorization = getExposurePlanAuthorizationRuntime(state);
  const before = {
    sessionIds: [...authorization.sessions.values()].map((item) => item.session_id),
    acceptedIds: [...authorization.accepted_plans.keys()],
    overlay: authorization.paper_overlay,
    nonces: [...authorization.consumed_nonces],
  };

  const impact = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/what-if",
    JSON.stringify({ evaluation_ref: sourcePayload.evaluation_ref, scenario: "aave_evidence_unavailable" }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
  );
  assert.equal(impact.statusCode, 200);
  const payload = impact.payload as Record<string, any>;
  assert.deepEqual(payload.simulation_session.reservations_copy, [acceptedPayload.reservation.reservation_id]);
  assert.deepEqual(payload.simulation_session.simulated_permits_copy, []);
  assert.equal(payload.affected_plans[0].permit_check_id, null);
  assert.equal(payload.affected_plans[0].original.permit_status, "not_recorded");
  assert.equal(payload.causal_paths[0].at(-1).status, "hypothetical");
  assert.equal(
    payload.causal_paths[0].at(-1).explanation,
    "No permit-check evidence is recorded in this analysis; issuance/check history is not established.",
  );
  assert.equal(payload.affected_reservations[0].actual_state_changed, false);
  assert.deepEqual({
    sessionIds: [...authorization.sessions.values()].map((item) => item.session_id),
    acceptedIds: [...authorization.accepted_plans.keys()],
    overlay: authorization.paper_overlay,
    nonces: [...authorization.consumed_nonces],
  }, before);

  const simulatedPermit = issueExposurePlanPermitForReservation(state, session, {
    reservation_id: acceptedPayload.reservation.reservation_id,
    session_id: session.session_id,
    mode: "what_if",
  }, { now: NOW });
  assert.equal(simulatedPermit.statusCode, 409);
  assert.equal((simulatedPermit.payload as { code: string }).code, "SIMULATION_NOT_EXECUTABLE");
});

test("fixture permit issuance does not turn missing permit-check history into historical absence", async () => {
  const state = createExposureRuntimeState();
  const source = issueExposurePlanFixtureReference("repair_over_limit", { runtimeState: state, now: NOW });
  const sourcePayload = source.payload as { evaluation_ref: string };
  const session = createExposurePlanOperatorSession(state, {
    now: NOW,
    boundary: { allowed_origin: "http://127.0.0.1:8787", allowed_host: "127.0.0.1:8787" },
  }).session;
  const accepted = acceptExposurePlanForOperator(state, session, {
    evaluation_ref: sourcePayload.evaluation_ref,
    plan: {
      schema_version: "exposure_plan.v1",
      agent_id: "agent_a",
      goal: { kind: "supply_up_to", target_units: "0.050000000000000000" },
      steps: [{ kind: "supply_aave", units: "0.050000000000000000" }],
    },
    idempotency_key: "what-if-issued-but-unrecorded",
    accept_partial: false,
  }, { now: NOW });
  assert.equal(accepted.statusCode, 200);
  const acceptedPayload = accepted.payload as { reservation: { reservation_id: string } };

  const issued = issueExposurePlanPermitForReservation(state, session, {
    reservation_id: acceptedPayload.reservation.reservation_id,
    session_id: session.session_id,
    mode: "live",
  }, { now: NOW });
  assert.equal(issued.statusCode, 200);
  assert.equal((issued.payload as { status: string }).status, "issued");

  const impact = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/what-if",
    JSON.stringify({ evaluation_ref: sourcePayload.evaluation_ref, scenario: "aave_evidence_unavailable" }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
  );
  assert.equal(impact.statusCode, 200);
  const payload = impact.payload as Record<string, any>;
  assert.deepEqual(payload.simulation_session.simulated_permits_copy, []);
  assert.equal(payload.affected_plans[0].permit_check_id, null);
  assert.equal(payload.affected_plans[0].original.permit_status, "not_recorded");
  assert.equal(
    payload.causal_paths[0].at(-1).explanation,
    "No permit-check evidence is recorded in this analysis; issuance/check history is not established.",
  );
  const simulatedPermit = issueExposurePlanPermitForReservation(state, session, {
    reservation_id: acceptedPayload.reservation.reservation_id,
    session_id: session.session_id,
    mode: "what_if",
  }, { now: NOW });
  assert.equal(simulatedPermit.statusCode, 409);
  assert.equal((simulatedPermit.payload as { code: string }).code, "SIMULATION_NOT_EXECUTABLE");
});

test("malformed, unknown, expired and unavailable source references fail closed without fixture fallback", async () => {
  const state = storedState();
  const cases: Array<{ body: unknown; status: number; error: string }> = [
    {
      body: { evaluation_ref: REF, scenario: "aave_evidence_unavailable", extra: true },
      status: 400,
      error: "invalid_exposure_what_if_request",
    },
    {
      body: { evaluation_ref: `exposure_${"cd".repeat(16)}`, scenario: "aave_evidence_unavailable" },
      status: 400,
      error: "invalid_evaluation_reference",
    },
  ];
  for (const item of cases) {
    const response = await handleJudgeModeRequest(
      "POST",
      "/api/exposure/what-if",
      JSON.stringify(item.body),
      { exposureDependencies: { runtimeState: state, now: NOW } },
    );
    assert.equal(response.statusCode, item.status);
    assert.equal((response.payload as { error: string }).error, item.error);
  }

  const expired = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/what-if",
    JSON.stringify({ evaluation_ref: REF, scenario: "aave_evidence_unavailable" }),
    { exposureDependencies: { runtimeState: storedState(evaluation(), NOW.getTime() - 1), now: NOW } },
  );
  assert.equal(expired.statusCode, 410);
  assert.equal((expired.payload as { error: string }).error, "expired_evaluation_reference");

  const unavailable = evaluation();
  unavailable.graph.source_status = "error";
  const blocked = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/what-if",
    JSON.stringify({ evaluation_ref: REF, scenario: "aave_evidence_unavailable" }),
    { exposureDependencies: { runtimeState: storedState(unavailable), now: NOW } },
  );
  assert.equal(blocked.statusCode, 503);
  assert.equal((blocked.payload as { error: string }).error, "source_unavailable");
  assert.doesNotMatch(JSON.stringify(blocked.payload), /FIXTURE/);
});

test("simulation execution is rejected at the original execution boundary without side effects", async () => {
  const state = createExposureRuntimeState();
  const impact = buildExposureDependencyImpact(impactInput(evaluation(), [planInput(CANONICAL_PLAN)]));
  const permitResult = issueExposurePlanPermit({
    plan_hash: "a".repeat(64),
    agent_id: "agent_a",
    account: ACCOUNT,
    policy_version: "exposure-plan-wsteth-v1",
    evidence_ref: REF,
    graph_hash: GRAPH_HASH,
    reservation_id: "reservation_simulated",
    session_id: impact.simulation_session.session_id,
    mode: "what_if",
    source_provenance: "FIXTURE",
    runtime_generation: "generation_simulated",
    now: NOW,
    nonce: "77",
  });
  assert.equal(permitResult.status, "issued");
  const before = structuredClone({
    reservations: [...state.reservation_runtime.reservations.entries()],
    nonces: [...state.consumed_nonces],
  });
  const result = await executeExposurePlanReservation(
    state,
    {
      reservation_id: "reservation_simulated",
      permit: permitResult.permit,
      session_id: impact.simulation_session.session_id,
      mode: "what_if",
      now: NOW,
    },
    async () => ({ status: "blocked", code: "SOURCE_UNAVAILABLE" }),
  );
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "SIMULATION_NOT_EXECUTABLE");
  assert.deepEqual(structuredClone({
    reservations: [...state.reservation_runtime.reservations.entries()],
    nonces: [...state.consumed_nonces],
  }), before);
});
