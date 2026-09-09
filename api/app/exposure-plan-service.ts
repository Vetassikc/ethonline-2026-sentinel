import { randomUUID } from "node:crypto";

import type {
  ExposureEvaluation,
  ExposureGraphV1,
  ExposureMode,
  ExposurePolicyDecision,
} from "../../shared/schemas/exposure-graph.ts";
import {
  EXPOSURE_PLAN_SCHEMA_VERSION,
  type ExposurePlanAction,
  type ExposurePlanV1,
} from "../../shared/schemas/exposure-plan.ts";
import {
  evaluateExposurePlan,
  type ExposureAccountingState,
  type ExposurePlanEvaluation,
  type ExposurePlanPolicy,
  type ExposureSourceProvenance,
} from "./exposure-plan-engine.ts";
import { repairExposurePlan, type ExposureRepairResult } from "./exposure-plan-repair.ts";
import { validateExposurePlan } from "./exposure-plan-request.ts";
import {
  createExposureRuntimeState,
  type ExposureRuntimeState,
} from "./exposure-service.ts";
import { formatFixedUnits, parseFixedUnits } from "./exposure-policy.ts";

export const DEFAULT_EXPOSURE_PLAN_POLICY: ExposurePlanPolicy = {
  policy_version: "exposure-plan-wsteth-v1",
  dependency_cap_units: "1.000000000000000000",
  aave_cap_units: "0.500000000000000000",
  unit: "wstETH",
};

const EVALUATION_REFERENCE_PATTERN = /^exposure_[0-9a-f]{32}$/;
const FIXTURE_BLOCK = {
  number: 1_000_001,
  hash: `0x${"12".repeat(32)}`,
  timestamp: 1_788_800_000,
};
const FIXTURE_GRAPH_ENDPOINT = "fixture://sentinel-exposure-graph";
const FIXTURE_RPC_ENDPOINT = "fixture://base-rpc";
const NON_BLOCKING_SOURCE_GAPS = new Set(["usd_valuation_unavailable", "stale_oracle_price"]);
const FIXTURE_REFERENCE_TTL_MS = 60_000;

export type ExposurePlanCase =
  | "repair_over_limit"
  | "restore_aave_cap"
  | "reduce_total_exposure"
  | "shared_budget"
  | "aave_evidence_what_if";

export type ExposurePlanRequest = {
  evaluation_ref: string;
  plan: ExposurePlanV1;
};

export type ExposurePlanServiceDependencies = {
  runtimeState?: ExposureRuntimeState;
  now?: Date;
  policy?: ExposurePlanPolicy;
};

type PlanRoutePayload = {
  status: "ok" | "blocked";
  error?: string;
  details?: string[];
  case_name?: ExposurePlanCase;
  source?: ExposurePlanSourceSummary;
  source_qualification?: ExposureSourceQualification;
  legacy_buy_exposure?: SanitizedLegacyPolicy;
  plan?: ExposurePlanV1;
  validation?: { ok: true };
  evaluation?: SerializedExposurePlanEvaluation;
  repair?: SerializedExposureRepairResult;
  boundary?: ExposurePlanBoundary;
};

export type ExposurePlanRouteResponse = {
  statusCode: number;
  payload: PlanRoutePayload | Record<string, unknown>;
};

export type ExposurePlanSourceSummary = {
  mode: ExposureMode;
  provenance: ExposureSourceProvenance;
  qualification: "QUALIFIED" | "BLOCKED";
  chain_id: number | null;
  indexed_block: number | null;
  indexed_at: string | null;
  graph_hash: string | null;
  providers: {
    graph: "The Graph" | "fixture" | "unknown";
    rpc: "Base JSON-RPC" | "fixture" | "unknown";
  };
  path_kinds: string[];
  gaps: string[];
};

export type ExposureSourceQualification = {
  status: "QUALIFIED" | "BLOCKED";
  reason_codes: string[];
  paper_session_eligible: boolean;
};

type SanitizedLegacyPolicy = Pick<
  ExposurePolicyDecision,
  | "verdict"
  | "requested_units"
  | "allowed_units"
  | "dependency_cap_units"
  | "gross_exposure_units"
  | "headroom_units"
  | "binding_constraint"
  | "policy_version"
  | "unit"
  | "reason_codes"
  | "debt_units"
>;

type SerializedExposurePlanEvaluation = Omit<ExposurePlanEvaluation, never>;
type SerializedExposureRepairResult = Omit<ExposureRepairResult, never>;

export type ExposurePlanBoundary = {
  read_only: true;
  reservations: "UNAVAILABLE_IN_TASK_3";
  signing: "UNAVAILABLE_IN_TASK_3";
  execution: "UNAVAILABLE_IN_TASK_3";
  runtime_what_if: "UNAVAILABLE_IN_TASK_3";
};

export type ExposurePlanConfig = {
  schema_version: "sentinel-exposure-plan-config.v1";
  plan_schema_version: typeof EXPOSURE_PLAN_SCHEMA_VERSION;
  policy: ExposurePlanPolicy;
  max_steps: 3;
  supported_goal_kinds: string[];
  supported_action_kinds: string[];
  source_resolution: "SERVER_STORED_EVALUATION_ONLY";
  account_policy_control: "SERVER_ONLY";
  paper_session: "READ_ONLY_REVIEW_ONLY";
  boundary: ExposurePlanBoundary;
};

export function buildExposurePlanConfig(policy = DEFAULT_EXPOSURE_PLAN_POLICY): ExposurePlanConfig {
  return {
    schema_version: "sentinel-exposure-plan-config.v1",
    plan_schema_version: EXPOSURE_PLAN_SCHEMA_VERSION,
    policy,
    max_steps: 3,
    supported_goal_kinds: [
      "acquire_up_to",
      "supply_up_to",
      "reduce_aave_exposure",
      "reduce_total_exposure",
    ],
    supported_action_kinds: ["acquire_wsteth", "supply_aave", "withdraw_aave_to_wallet"],
    source_resolution: "SERVER_STORED_EVALUATION_ONLY",
    account_policy_control: "SERVER_ONLY",
    paper_session: "READ_ONLY_REVIEW_ONLY",
    boundary: readOnlyBoundary(),
  };
}

function readOnlyBoundary(): ExposurePlanBoundary {
  return {
    read_only: true,
    reservations: "UNAVAILABLE_IN_TASK_3",
    signing: "UNAVAILABLE_IN_TASK_3",
    execution: "UNAVAILABLE_IN_TASK_3",
    runtime_what_if: "UNAVAILABLE_IN_TASK_3",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function invalidRequest(details: string[]): ExposurePlanRouteResponse {
  return {
    statusCode: 400,
    payload: { status: "blocked", error: "invalid_exposure_plan_request", details },
  };
}

export function validateExposurePlanServiceRequest(input: unknown):
  | { ok: true; request: ExposurePlanRequest }
  | { ok: false; details: string[] } {
  if (!isRecord(input) || !hasExactKeys(input, ["evaluation_ref", "plan"])) {
    return { ok: false, details: ["request_keys"] };
  }
  if (typeof input.evaluation_ref !== "string" || !EVALUATION_REFERENCE_PATTERN.test(input.evaluation_ref)) {
    return { ok: false, details: ["evaluation_ref"] };
  }
  const validation = validateExposurePlan(input.plan);
  if (!validation.ok) return { ok: false, details: validation.error.details };
  return {
    ok: true,
    request: { evaluation_ref: input.evaluation_ref, plan: validation.plan },
  };
}

function planProvenance(mode: ExposureMode): ExposureSourceProvenance {
  if (mode === "live") return "LIVE_SOURCE";
  if (mode === "replay") return "REPLAY";
  return "FIXTURE";
}

function providerLabel(graph: ExposureGraphV1, kind: "graph" | "rpc"): "The Graph" | "Base JSON-RPC" | "fixture" | "unknown" {
  if (graph.mode === "fixture") return "fixture";
  if (kind === "graph") return graph.source.graph_subgraph_id ? "The Graph" : "unknown";
  return graph.source.rpc_endpoint ? "Base JSON-RPC" : "unknown";
}

function sourceSummary(
  evaluation: ExposureEvaluation,
  qualification: ExposureSourceQualification,
): ExposurePlanSourceSummary {
  const graph = evaluation.graph;
  return {
    mode: evaluation.mode,
    provenance: planProvenance(evaluation.mode),
    qualification: qualification.status,
    chain_id: graph?.subject?.chain_id ?? null,
    indexed_block: graph?.source?.block?.number ?? null,
    indexed_at: graph?.source?.block?.timestamp
      ? new Date(graph.source.block.timestamp * 1000).toISOString()
      : null,
    graph_hash: graph?.graph_hash ?? null,
    providers: {
      graph: graph ? providerLabel(graph, "graph") : "unknown",
      rpc: graph ? providerLabel(graph, "rpc") : "unknown",
    },
    path_kinds: graph?.paths?.map((path) => path.kind) ?? [],
    gaps: graph?.gaps ?? [],
  };
}

function sanitizeLegacyPolicy(policy: ExposurePolicyDecision): SanitizedLegacyPolicy {
  return {
    verdict: policy.verdict,
    requested_units: policy.requested_units,
    allowed_units: policy.allowed_units,
    dependency_cap_units: policy.dependency_cap_units,
    gross_exposure_units: policy.gross_exposure_units,
    headroom_units: policy.headroom_units,
    binding_constraint: policy.binding_constraint,
    policy_version: policy.policy_version,
    unit: policy.unit,
    reason_codes: [...policy.reason_codes],
    debt_units: policy.debt_units,
  };
}

function serializeBigInts<T>(value: T): T {
  if (typeof value === "bigint") return value.toString() as T;
  if (Array.isArray(value)) return value.map((item) => serializeBigInts(item)) as T;
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) result[key] = serializeBigInts(item);
    return result as T;
  }
  return value;
}

function graphRawQuantity(
  value: string,
  label: string,
  decimal: string,
  decimals: number,
  unit: string,
): bigint {
  if (decimals !== 18 || unit !== "wstETH" || !/^\d+$/.test(value)) throw new Error(`${label}_raw`);
  const raw = BigInt(value);
  if (parseFixedUnits(decimal) !== raw) throw new Error(`${label}_decimal`);
  return raw;
}

function deriveInitialState(graph: ExposureGraphV1, policy: ExposurePlanPolicy):
  | { ok: true; state: ExposureAccountingState }
  | { ok: false; reason_codes: string[] } {
  const reasons: string[] = [];
  if (graph.source_status !== "ok") reasons.push("source_not_qualified");
  if (!graph.subject || graph.subject.chain_id <= 0) reasons.push("source_chain_missing");
  if (!graph.source?.block || graph.source.block.number <= 0 || !graph.source.block.hash) {
    reasons.push("source_block_missing");
  }
  const directPaths = graph.paths.filter((path) => path.kind === "direct_holding" && path.capital_contribution);
  const aavePaths = graph.paths.filter((path) => path.kind === "aave_supply" && path.capital_contribution);
  if (directPaths.length === 0) reasons.push("missing_direct_path");
  if (aavePaths.length === 0) reasons.push("missing_aave_path");
  const requiredGaps = graph.gaps.filter((gap) => !NON_BLOCKING_SOURCE_GAPS.has(gap));
  if (requiredGaps.length > 0) reasons.push("required_source_gap");
  try {
    const direct = directPaths.reduce(
      (total, path) => total + graphRawQuantity(path.raw_quantity, "direct", path.decimal_quantity, path.decimals, path.unit),
      0n,
    );
    const aave = aavePaths.reduce(
      (total, path) => total + graphRawQuantity(path.raw_quantity, "aave", path.decimal_quantity, path.decimals, path.unit),
      0n,
    );
    const debt = graph.debt.reduce(
      (total, item) => total + graphRawQuantity(item.quantity.raw, "debt", item.quantity.decimal, item.quantity.decimals, item.quantity.unit),
      0n,
    );
    const dependencyCap = parseFixedUnits(policy.dependency_cap_units);
    const aaveCap = parseFixedUnits(policy.aave_cap_units);
    if (reasons.length > 0) return { ok: false, reason_codes: [...new Set(reasons)] };
    return {
      ok: true,
      state: {
        direct_available_raw: direct,
        aave_exposure_raw: aave,
        total_exposure_raw: direct + aave,
        debt_raw: debt,
        dependency_cap_raw: dependencyCap,
        aave_cap_raw: aaveCap,
      },
    };
  } catch {
    return { ok: false, reason_codes: [...new Set([...reasons, "malformed_source_quantity"])] };
  }
}

function qualifySource(evaluation: ExposureEvaluation, policy: ExposurePlanPolicy): ExposureSourceQualification {
  const derived = deriveInitialState(evaluation.graph, policy);
  return derived.ok
    ? { status: "QUALIFIED", reason_codes: [], paper_session_eligible: true }
    : { status: "BLOCKED", reason_codes: derived.reason_codes, paper_session_eligible: false };
}

function sourceFailureResponse(
  code: string,
  details: string[],
): ExposurePlanRouteResponse {
  return {
    statusCode: code === "invalid_evaluation_reference"
      ? 400
      : code === "expired_evaluation_reference"
        ? 410
        : 503,
    payload: { status: "blocked", error: code, details, boundary: readOnlyBoundary() },
  };
}

function evaluationResponse(
  evaluation: ExposureEvaluation,
  plan: ExposurePlanV1,
  policy: ExposurePlanPolicy,
  caseName?: ExposurePlanCase,
): ExposurePlanRouteResponse {
  const qualification = qualifySource(evaluation, policy);
  const source = sourceSummary(evaluation, qualification);
  if (!qualification.status || qualification.status !== "QUALIFIED") {
    return sourceFailureResponse("source_unavailable", qualification.reason_codes);
  }
  const derived = deriveInitialState(evaluation.graph, policy);
  if (!derived.ok) return sourceFailureResponse("source_unavailable", derived.reason_codes);
  const provenance = planProvenance(evaluation.mode);
  const evaluated = evaluateExposurePlan(derived.state, plan, policy, [], {
    source_provenance: provenance,
    paper_session_eligible: qualification.paper_session_eligible,
    accept_partial: false,
  });
  const repair = repairExposurePlan(derived.state, plan, policy, [], {
    source_provenance: provenance,
    paper_session_eligible: qualification.paper_session_eligible,
    accept_partial: false,
  });
  return {
    statusCode: 200,
    payload: {
      status: "ok",
      ...(caseName ? { case_name: caseName } : {}),
      source,
      source_qualification: qualification,
      legacy_buy_exposure: sanitizeLegacyPolicy(evaluation.policy),
      plan,
      validation: { ok: true },
      evaluation: serializeBigInts(evaluated),
      repair: serializeBigInts(repair),
      boundary: readOnlyBoundary(),
    },
  };
}

function fixtureQuantity(raw: string) {
  const decimal = formatFixedUnits(BigInt(raw));
  return { raw, decimal, decimals: 18, unit: "wstETH" as const };
}

function fixtureGraph(options: {
  direct_raw: string;
  aave_raw: string;
  debt_raw?: string;
  mode?: ExposureMode;
  gaps?: string[];
}): ExposureGraphV1 {
  const mode = options.mode ?? "fixture";
  const direct = fixtureQuantity(options.direct_raw);
  const aave = fixtureQuantity(options.aave_raw);
  const debtRaw = options.debt_raw ?? "0";
  const account = "0x0000000000000000000000000000000000000001";
  const assetId = "asset:fixture:wsteth";
  const directId = "path:fixture:direct";
  const aaveId = "path:fixture:aave";
  return {
    schema_version: "exposure_graph.v1",
    mode,
    source_status: "ok",
    subject: { account, chain_id: 8453 },
    source: {
      graph_subgraph_id: mode === "fixture" ? "fixture-subgraph" : "fixture-subgraph",
      graph_endpoint: FIXTURE_GRAPH_ENDPOINT,
      rpc_endpoint: FIXTURE_RPC_ENDPOINT,
      block: FIXTURE_BLOCK,
    },
    nodes: [],
    edges: [],
    paths: [
      {
        id: directId,
        kind: "direct_holding",
        unit: "wstETH",
        asset_id: assetId,
        raw_quantity: direct.raw,
        decimal_quantity: direct.decimal,
        decimals: 18,
        capital_contribution: true,
        representation_of: assetId,
        edge_ids: [],
      },
      {
        id: aaveId,
        kind: "aave_supply",
        unit: "wstETH",
        asset_id: assetId,
        raw_quantity: aave.raw,
        decimal_quantity: aave.decimal,
        decimals: 18,
        capital_contribution: true,
        representation_of: assetId,
        edge_ids: [],
      },
    ],
    debt: [{
      id: "debt:fixture",
      quantity: fixtureQuantity(debtRaw),
      source_path: "fixture://debt",
      block_number: FIXTURE_BLOCK.number,
      block_hash: FIXTURE_BLOCK.hash,
    }],
    gaps: options.gaps ?? ["usd_valuation_unavailable"],
    graph_hash: `0x${"34".repeat(32)}`,
  };
}

function fixtureEvaluation(
  graph: ExposureGraphV1,
  policy: ExposurePolicyDecision = {
    verdict: "DENY",
    requested_units: "0.000000000000000000",
    allowed_units: "0.000000000000000000",
    dependency_cap_units: "1.000000000000000000",
    gross_exposure_units: "0.000000000000000000",
    headroom_units: "1.000000000000000000",
    binding_constraint: "none",
    policy_version: "exposure-wsteth-v1",
    unit: "wstETH",
    reason_codes: ["fixture_source_for_plan_review"],
    debt_units: "0.000000000000000000",
  },
): ExposureEvaluation {
  return {
    schema_version: "exposure_evaluation.v1",
    mode: graph.mode,
    request: {
      schema_version: "sentinel-exposure-buy.v1",
      action: "BUY_EXPOSURE",
      asset: "wstETH",
      unit: "wstETH",
      requested_units: policy.requested_units,
    },
    graph,
    policy,
    created_at: new Date(FIXTURE_BLOCK.timestamp * 1000).toISOString(),
    expires_at: new Date((FIXTURE_BLOCK.timestamp + 3600) * 1000).toISOString(),
  };
}

export function issueExposurePlanFixtureReference(
  caseName: ExposurePlanCase = "repair_over_limit",
  dependencies: ExposurePlanServiceDependencies = {},
): ExposurePlanRouteResponse {
  if (!["repair_over_limit", "restore_aave_cap", "reduce_total_exposure"].includes(caseName)) {
    return {
      statusCode: 409,
      payload: {
        status: "blocked",
        error: "task_3_boundary_unavailable",
        details: ["Only bounded Task 3 fixture templates can be issued."],
        boundary: readOnlyBoundary(),
      },
    };
  }
  const now = dependencies.now ?? new Date();
  const runtimeState = dependencies.runtimeState ?? createExposureRuntimeState();
  const policy = dependencies.policy ?? DEFAULT_EXPOSURE_PLAN_POLICY;
  const graph = caseName === "restore_aave_cap"
    ? fixtureGraph({ direct_raw: "200000000000000000", aave_raw: "600000000000000000" })
    : fixtureGraph({ direct_raw: "400000000000000000", aave_raw: "400000000000000000" });
  const evaluation = fixtureEvaluation(graph);
  const expiresAtMs = now.getTime() + FIXTURE_REFERENCE_TTL_MS;
  const reference = `exposure_${randomUUID().replaceAll("-", "")}`;
  runtimeState.evaluations.set(reference, {
    evaluation,
    expires_at_ms: expiresAtMs,
  });
  const qualification = qualifySource(evaluation, policy);
  return {
    statusCode: qualification.status === "QUALIFIED" ? 200 : 503,
    payload: qualification.status === "QUALIFIED"
      ? {
          status: "ok",
          evaluation_ref: reference,
          expires_at: new Date(expiresAtMs).toISOString(),
          template_case: caseName,
          template: demoPlan(caseName),
          source: sourceSummary(evaluation, qualification),
          boundary: readOnlyBoundary(),
        }
      : {
          status: "blocked",
          error: "source_unavailable",
          details: qualification.reason_codes,
          boundary: readOnlyBoundary(),
        },
  };
}

function demoPlan(caseName: ExposurePlanCase): ExposurePlanV1 {
  const common = { schema_version: EXPOSURE_PLAN_SCHEMA_VERSION, agent_id: "agent_a" as const };
  if (caseName === "restore_aave_cap") {
    return {
      ...common,
      goal: { kind: "reduce_aave_exposure", target_units: "0.200000000000000000" },
      steps: [{ kind: "withdraw_aave_to_wallet", units: "0.200000000000000000" }],
    };
  }
  if (caseName === "reduce_total_exposure") {
    return {
      ...common,
      goal: { kind: "reduce_total_exposure", target_units: "0.100000000000000000" },
      steps: [{ kind: "withdraw_aave_to_wallet", units: "0.100000000000000000" }],
    };
  }
  return {
    ...common,
    goal: { kind: "supply_up_to", target_units: "0.300000000000000000" },
    steps: [
      { kind: "acquire_wsteth", units: "0.300000000000000000" },
      { kind: "supply_aave", units: "0.300000000000000000" },
    ],
  };
}

export function evaluateExposurePlanDemo(caseName: string): ExposurePlanRouteResponse {
  const supported: ExposurePlanCase[] = [
    "repair_over_limit",
    "restore_aave_cap",
    "reduce_total_exposure",
    "shared_budget",
    "aave_evidence_what_if",
  ];
  if (!supported.includes(caseName as ExposurePlanCase)) {
    return { statusCode: 404, payload: { status: "blocked", error: "not_found", details: ["Unknown exposure plan demo case"] } };
  }
  if (caseName === "shared_budget" || caseName === "aave_evidence_what_if") {
    return {
      statusCode: 409,
      payload: {
        status: "blocked",
        case_name: caseName as ExposurePlanCase,
        error: "task_3_boundary_unavailable",
        details: [
          caseName === "shared_budget"
            ? "Atomic reservations are outside Task 3."
            : "Runtime what-if evaluation is outside Task 3.",
        ],
        boundary: readOnlyBoundary(),
      },
    };
  }
  const graph = caseName === "restore_aave_cap"
    ? fixtureGraph({ direct_raw: "200000000000000000", aave_raw: "600000000000000000" })
    : fixtureGraph({ direct_raw: "400000000000000000", aave_raw: "400000000000000000" });
  return evaluationResponse(fixtureEvaluation(graph), demoPlan(caseName as ExposurePlanCase), DEFAULT_EXPOSURE_PLAN_POLICY, caseName as ExposurePlanCase);
}

function currentStoredEvaluation(
  state: ExposureRuntimeState,
  reference: string,
  now: Date,
): { status: "ok"; evaluation: ExposureEvaluation } | { status: "missing" | "expired" } {
  const stored = state.evaluations.get(reference);
  if (!stored) return { status: "missing" };
  if (stored.expires_at_ms <= now.getTime()) return { status: "expired" };
  return { status: "ok", evaluation: stored.evaluation };
}

export function evaluateExposurePlanRequest(
  input: unknown,
  dependencies: ExposurePlanServiceDependencies = {},
): ExposurePlanRouteResponse {
  const validation = validateExposurePlanServiceRequest(input);
  if (!validation.ok) return invalidRequest(validation.details);
  const now = dependencies.now ?? new Date();
  const state = dependencies.runtimeState ?? createExposureRuntimeState();
  const policy = dependencies.policy ?? DEFAULT_EXPOSURE_PLAN_POLICY;
  const stored = currentStoredEvaluation(state, validation.request.evaluation_ref, now);
  if (stored.status === "missing") return sourceFailureResponse("invalid_evaluation_reference", ["evaluation_reference_unknown"]);
  if (stored.status === "expired") return sourceFailureResponse("expired_evaluation_reference", ["evaluation_reference_expired"]);
  const result = evaluationResponse(stored.evaluation, validation.request.plan, policy);
  if (result.statusCode === 200 && result.payload && typeof result.payload === "object") {
    result.payload.validation = { ok: true };
  }
  return result;
}
