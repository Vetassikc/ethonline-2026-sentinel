import test from "node:test";
import assert from "node:assert/strict";

import {
  createExposureRuntimeState,
  type StoredExposureEvaluation,
} from "../app/exposure-service.ts";
import {
  evaluateExposurePlanDemo,
  evaluateExposurePlanRequest,
} from "../app/exposure-plan-service.ts";
import { handleJudgeModeRequest } from "../app/server.ts";
import type { ExposureEvaluation, ExposureGraphV1 } from "../../shared/schemas/exposure-graph.ts";

const REF = `exposure_${"ab".repeat(16)}`;
const ACCOUNT = "0x9999999999999999999999999999999999999999";
const NOW = new Date("2026-09-08T10:00:00.000Z");

function quantity(raw: string) {
  const integer = BigInt(raw) / 1_000_000_000_000_000_000n;
  const fraction = (BigInt(raw) % 1_000_000_000_000_000_000n).toString().padStart(18, "0");
  return { raw, decimal: `${integer}.${fraction}`, decimals: 18, unit: "wstETH" as const };
}

function graph(options: { mode?: "live" | "fixture" | "replay"; source_status?: "ok" | "blocked" | "error" }): ExposureGraphV1 {
  return {
    schema_version: "exposure_graph.v1",
    mode: options.mode ?? "live",
    source_status: options.source_status ?? "ok",
    subject: { account: ACCOUNT, chain_id: 8453 },
    source: {
      graph_subgraph_id: "public-subgraph",
      graph_endpoint: "https://example.invalid/graph",
      rpc_endpoint: "https://example.invalid/rpc",
      block: { number: 123, hash: `0x${"11".repeat(32)}`, timestamp: 1_788_800_000 },
    },
    nodes: [],
    edges: [],
    paths: [
      {
        id: "path:direct",
        kind: "direct_holding",
        unit: "wstETH",
        asset_id: "asset:wsteth",
        raw_quantity: "200000000000000000",
        decimal_quantity: "0.200000000000000000",
        decimals: 18,
        capital_contribution: true,
        representation_of: "asset:wsteth",
        edge_ids: [],
      },
      {
        id: "path:aave",
        kind: "aave_supply",
        unit: "wstETH",
        asset_id: "asset:wsteth",
        raw_quantity: "600000000000000000",
        decimal_quantity: "0.600000000000000000",
        decimals: 18,
        capital_contribution: true,
        representation_of: "asset:wsteth",
        edge_ids: [],
      },
    ],
    debt: [{
      id: "debt:none",
      quantity: quantity("0"),
      source_path: "fixture://debt",
      block_number: 123,
      block_hash: `0x${"11".repeat(32)}`,
    }],
    gaps: ["usd_valuation_unavailable"],
    graph_hash: `0x${"22".repeat(32)}`,
  };
}

function evaluation(options: { mode?: "live" | "fixture" | "replay"; source_status?: "ok" | "blocked" | "error" } = {}): ExposureEvaluation {
  return {
    schema_version: "exposure_evaluation.v1",
    mode: options.mode ?? "live",
    request: {
      schema_version: "sentinel-exposure-buy.v1",
      action: "BUY_EXPOSURE",
      asset: "wstETH",
      unit: "wstETH",
      requested_units: "2.000000000000000000",
    },
    graph: graph(options),
    policy: {
      verdict: "DENY",
      requested_units: "2.000000000000000000",
      allowed_units: "0.000000000000000000",
      dependency_cap_units: "1.000000000000000000",
      gross_exposure_units: "0.800000000000000000",
      headroom_units: "0.200000000000000000",
      binding_constraint: "dependency_cap",
      policy_version: "exposure-wsteth-v1",
      unit: "wstETH",
      reason_codes: ["purchase_denied_for_test"],
      debt_units: "0.000000000000000000",
    },
    created_at: NOW.toISOString(),
    expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
  };
}

function stateFor(storedEvaluation: ExposureEvaluation, expiresAtMs = NOW.getTime() + 60_000) {
  const state = createExposureRuntimeState();
  const stored: StoredExposureEvaluation = { evaluation: storedEvaluation, expires_at_ms: expiresAtMs };
  state.evaluations.set(REF, stored);
  return state;
}

function request(plan: unknown = {
  schema_version: "exposure_plan.v1",
  agent_id: "agent_a",
  goal: { kind: "reduce_aave_exposure", target_units: "0.200000000000000000" },
  steps: [{ kind: "withdraw_aave_to_wallet", units: "0.200000000000000000" }],
}) {
  return { evaluation_ref: REF, plan };
}

test("plan config and canonical fixture are read-only and server-owned", async () => {
  const config = await handleJudgeModeRequest("GET", "/api/exposure/plan/config", "");
  assert.equal(config.statusCode, 200);
  assert.equal((config.payload as { account?: unknown }).account, undefined);
  assert.equal((config.payload as { source_resolution: string }).source_resolution, "SERVER_STORED_EVALUATION_ONLY");

  const demo = evaluateExposurePlanDemo("repair_over_limit");
  assert.equal(demo.statusCode, 200);
  const payload = demo.payload as Record<string, any>;
  assert.equal(payload.source.provenance, "FIXTURE");
  assert.equal(payload.evaluation.initial_state.direct_available_raw, "400000000000000000");
  assert.equal(payload.evaluation.diagnostic_projection.projected_final_state.total_exposure_raw, "1100000000000000000");
  assert.equal(payload.evaluation.diagnostic_projection.projected_final_state.aave_exposure_raw, "700000000000000000");
  assert.deepEqual(payload.repair.candidate.steps, [
    { kind: "acquire_wsteth", units: "0.200000000000000000" },
    { kind: "supply_aave", units: "0.100000000000000000" },
  ]);
  assert.equal(payload.repair.evaluation.final_state.direct_available_raw, "500000000000000000");
  assert.equal(payload.repair.evaluation.final_state.aave_exposure_raw, "500000000000000000");
  assert.equal(payload.repair.evaluation.final_state.total_exposure_raw, "1000000000000000000");
  assert.equal(payload.repair.evaluation.goal_status, "PARTIAL");
  assert.doesNotThrow(() => JSON.stringify(payload));
});

test("HTTP plan routes validate bodies and expose the same server-owned demo boundary", async () => {
  const demo = await handleJudgeModeRequest("GET", "/api/exposure/plan/demo/repair_over_limit", "");
  assert.equal(demo.statusCode, 200);
  assert.equal((demo.payload as { source: { mode: string } }).source.mode, "fixture");

  const malformed = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/validate",
    JSON.stringify({ evaluation_ref: REF, plan: {}, account: ACCOUNT }),
    { exposureDependencies: { runtimeState: stateFor(evaluation()), now: NOW } },
  );
  assert.equal(malformed.statusCode, 400);
  assert.equal((malformed.payload as { error: string }).error, "invalid_exposure_plan_request");

  const valid = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/validate",
    JSON.stringify(request()),
    { exposureDependencies: { runtimeState: stateFor(evaluation()), now: NOW } },
  );
  assert.equal(valid.statusCode, 200);
  assert.equal((valid.payload as { source: { mode: string } }).source.mode, "live");
  assert.equal((valid.payload as { evaluation: { initial_state: { aave_exposure_raw: string } } }).evaluation.initial_state.aave_exposure_raw, "600000000000000000");
});

test("fixture editing starts from a server-issued reference and validates the edited plan", async () => {
  const runtimeState = createExposureRuntimeState();
  const source = await handleJudgeModeRequest(
    "GET",
    "/api/exposure/plan/source/fixture",
    "",
    { exposureDependencies: { runtimeState, now: NOW } },
  );
  assert.equal(source.statusCode, 200);
  const sourcePayload = source.payload as Record<string, any>;
  assert.match(sourcePayload.evaluation_ref, /^exposure_[0-9a-f]{32}$/);
  assert.equal(sourcePayload.source.mode, "fixture");
  assert.equal(sourcePayload.source.provenance, "FIXTURE");
  assert.equal(sourcePayload.template_case, "repair_over_limit");
  assert.equal(JSON.stringify(sourcePayload).includes(ACCOUNT), false);

  const edited = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/validate",
    JSON.stringify({
      evaluation_ref: sourcePayload.evaluation_ref,
      plan: {
        schema_version: "exposure_plan.v1",
        agent_id: "agent_a",
        goal: { kind: "acquire_up_to", target_units: "0.100000000000000000" },
        steps: [{ kind: "acquire_wsteth", units: "0.100000000000000000" }],
      },
    }),
    { exposureDependencies: { runtimeState, now: NOW } },
  );
  assert.equal(edited.statusCode, 200);
  const editedPayload = edited.payload as Record<string, any>;
  assert.equal(editedPayload.plan.goal.kind, "acquire_up_to");
  assert.equal(editedPayload.evaluation.diagnostic_projection.projected_final_state.total_exposure_raw, "900000000000000000");
  assert.equal(editedPayload.repair.evaluation.final_state.total_exposure_raw, "900000000000000000");
});

test("strict plan route validation rejects account and policy control before engine work", () => {
  const state = stateFor(evaluation());
  const before = state.evaluations.get(REF)?.evaluation.graph.paths[0]?.raw_quantity;
  const result = evaluateExposurePlanRequest({ ...request(), account: ACCOUNT }, { runtimeState: state, now: NOW });
  assert.equal(result.statusCode, 400);
  assert.equal((result.payload as { error: string }).error, "invalid_exposure_plan_request");
  assert.equal(state.evaluations.get(REF)?.evaluation.graph.paths[0]?.raw_quantity, before);
});

test("source-backed withdrawal remains independently evaluable when legacy BUY_EXPOSURE is denied", () => {
  const state = stateFor(evaluation());
  const result = evaluateExposurePlanRequest(request(), { runtimeState: state, now: NOW });
  assert.equal(result.statusCode, 200);
  const payload = result.payload as Record<string, any>;
  assert.equal(payload.source.mode, "live");
  assert.equal(payload.source.provenance, "LIVE_SOURCE");
  assert.equal(payload.legacy_buy_exposure.verdict, "DENY");
  assert.equal(payload.evaluation.policy_status, "PASS");
  assert.equal(payload.evaluation.goal_status, "FULL");
  assert.equal(payload.evaluation.paper_eligibility, "ELIGIBLE");
  assert.equal(payload.evaluation.final_state.aave_exposure_raw, "400000000000000000");
  assert.equal(payload.boundary.execution, "UNAVAILABLE_IN_TASK_3");
  assert.equal(JSON.stringify(payload).includes(ACCOUNT), false);
});

test("source failure is explicit and never falls back to fixture mode", () => {
  const state = stateFor(evaluation({ source_status: "error" }));
  const result = evaluateExposurePlanRequest(request(), { runtimeState: state, now: NOW });
  assert.equal(result.statusCode, 503);
  const payload = result.payload as Record<string, any>;
  assert.equal(payload.error, "source_unavailable");
  assert.equal(payload.source, undefined);
  assert.equal(JSON.stringify(payload).includes("FIXTURE"), false);
});

test("expired and unknown references remain distinct and do not mutate state", () => {
  const expiredState = stateFor(evaluation(), NOW.getTime() - 1);
  const expired = evaluateExposurePlanRequest(request(), { runtimeState: expiredState, now: NOW });
  assert.equal(expired.statusCode, 410);
  assert.equal((expired.payload as { error: string }).error, "expired_evaluation_reference");
  assert.equal(expiredState.evaluations.has(REF), true);

  const missing = evaluateExposurePlanRequest(request(), { runtimeState: createExposureRuntimeState(), now: NOW });
  assert.equal(missing.statusCode, 400);
  assert.equal((missing.payload as { error: string }).error, "invalid_evaluation_reference");
});

test("mode and exact integer serialization survive the service boundary", () => {
  const state = stateFor(evaluation({ mode: "replay" }));
  const result = evaluateExposurePlanRequest(request(), { runtimeState: state, now: NOW });
  assert.equal(result.statusCode, 200);
  const payload = result.payload as Record<string, any>;
  assert.equal(payload.source.mode, "replay");
  assert.equal(payload.evaluation.source_provenance, "REPLAY");
  assert.equal(typeof payload.evaluation.initial_state.aave_exposure_raw, "string");
  assert.equal(payload.evaluation.initial_state.aave_exposure_raw, "600000000000000000");
  assert.equal(payload.evaluation.resource_requirements.peak_aave_increase_raw, "0");
  assert.doesNotThrow(() => JSON.stringify(result.payload));
});

test("separate demo cases keep unsupported total reduction and boundary cases explicit", () => {
  const unsupported = evaluateExposurePlanDemo("reduce_total_exposure");
  assert.equal(unsupported.statusCode, 200);
  const unsupportedPayload = unsupported.payload as Record<string, any>;
  assert.equal(unsupportedPayload.evaluation.goal_status, "UNSATISFIED");
  assert.equal(unsupportedPayload.repair.status, "NO_SUPPORTED_REPAIR");

  const restore = evaluateExposurePlanDemo("restore_aave_cap");
  assert.equal(restore.statusCode, 200);
  const restorePayload = restore.payload as Record<string, any>;
  assert.equal(restorePayload.evaluation.policy_status, "PASS");
  assert.equal(restorePayload.evaluation.final_state.aave_exposure_raw, "400000000000000000");

  const reservations = evaluateExposurePlanDemo("shared_budget");
  assert.equal(reservations.statusCode, 409);
  assert.equal((reservations.payload as { error: string }).error, "task_3_boundary_unavailable");
});
