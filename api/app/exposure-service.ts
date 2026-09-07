import { randomUUID } from "node:crypto";

import {
  BASE_WSTETH_ADDRESS,
  type BaseWstEthResult,
  type RpcFetchLike,
  readBaseWstEthSnapshot,
} from "./base-rpc.ts";
import {
  buildExposureGraph,
  type ExposureGraphBuildResult,
} from "./exposure-graph.ts";
import { evaluateExposurePolicy } from "./exposure-policy.ts";
import { runGraphPositionQuery, type GraphFetchLike, type GraphPositionResult } from "./graph-client.ts";
import { resolveGraphPositionOptions } from "../../scripts/graph-position.ts";
import type {
  ExposureEvaluation,
  ExposureGraphV1,
  ExposureMode,
  ExposurePolicyConfig,
  ExposurePolicyDecision,
  ExposureRequest,
} from "../../shared/schemas/exposure-graph.ts";

export const DEFAULT_EXPOSURE_POLICY: ExposurePolicyConfig = {
  policy_version: "exposure-wsteth-v1",
  dependency_cap_units: "1.000000000000000000",
  unit: "wstETH",
};

export const DEFAULT_EXPOSURE_EVALUATION_TTL_MS = 60_000;

export type StoredExposureEvaluation = {
  evaluation: ExposureEvaluation;
  expires_at_ms: number;
};

export type ExposureRuntimeState = {
  evaluations: Map<string, StoredExposureEvaluation>;
  consumed_nonces: Set<string>;
  pending_accounts: Set<string>;
};

export type ExposureServiceDependencies = {
  graphOptions?: ReturnType<typeof resolveGraphPositionOptions>;
  fetchImpl?: GraphFetchLike;
  graphFetchImpl?: GraphFetchLike;
  rpcFetchImpl?: RpcFetchLike;
  now?: Date;
  mode?: ExposureMode;
  policy?: ExposurePolicyConfig;
  ttlMs?: number;
  runtimeState?: ExposureRuntimeState;
  graphQuery?: typeof runGraphPositionQuery;
  rpcReader?: typeof readBaseWstEthSnapshot;
  graphBuilder?: typeof buildExposureGraph;
  policyEvaluator?: typeof evaluateExposurePolicy;
};

export type ExposureEvaluationResponse = {
  status: "ok" | "blocked";
  mode: ExposureMode;
  request: ExposureRequest;
  graph: ExposureGraphV1 | null;
  policy: ExposurePolicyDecision;
  evaluation_ref: string | null;
  expires_at: string | null;
};

function createEmptyState(): ExposureRuntimeState {
  return {
    evaluations: new Map(),
    consumed_nonces: new Set(),
    pending_accounts: new Set(),
  };
}

export function createExposureRuntimeState(): ExposureRuntimeState {
  return createEmptyState();
}

function safeRequest(request: ExposureRequest): ExposureRequest {
  return {
    schema_version: request.schema_version,
    action: request.action,
    asset: request.asset,
    unit: request.unit,
    requested_units: request.requested_units,
  };
}

function deniedPolicy(
  request: ExposureRequest,
  policy: ExposurePolicyConfig,
  reason: string,
): ExposurePolicyDecision {
  return {
    verdict: "DENY",
    requested_units: request.requested_units,
    allowed_units: "0.000000000000000000",
    dependency_cap_units: policy.dependency_cap_units,
    gross_exposure_units: null,
    headroom_units: null,
    binding_constraint: "source_quality",
    policy_version: policy.policy_version,
    unit: "wstETH",
    reason_codes: [reason],
    debt_units: null,
  };
}

function pruneExpiredEvaluations(state: ExposureRuntimeState, nowMs: number): void {
  for (const [reference, stored] of state.evaluations) {
    if (stored.expires_at_ms <= nowMs) state.evaluations.delete(reference);
  }
}

export function getStoredExposureEvaluation(
  state: ExposureRuntimeState,
  reference: string,
  now = new Date(),
): ExposureEvaluation | null {
  pruneExpiredEvaluations(state, now.getTime());
  const stored = state.evaluations.get(reference);
  return stored?.evaluation ?? null;
}

function candidateObservation(graph: Extract<GraphPositionResult, { status: "ok" }>) {
  return graph.observations.find(
    (observation) => observation.asset.address.toLowerCase() === BASE_WSTETH_ADDRESS,
  ) ?? null;
}

function responseForFailure(
  request: ExposureRequest,
  mode: ExposureMode,
  policy: ExposurePolicyConfig,
  reason: string,
): ExposureEvaluationResponse {
  return {
    status: "blocked",
    mode,
    request: safeRequest(request),
    graph: null,
    policy: deniedPolicy(request, policy, reason),
    evaluation_ref: null,
    expires_at: null,
  };
}

export async function evaluateExposureRequest(
  request: ExposureRequest,
  dependencies: ExposureServiceDependencies = {},
): Promise<ExposureEvaluationResponse> {
  const requestValue = safeRequest(request);
  const policy = dependencies.policy ?? DEFAULT_EXPOSURE_POLICY;
  const mode = dependencies.mode ?? "live";
  const now = dependencies.now ?? new Date();
  const runtimeState = dependencies.runtimeState ?? createExposureRuntimeState();
  const graphOptions = dependencies.graphOptions ?? resolveGraphPositionOptions();
  const graphQuery = dependencies.graphQuery ?? runGraphPositionQuery;
  const rpcReader = dependencies.rpcReader ?? readBaseWstEthSnapshot;
  const graphBuilder = dependencies.graphBuilder ?? buildExposureGraph;
  const policyEvaluator = dependencies.policyEvaluator ?? evaluateExposurePolicy;

  let graphResult: GraphPositionResult;
  try {
    graphResult = await graphQuery({
      ...graphOptions,
      fetchImpl: dependencies.graphFetchImpl ?? dependencies.fetchImpl,
      now,
    });
  } catch {
    return responseForFailure(requestValue, mode, policy, "graph_adapter_error");
  }
  if (graphResult.status !== "ok") {
    return responseForFailure(requestValue, mode, policy, `graph_${graphResult.reason}`);
  }

  const observation = candidateObservation(graphResult);
  const graphBlock = graphResult.source.indexed_block;
  if (!observation || graphBlock.timestamp === null || !graphBlock.hash) {
    return responseForFailure(requestValue, mode, policy, "missing_wsteth_source");
  }

  let rpcResult: BaseWstEthResult;
  try {
    rpcResult = await rpcReader({
      account: graphResult.subject.account,
      graphBlock: {
        number: graphBlock.number,
        hash: graphBlock.hash,
        timestamp: graphBlock.timestamp,
      },
      graphObservation: observation,
      fetchImpl: dependencies.rpcFetchImpl,
    });
  } catch {
    return responseForFailure(requestValue, mode, policy, "rpc_adapter_error");
  }
  if (rpcResult.status !== "ok") {
    return responseForFailure(requestValue, mode, policy, `rpc_${rpcResult.reason}`);
  }

  let graphBuild: ExposureGraphBuildResult;
  try {
    graphBuild = graphBuilder({
      graph: graphResult,
      rpc: rpcResult.snapshot,
      mode,
    });
  } catch {
    return responseForFailure(requestValue, mode, policy, "exposure_graph_error");
  }
  if (graphBuild.status !== "ok") {
    return responseForFailure(requestValue, mode, policy, `exposure_graph_${graphBuild.reason}`);
  }

  const graph = graphBuild.graph.mode === mode
    ? graphBuild.graph
    : { ...graphBuild.graph, mode };
  let policyDecision: ExposurePolicyDecision;
  try {
    policyDecision = policyEvaluator(graph, policy, requestValue);
  } catch {
    return responseForFailure(requestValue, mode, policy, "policy_evaluator_error");
  }

  const ttlMs = Number.isSafeInteger(dependencies.ttlMs) && dependencies.ttlMs! > 0
    ? dependencies.ttlMs!
    : DEFAULT_EXPOSURE_EVALUATION_TTL_MS;
  const expiresAtMs = now.getTime() + ttlMs;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const evaluation: ExposureEvaluation = {
    schema_version: "exposure_evaluation.v1",
    mode,
    request: requestValue,
    graph,
    policy: policyDecision,
    created_at: now.toISOString(),
    expires_at: expiresAt,
  };
  const reference = `exposure_${randomUUID().replaceAll("-", "")}`;
  pruneExpiredEvaluations(runtimeState, now.getTime());
  runtimeState.evaluations.set(reference, { evaluation, expires_at_ms: expiresAtMs });

  return {
    status: "ok",
    mode,
    request: requestValue,
    graph,
    policy: policyDecision,
    evaluation_ref: reference,
    expires_at: expiresAt,
  };
}
