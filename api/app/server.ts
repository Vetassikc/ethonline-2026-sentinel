import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  buildSignedTradeIntentBundle,
  validateSignedTradeIntentBundle,
  verifySignedTradeIntentBundle,
} from "./erc8004.ts";
import {
  executeExposurePermit,
} from "./condition-check.ts";
import { resolveBaseRpcConfig } from "./base-rpc.ts";
import { evaluatePositionEvidencePolicy } from "./evidence-policy.ts";
import { issueExposurePermit, verifyExposurePermit } from "./exposure-permit.ts";
import {
  DEFAULT_EXPOSURE_EVALUATION_TTL_MS,
  DEFAULT_EXPOSURE_POLICY,
  createExposureRuntimeState,
  evaluateExposureRequest,
  getStoredExposureEvaluation,
  type ExposureRuntimeState,
  type ExposureServiceDependencies,
} from "./exposure-service.ts";
import {
  buildExposurePlanConfig,
  evaluateExposurePlanDemo,
  evaluateExposurePlanRequest,
  issueExposurePlanFixtureReference,
} from "./exposure-plan-service.ts";
import {
  acceptExposurePlanForOperator,
  authorizeExposureOperatorBootstrap,
  authorizeExposureOperatorRecovery,
  authorizeExposureOperatorMutation,
  buildExposurePlanRefreshSnapshot,
  cancelExposurePlanReservation,
  createExposurePlanOperatorSession,
  executeExposurePlanReservation,
  getExposureOperatorCookieToken,
  getExposureOperatorRecoveryChallenge,
  isExposureOperatorHostAllowed,
  issueExposurePlanPermitForReservation,
  resetExposurePlanOperatorSession,
  verifyExposurePlanPermitForOperator,
  type ExposurePlanOperatorBoundaryConfig,
  type ExposurePlanOperatorSession,
  type ExposurePlanRefreshResult,
  type OperatorRequestHeaders,
} from "./exposure-plan-authorization.ts";
import { validateSignedExposurePlanPermit } from "./exposure-plan-permit.ts";
import { MAX_EXPOSURE_REQUEST_UNITS, validateExposureRequest } from "./exposure-request.ts";
import { runGraphPositionQuery, type GraphFetchLike } from "./graph-client.ts";
import { buildKrakenCliPaperSmokeArtifact } from "./kraken-cli-compat.ts";
import { buildKrakenExecutionPreview } from "./execution-preview.ts";
import { normalizePositionEvidence } from "./position-evidence.ts";
import {
  evaluateTradeIntent,
  validatePermitVerificationRequest,
  validateTradeIntent,
  verifyTradePermit,
} from "./policy.ts";
import {
  isScenarioName,
  listScenarioNames,
  loadScenarioIntent,
} from "./scenarios.ts";
import {
  buildAgentRegistryAnchorPlan,
  getSharedSepoliaContracts,
  isSupportedAgentRegistryAnchor,
} from "./shared-sepolia.ts";
import { resolveGraphPositionOptions } from "../../scripts/graph-position.ts";
import type { ExposureEvaluation, ExposureRequest } from "../../shared/schemas/exposure-graph.ts";

type JudgeModeResponse = {
  statusCode: number;
  payload: unknown;
  contentType?: string;
  headers?: Record<string, string | string[]>;
};

export type PositionEvidenceRequestDependencies = {
  graphOptions?: ReturnType<typeof resolveGraphPositionOptions>;
  fetchImpl?: GraphFetchLike;
  now?: Date;
};

export type JudgeModeRequestDependencies = PositionEvidenceRequestDependencies & {
  exposureDependencies?: ExposureServiceDependencies;
  operatorBoundary?: ExposurePlanOperatorBoundaryConfig;
  planRefresh?: () => Promise<ExposurePlanRefreshResult>;
};

type ServerEnv = {
  HOST?: string;
  NODE_ENV?: string;
  PORT?: string;
};

const ROOT_DIR = new URL("../../", import.meta.url);
const EXPOSURE_RUNTIME_STATE = createExposureRuntimeState();
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const STATIC_ASSETS = {
  "/": {
    fileUrl: new URL("web/hub.html", ROOT_DIR),
    contentType: "text/html; charset=utf-8",
  },
  "/operator": {
    fileUrl: new URL("web/operator.html", ROOT_DIR),
    contentType: "text/html; charset=utf-8",
  },
  "/operator/": {
    fileUrl: new URL("web/operator.html", ROOT_DIR),
    contentType: "text/html; charset=utf-8",
  },
  "/judge": {
    fileUrl: new URL("web/index.html", ROOT_DIR),
    contentType: "text/html; charset=utf-8",
  },
  "/judge/": {
    fileUrl: new URL("web/index.html", ROOT_DIR),
    contentType: "text/html; charset=utf-8",
  },
  "/position-evidence": {
    fileUrl: new URL("web/position-evidence.html", ROOT_DIR),
    contentType: "text/html; charset=utf-8",
  },
  "/position-evidence/": {
    fileUrl: new URL("web/position-evidence.html", ROOT_DIR),
    contentType: "text/html; charset=utf-8",
  },
  "/exposure-graph": {
    fileUrl: new URL("web/exposure-graph.html", ROOT_DIR),
    contentType: "text/html; charset=utf-8",
  },
  "/exposure-graph/": {
    fileUrl: new URL("web/exposure-graph.html", ROOT_DIR),
    contentType: "text/html; charset=utf-8",
  },
  "/web/app.js": {
    fileUrl: new URL("web/app.js", ROOT_DIR),
    contentType: "text/javascript; charset=utf-8",
  },
  "/web/operator.js": {
    fileUrl: new URL("web/operator.js", ROOT_DIR),
    contentType: "text/javascript; charset=utf-8",
  },
  "/web/position-evidence.js": {
    fileUrl: new URL("web/position-evidence.js", ROOT_DIR),
    contentType: "text/javascript; charset=utf-8",
  },
  "/web/exposure-graph.js": {
    fileUrl: new URL("web/exposure-graph.js", ROOT_DIR),
    contentType: "text/javascript; charset=utf-8",
  },
  "/web/status-notes.js": {
    fileUrl: new URL("web/status-notes.js", ROOT_DIR),
    contentType: "text/javascript; charset=utf-8",
  },
  "/web/styles.css": {
    fileUrl: new URL("web/styles.css", ROOT_DIR),
    contentType: "text/css; charset=utf-8",
  },
} as const;

const PUBLIC_PNG_ASSET_PREFIXES = [
  "/assets/cover/",
  "/assets/screenshots/",
  "/assets/social/",
] as const;

export function getExposureRuntimeState(): ExposureRuntimeState {
  return EXPOSURE_RUNTIME_STATE;
}

function respond(
  response: ServerResponse,
  result: JudgeModeResponse,
): void {
  const isTextResponse = typeof result.payload === "string" && result.contentType !== undefined;
  const isBinaryResponse = Buffer.isBuffer(result.payload);
  const body = isTextResponse
    ? result.payload
    : isBinaryResponse
      ? result.payload
    : JSON.stringify(result.payload, null, 2);

  response.writeHead(result.statusCode, {
    ...(result.headers ?? {}),
    "content-type": result.contentType ?? "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function readStaticAsset(pathname: keyof typeof STATIC_ASSETS): Promise<string> {
  return readFile(STATIC_ASSETS[pathname].fileUrl, "utf8");
}

function resolvePublicPngAsset(pathname: string): URL | null {
  const isAllowedPrefix = PUBLIC_PNG_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!isAllowedPrefix || !pathname.endsWith(".png") || pathname.includes("..")) {
    return null;
  }

  return new URL(pathname.slice(1), ROOT_DIR);
}

function buildPipelineBundle(
  intent: Parameters<typeof evaluateTradeIntent>[0],
  bundleLabel: string,
) {
  const signedIntentBundle = buildSignedTradeIntentBundle(intent);
  const evaluation = evaluateTradeIntent(intent);
  const executionPreview = buildKrakenExecutionPreview(intent, evaluation);
  const krakenCliPaperArtifact = buildKrakenCliPaperSmokeArtifact(executionPreview);

  return {
    bundle_label: bundleLabel,
    intent,
    signed_intent_bundle: signedIntentBundle,
    signed_intent_verification: verifySignedTradeIntentBundle(signedIntentBundle),
    evaluation,
    permit_verification: verifyTradePermit({
      intent,
      signed_verdict: evaluation.signed_verdict,
    }),
    execution_preview: executionPreview,
    kraken_cli_paper_artifact: krakenCliPaperArtifact,
  };
}

function resolveExposureDependencies(
  dependencies: JudgeModeRequestDependencies,
): ExposureServiceDependencies {
  const exposureDependencies = dependencies.exposureDependencies ?? {};
  return {
    ...exposureDependencies,
    graphOptions: exposureDependencies.graphOptions ?? dependencies.graphOptions,
    fetchImpl: exposureDependencies.fetchImpl ?? dependencies.fetchImpl,
    now: exposureDependencies.now ?? dependencies.now,
    runtimeState: exposureDependencies.runtimeState ?? EXPOSURE_RUNTIME_STATE,
  };
}

function resolveOperatorClock(
  dependencies: JudgeModeRequestDependencies,
  exposureDependencies: ExposureServiceDependencies,
): () => Date {
  return () => dependencies.operatorBoundary?.clock?.()
    ?? exposureDependencies.now
    ?? new Date();
}

const PLAN_REFRESH_REQUEST: ExposureRequest = {
  schema_version: "sentinel-exposure-buy.v1",
  action: "BUY_EXPOSURE",
  asset: "wstETH",
  unit: "wstETH",
  requested_units: "0.000000000000000000",
};

async function refreshExposurePlanSource(
  dependencies: JudgeModeRequestDependencies,
  exposureDependencies: ExposureServiceDependencies,
  runtimeState: ExposureRuntimeState,
  session: ExposurePlanOperatorSession,
): Promise<ExposurePlanRefreshResult> {
  if (dependencies.planRefresh) return dependencies.planRefresh();
  const refreshed = await evaluateExposureRequest(PLAN_REFRESH_REQUEST, exposureDependencies);
  if (refreshed.status !== "ok" || !refreshed.evaluation_ref) {
    return { status: "blocked", code: "SOURCE_UNAVAILABLE" };
  }
  const evaluation = getStoredExposureEvaluation(runtimeState, refreshed.evaluation_ref, exposureDependencies.now ?? new Date());
  if (!evaluation) return { status: "blocked", code: "SOURCE_UNAVAILABLE" };
  return buildExposurePlanRefreshSnapshot(refreshed.evaluation_ref, evaluation, {
    session_id: session.session_id,
    runtime_generation: session.runtime_generation,
    mode: "live",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function invalidExposureRouteRequest(details: string): JudgeModeResponse {
  return {
    statusCode: 400,
    payload: { error: "invalid_exposure_route_request", details: [details] },
  };
}

function buildExposureConfig(): Record<string, unknown> {
  const graphOptions = resolveGraphPositionOptions();
  const rpcConfig = resolveBaseRpcConfig();
  return {
    schema_version: "sentinel-exposure-config.v1",
    supported_action: {
      schema_version: "sentinel-exposure-buy.v1",
      action: "BUY_EXPOSURE",
      asset: "wstETH",
      unit: "wstETH",
      max_request_units: MAX_EXPOSURE_REQUEST_UNITS,
    },
    policy: DEFAULT_EXPOSURE_POLICY,
    evaluation_ttl_seconds: DEFAULT_EXPOSURE_EVALUATION_TTL_MS / 1000,
    source: {
      graph_subgraph_id: graphOptions.subgraphId ?? null,
      chain_id: 8453,
      rpc_endpoint: rpcConfig.status === "ok" ? rpcConfig.config.public_endpoint : "server_configured_base_rpc",
      rpc_configuration: rpcConfig.status === "ok" ? "ok" : "blocked",
      rpc_configured: rpcConfig.status === "ok" && rpcConfig.config.source === "environment",
      account_configured: Boolean(graphOptions.account),
      account_source: "server_configuration",
    },
  };
}

function buildReplayEvaluation(evaluation: ExposureEvaluation): ExposureEvaluation {
  const replayHash = `0x${"cc".repeat(32)}`;
  return {
    ...evaluation,
    mode: "replay",
    graph: {
      ...evaluation.graph,
      mode: "replay",
      source: {
        ...evaluation.graph.source,
        block: {
          ...evaluation.graph.source.block,
          number: evaluation.graph.source.block.number + 1,
          hash: replayHash,
          timestamp: evaluation.graph.source.block.timestamp + 1,
        },
      },
      graph_hash: `0x${"dd".repeat(32)}`,
    },
    policy: {
      ...evaluation.policy,
      verdict: "DENY",
      allowed_units: "0.000000000000000000",
      headroom_units: "0.000000000000000000",
      binding_constraint: "dependency_cap",
      reason_codes: ["replay_exhausted_headroom"],
    },
  };
}

async function buildScenarioBundle(
  pathname: string,
  dependencies: JudgeModeRequestDependencies = {},
): Promise<JudgeModeResponse | null> {
  if (pathname === "/healthz") {
    return {
      statusCode: 200,
      payload: {
        status: "ok",
        service: "vartovii-sentinel-8004",
        judge_mode: true,
      },
    };
  }

  if (pathname === "/api/demo/scenarios") {
    return {
      statusCode: 200,
      payload: {
        scenarios: listScenarioNames(),
      },
    };
  }

  if (pathname === "/api/exposure/config") {
    return {
      statusCode: 200,
      payload: buildExposureConfig(),
    };
  }

  if (pathname === "/api/exposure/plan/config") {
    return {
      statusCode: 200,
      payload: buildExposurePlanConfig(),
    };
  }

  if (pathname === "/api/exposure/plan/source/fixture") {
    const exposureDependencies = resolveExposureDependencies(dependencies);
    return issueExposurePlanFixtureReference("repair_over_limit", {
      runtimeState: exposureDependencies.runtimeState,
      now: exposureDependencies.now,
    });
  }

  const exposurePlanFixtureSourcePrefix = "/api/exposure/plan/source/fixture/";
  if (pathname.startsWith(exposurePlanFixtureSourcePrefix)) {
    const caseName = pathname.slice(exposurePlanFixtureSourcePrefix.length);
    const exposureDependencies = resolveExposureDependencies(dependencies);
    return issueExposurePlanFixtureReference(caseName as Parameters<typeof issueExposurePlanFixtureReference>[0], {
      runtimeState: exposureDependencies.runtimeState,
      now: exposureDependencies.now,
    });
  }

  const exposurePlanDemoPrefix = "/api/exposure/plan/demo/";
  if (pathname.startsWith(exposurePlanDemoPrefix)) {
    const caseName = pathname.slice(exposurePlanDemoPrefix.length);
    return evaluateExposurePlanDemo(caseName);
  }

  if (pathname === "/api/demo/shared-sepolia") {
    return {
      statusCode: 200,
      payload: {
        contracts: getSharedSepoliaContracts(),
      },
    };
  }

  const agentRegistryAnchorPrefix = "/api/demo/shared-sepolia/agent-registry-anchor/";
  if (pathname.startsWith(agentRegistryAnchorPrefix)) {
    const agentId = pathname.slice(agentRegistryAnchorPrefix.length);
    if (!isSupportedAgentRegistryAnchor(agentId)) {
      return {
        statusCode: 404,
        payload: {
          error: "not_found",
          details: [`Unknown shared-Sepolia anchor agent: ${agentId}`],
        },
      };
    }

    return {
      statusCode: 200,
      payload: buildAgentRegistryAnchorPlan(agentId),
    };
  }

  const executionPreviewPrefix = "/api/demo/execution-previews/";
  if (pathname.startsWith(executionPreviewPrefix)) {
    const scenarioName = pathname.slice(executionPreviewPrefix.length);
    if (!isScenarioName(scenarioName)) {
      return {
        statusCode: 404,
        payload: {
          error: "not_found",
          details: [`Unknown scenario: ${scenarioName}`],
        },
      };
    }

    const intent = await loadScenarioIntent(scenarioName);
    const evaluation = evaluateTradeIntent(intent);

    return {
      statusCode: 200,
      payload: buildKrakenExecutionPreview(intent, evaluation),
    };
  }

  const signedIntentPrefix = "/api/demo/signed-intents/";
  if (pathname.startsWith(signedIntentPrefix)) {
    const scenarioName = pathname.slice(signedIntentPrefix.length);
    if (!isScenarioName(scenarioName)) {
      return {
        statusCode: 404,
        payload: {
          error: "not_found",
          details: [`Unknown scenario: ${scenarioName}`],
        },
      };
    }

    const intent = await loadScenarioIntent(scenarioName);
    const signedIntentBundle = buildSignedTradeIntentBundle(intent);

    return {
      statusCode: 200,
      payload: signedIntentBundle,
    };
  }

  const prefix = "/api/demo/scenarios/";
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const scenarioName = pathname.slice(prefix.length);
  if (!isScenarioName(scenarioName)) {
    return {
      statusCode: 404,
      payload: {
        error: "not_found",
        details: [`Unknown scenario: ${scenarioName}`],
      },
    };
  }

  const intent = await loadScenarioIntent(scenarioName);

  return {
    statusCode: 200,
    payload: {
      scenario_name: scenarioName,
      ...buildPipelineBundle(intent, scenarioName),
    },
  };
}

export function resolveServerConfig(env: ServerEnv = process.env): {
  host: string;
  port: number;
} {
  const port = Number(env.PORT ?? "8787");
  const host = env.HOST ?? (env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

  return {
    host,
    port,
  };
}

type RawBodyResult =
  | { ok: true; body: string }
  | { ok: false; error: "request_body_too_large" };

async function readRawBody(request: IncomingMessage): Promise<RawBodyResult> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      return { ok: false, error: "request_body_too_large" };
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return { ok: true, body: "" };
  }

  return { ok: true, body: Buffer.concat(chunks).toString("utf8") };
}

export async function buildPositionEvidenceEvaluation(
  intent: Parameters<typeof evaluateTradeIntent>[0],
  dependencies: PositionEvidenceRequestDependencies = {},
): Promise<JudgeModeResponse> {
  const graphOptions = dependencies.graphOptions ?? resolveGraphPositionOptions();
  const graphResult = await runGraphPositionQuery({
    ...graphOptions,
    fetchImpl: dependencies.fetchImpl,
    now: dependencies.now,
  });

  if (graphResult.status !== "ok") {
    return {
      statusCode: 503,
      payload: graphResult,
    };
  }

  const evidence = normalizePositionEvidence(graphResult, {
    expected_account: graphOptions.account,
    expected_chain_id: graphOptions.chainId === undefined
      ? undefined
      : Number(graphOptions.chainId),
    expected_subgraph_id: graphOptions.subgraphId,
    now: dependencies.now,
  });
  const policy = evaluatePositionEvidencePolicy(intent, evidence);

  return {
    statusCode: 200,
    payload: {
      status: "ok",
      intent,
      evidence,
      policy,
    },
  };
}

export async function handleJudgeModeRequest(
  method: string,
  pathname: string,
  rawBody: string,
  dependencies: JudgeModeRequestDependencies = {},
  requestContext: { headers?: OperatorRequestHeaders } = {},
): Promise<JudgeModeResponse> {
  if (method === "POST" && Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BODY_BYTES) {
    return {
      statusCode: 413,
      payload: { error: "request_body_too_large" },
    };
  }
  if (method === "GET" && pathname in STATIC_ASSETS) {
    return {
      statusCode: 200,
      payload: await readStaticAsset(pathname as keyof typeof STATIC_ASSETS),
      contentType: STATIC_ASSETS[pathname as keyof typeof STATIC_ASSETS].contentType,
    };
  }

  if (method === "GET") {
    const publicPngAsset = resolvePublicPngAsset(pathname);
    if (publicPngAsset) {
      try {
        return {
          statusCode: 200,
          payload: await readFile(publicPngAsset),
          contentType: "image/png",
        };
      } catch {
        return {
          statusCode: 404,
          payload: {
            error: "not_found",
            details: [`No public asset for ${pathname}`],
          },
        };
      }
    }
  }

  if (method === "GET" && pathname === "/api/exposure/operator/session") {
    const exposureDependencies = resolveExposureDependencies(dependencies);
    const runtimeState = exposureDependencies.runtimeState ?? EXPOSURE_RUNTIME_STATE;
    const operatorClock = resolveOperatorClock(dependencies, exposureDependencies);
    const operatorNow = operatorClock();
    const bootstrap = authorizeExposureOperatorBootstrap(
      runtimeState,
      requestContext.headers ?? {},
      { now: operatorNow, boundary: dependencies.operatorBoundary },
    );
    if (!bootstrap.ok) return { statusCode: bootstrap.statusCode, payload: bootstrap.payload };
    const issued = createExposurePlanOperatorSession(runtimeState, {
      cookie_token: bootstrap.cookie_token ?? getExposureOperatorCookieToken(requestContext.headers ?? {}),
      now: operatorNow,
      boundary: dependencies.operatorBoundary,
    });
    return {
      statusCode: 200,
      payload: issued.session,
      ...(issued.set_cookie ? { headers: { "set-cookie": issued.set_cookie } } : {}),
    };
  }

  if (method === "GET" && pathname === "/api/exposure/operator/session/recover") {
    const exposureDependencies = resolveExposureDependencies(dependencies);
    const runtimeState = exposureDependencies.runtimeState ?? EXPOSURE_RUNTIME_STATE;
    const operatorClock = resolveOperatorClock(dependencies, exposureDependencies);
    const challenge = getExposureOperatorRecoveryChallenge(
      runtimeState,
      requestContext.headers ?? {},
      { now: operatorClock(), boundary: dependencies.operatorBoundary },
    );
    if (!challenge.ok) return { statusCode: challenge.statusCode, payload: challenge.payload };
    return { statusCode: 200, payload: challenge.challenge };
  }

  if (method === "GET") {
    const scenarioBundle = await buildScenarioBundle(pathname, dependencies);
    if (scenarioBundle) {
      return scenarioBundle;
    }
  }

  if (method === "POST" && pathname.startsWith("/api/exposure/")) {
    const exposureDependencies = resolveExposureDependencies(dependencies);
    const operatorClock = resolveOperatorClock(dependencies, exposureDependencies);
    const now = operatorClock();
    const runtimeState = exposureDependencies.runtimeState ?? EXPOSURE_RUNTIME_STATE;
    const operatorMutationRoutes = new Set([
      "/api/exposure/operator/session/reset",
      "/api/exposure/plan/accept",
      "/api/exposure/reservation/execute",
      "/api/exposure/reservation/cancel",
      "/api/exposure/plan/permit",
      "/api/exposure/plan/verify",
    ]);
    let operatorSession: Parameters<typeof acceptExposurePlanForOperator>[1] | undefined;
    let recoverySession: Parameters<typeof acceptExposurePlanForOperator>[1] | undefined;
    if (pathname === "/api/exposure/operator/session/recover") {
      const recoveryAuthorization = authorizeExposureOperatorRecovery(
        runtimeState,
        requestContext.headers ?? {},
        { now, boundary: dependencies.operatorBoundary },
      );
      if (!recoveryAuthorization.ok) {
        return { statusCode: recoveryAuthorization.statusCode, payload: recoveryAuthorization.payload };
      }
      recoverySession = recoveryAuthorization.session;
    }
    if (operatorMutationRoutes.has(pathname)) {
      const authorization = authorizeExposureOperatorMutation(
        runtimeState,
        requestContext.headers ?? {},
        { now, boundary: dependencies.operatorBoundary },
      );
      if (!authorization.ok) {
        return { statusCode: authorization.statusCode, payload: authorization.payload };
      }
      operatorSession = authorization.session;
    }
    let payload: unknown;
    try {
      payload = rawBody.length === 0 ? {} : JSON.parse(rawBody);
    } catch {
      return {
        statusCode: 400,
        payload: { error: "invalid_json" },
      };
    }

    if (pathname === "/api/exposure/plan/validate") {
      const result = evaluateExposurePlanRequest(payload, {
        runtimeState,
        now,
      });
      return result;
    }

    if (pathname === "/api/exposure/plan/accept") {
      if (!operatorSession || !isRecord(payload) || !hasExactKeys(payload, ["evaluation_ref", "plan", "idempotency_key", "accept_partial"])) {
        return invalidExposureRouteRequest("Only evaluation_ref, plan, idempotency_key and accept_partial are accepted.");
      }
      return acceptExposurePlanForOperator(runtimeState, operatorSession, {
        evaluation_ref: payload.evaluation_ref as string,
        plan: payload.plan,
        idempotency_key: payload.idempotency_key as string,
        accept_partial: payload.accept_partial as boolean,
      }, { now });
    }

    if (pathname === "/api/exposure/operator/session/recover") {
      if (!recoverySession || !isRecord(payload) || !hasExactKeys(payload, ["disposition"]) || payload.disposition !== "discard_paper_context") {
        return invalidExposureRouteRequest("Only disposition=discard_paper_context is accepted for expired-session recovery.");
      }
      const recovered = resetExposurePlanOperatorSession(runtimeState, recoverySession, {
        now,
        boundary: dependencies.operatorBoundary,
      });
      if (!recovered) return { statusCode: 409, payload: { error: "operator_session_recovery_unavailable" } };
      return {
        statusCode: 200,
        payload: recovered.session,
        headers: { "set-cookie": recovered.set_cookie },
      };
    }

    if (pathname === "/api/exposure/operator/session/reset") {
      if (!operatorSession || !isRecord(payload) || !hasExactKeys(payload, [])) {
        return invalidExposureRouteRequest("The session reset body must be an empty JSON object.");
      }
      const reset = resetExposurePlanOperatorSession(runtimeState, operatorSession, {
        now,
        boundary: dependencies.operatorBoundary,
      });
      if (!reset) return { statusCode: 409, payload: { error: "operator_session_reset_unavailable" } };
      return {
        statusCode: 200,
        payload: reset.session,
        headers: { "set-cookie": reset.set_cookie },
      };
    }

    if (pathname === "/api/exposure/reservation/cancel") {
      if (!operatorSession || !isRecord(payload) || !hasExactKeys(payload, ["reservation_id", "reason"])) {
        return invalidExposureRouteRequest("Only reservation_id and reason are accepted.");
      }
      if (typeof payload.reservation_id !== "string" || typeof payload.reason !== "string") {
        return invalidExposureRouteRequest("reservation_id and reason must be bounded strings.");
      }
      return cancelExposurePlanReservation(runtimeState, operatorSession, {
        reservation_id: payload.reservation_id,
        reason: payload.reason,
      }, { now });
    }

    if (pathname === "/api/exposure/plan/permit") {
      if (!operatorSession || !isRecord(payload) || !hasExactKeys(payload, ["reservation_id", "session_id", "mode"])) {
        return invalidExposureRouteRequest("Only reservation_id, session_id and mode are accepted.");
      }
      if (typeof payload.reservation_id !== "string" || typeof payload.session_id !== "string" || (payload.mode !== "live" && payload.mode !== "what_if")) {
        return invalidExposureRouteRequest("reservation_id, session_id and mode are bounded values.");
      }
      return issueExposurePlanPermitForReservation(runtimeState, operatorSession, {
        reservation_id: payload.reservation_id,
        session_id: payload.session_id,
        mode: payload.mode,
      }, { now });
    }

    if (pathname === "/api/exposure/plan/verify") {
      if (!operatorSession || !isRecord(payload) || !hasExactKeys(payload, ["permit", "session_id", "mode"])) {
        return invalidExposureRouteRequest("Only permit, session_id and mode are accepted.");
      }
      if (typeof payload.session_id !== "string" || (payload.mode !== "live" && payload.mode !== "what_if")) {
        return invalidExposureRouteRequest("session_id and mode are bounded values.");
      }
      const permitValidation = validateSignedExposurePlanPermit(payload.permit);
      if (!permitValidation.ok) return { statusCode: 400, payload: { error: "invalid_plan_permit", details: permitValidation.details } };
      if (payload.session_id !== operatorSession.session_id || payload.mode !== permitValidation.permit.payload.mode) {
        return { statusCode: 409, payload: { status: "rejected", code: "SESSION_CONTEXT_MISMATCH" } };
      }
      return { statusCode: 200, payload: verifyExposurePlanPermitForOperator(permitValidation.permit, now) };
    }

    if (pathname === "/api/exposure/reservation/execute") {
      if (!operatorSession || !isRecord(payload) || !hasExactKeys(payload, ["reservation_id", "permit", "session_id", "mode"])) {
        return invalidExposureRouteRequest("Only reservation_id, permit, session_id and mode are accepted.");
      }
      if (typeof payload.reservation_id !== "string" || typeof payload.session_id !== "string" || (payload.mode !== "live" && payload.mode !== "what_if")) {
        return invalidExposureRouteRequest("reservation_id, session_id and mode are bounded values.");
      }
      const permitValidation = validateSignedExposurePlanPermit(payload.permit);
      if (!permitValidation.ok) return { statusCode: 400, payload: { error: "invalid_plan_permit", details: permitValidation.details } };
      if (payload.session_id !== operatorSession.session_id || payload.mode !== permitValidation.permit.payload.mode) {
        return { statusCode: 409, payload: { status: "rejected", code: "SESSION_CONTEXT_MISMATCH" } };
      }
      const result = await executeExposurePlanReservation(
        runtimeState,
        {
          reservation_id: payload.reservation_id,
          permit: permitValidation.permit,
          session_id: payload.session_id,
          mode: payload.mode,
          clock: operatorClock,
          now,
        },
        () => refreshExposurePlanSource(dependencies, exposureDependencies, runtimeState, operatorSession!),
      );
      return {
        statusCode: result.status === "paper_executed" ? 200 : result.code === "CURRENT_SOURCE_UNAVAILABLE" ? 503 : 409,
        payload: result,
      };
    }

    if (pathname === "/api/exposure/evaluate") {
      const validation = validateExposureRequest(payload);
      if (!validation.ok) {
        return {
          statusCode: 400,
          payload: { error: validation.error.code, details: validation.error.details },
        };
      }
      const result = await evaluateExposureRequest(validation.request, exposureDependencies);
      return {
        statusCode: result.status === "ok" ? 200 : 503,
        payload: result,
      };
    }

    if (pathname === "/api/exposure/permit") {
      if (!isRecord(payload) || !hasOnlyKeys(payload, ["evaluation_ref", "nonce", "audience"])) {
        return invalidExposureRouteRequest("Only evaluation_ref, nonce and audience are accepted.");
      }
      if (
        typeof payload.evaluation_ref !== "string"
        || !/^exposure_[0-9a-f]{32}$/.test(payload.evaluation_ref)
        || (payload.nonce !== undefined && typeof payload.nonce !== "string")
        || (payload.audience !== undefined && typeof payload.audience !== "string")
      ) {
        return invalidExposureRouteRequest("evaluation_ref, nonce and audience must be bounded strings.");
      }
      const evaluation = getStoredExposureEvaluation(runtimeState, payload.evaluation_ref, now);
      if (!evaluation) {
        return { statusCode: 400, payload: { error: "invalid_evaluation_reference" } };
      }
      const issued = issueExposurePermit(evaluation, {
        now,
        ...(payload.nonce === undefined ? {} : { nonce: payload.nonce }),
        ...(payload.audience === undefined ? {} : { audience: payload.audience }),
      });
      return {
        statusCode: issued.status === "issued" ? 200 : 403,
        payload: issued,
      };
    }

    if (pathname === "/api/exposure/verify") {
      if (!isRecord(payload) || !hasExactKeys(payload, ["request", "permit"])) {
        return invalidExposureRouteRequest("Only request and permit are accepted.");
      }
      const validation = validateExposureRequest(payload.request);
      if (!validation.ok) {
        return {
          statusCode: 400,
          payload: { error: validation.error.code, details: validation.error.details },
        };
      }
      if (!isRecord(payload.permit)) {
        return invalidExposureRouteRequest("permit must be an object.");
      }
      return {
        statusCode: 200,
        payload: verifyExposurePermit({
          request: validation.request,
          permit: payload.permit as never,
          now,
        }),
      };
    }

    if (pathname === "/api/exposure/paper-execute") {
      if (!isRecord(payload) || !hasExactKeys(payload, ["request", "permit"])) {
        return invalidExposureRouteRequest("Only request and permit are accepted.");
      }
      const validation = validateExposureRequest(payload.request);
      if (!validation.ok) {
        return {
          statusCode: 400,
          payload: { error: validation.error.code, details: validation.error.details },
        };
      }
      if (!isRecord(payload.permit)) {
        return invalidExposureRouteRequest("permit must be an object.");
      }
      const result = await executeExposurePermit({
        request: validation.request,
        permit: payload.permit as never,
        state: runtimeState,
        now,
        refresh: async () => {
          const refreshed = await evaluateExposureRequest(validation.request, exposureDependencies);
          if (refreshed.status !== "ok" || !refreshed.evaluation_ref) {
            return { status: "blocked" as const, code: "CURRENT_SOURCE_UNAVAILABLE" };
          }
          return getStoredExposureEvaluation(runtimeState, refreshed.evaluation_ref, now)
            ?? { status: "blocked" as const, code: "CURRENT_SOURCE_UNAVAILABLE" };
        },
      });
      return {
        statusCode: result.executable ? 200 : result.code === "REFRESH_FAILED" ? 503 : 409,
        payload: result,
      };
    }

    if (pathname === "/api/exposure/replay") {
      if (!isRecord(payload) || !hasExactKeys(payload, ["evaluation_ref"])) {
        return invalidExposureRouteRequest("Only evaluation_ref is accepted.");
      }
      if (typeof payload.evaluation_ref !== "string" || !/^exposure_[0-9a-f]{32}$/.test(payload.evaluation_ref)) {
        return invalidExposureRouteRequest("evaluation_ref must be a bounded evaluation reference.");
      }
      const evaluation = getStoredExposureEvaluation(runtimeState, payload.evaluation_ref, now);
      if (!evaluation) {
        return { statusCode: 400, payload: { error: "invalid_evaluation_reference" } };
      }
      return {
        statusCode: 200,
        payload: {
          status: "ok",
          evaluation_ref: payload.evaluation_ref,
          ...buildReplayEvaluation(evaluation),
        },
      };
    }

    return {
      statusCode: 404,
      payload: { error: "not_found", details: [`No route for ${method} ${pathname}`] },
    };
  }

  if (method === "POST" && pathname === "/api/position-evidence/evaluate") {
    try {
      const payload = rawBody.length === 0 ? {} : JSON.parse(rawBody);
      const validation = validateTradeIntent(payload);
      if (!validation.ok) {
        return {
          statusCode: 400,
          payload: validation.error,
        };
      }

      return buildPositionEvidenceEvaluation(validation.value, dependencies);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown JSON parsing error.";

      return {
        statusCode: 400,
        payload: {
          error: "invalid_json",
          details: [message],
        },
      };
    }
  }

  if (
    method === "POST" &&
    (
      pathname === "/api/demo/evaluate-intent" ||
      pathname === "/api/demo/run-pipeline" ||
      pathname === "/api/demo/verify-permit" ||
      pathname === "/api/demo/verify-signed-intent"
    )
  ) {
    try {
      const payload = rawBody.length === 0 ? {} : JSON.parse(rawBody);

      if (pathname === "/api/demo/evaluate-intent") {
        const validation = validateTradeIntent(payload);
        if (!validation.ok) {
          return {
            statusCode: 400,
            payload: validation.error,
          };
        }

        return {
          statusCode: 200,
          payload: evaluateTradeIntent(validation.value),
        };
      }

      if (pathname === "/api/demo/run-pipeline") {
        const validation = validateTradeIntent(payload);
        if (!validation.ok) {
          return {
            statusCode: 400,
            payload: validation.error,
          };
        }

        return {
          statusCode: 200,
          payload: buildPipelineBundle(validation.value, validation.value.intent_id),
        };
      }

      if (pathname === "/api/demo/verify-signed-intent") {
        const validation = validateSignedTradeIntentBundle(payload);
        if (!validation.ok) {
          return {
            statusCode: 400,
            payload: validation.error,
          };
        }

        return {
          statusCode: 200,
          payload: verifySignedTradeIntentBundle(validation.value),
        };
      }

      const validation = validatePermitVerificationRequest(payload);
      if (!validation.ok) {
        return {
          statusCode: 400,
          payload: validation.error,
        };
      }

      return {
        statusCode: 200,
        payload: verifyTradePermit(validation.value),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown JSON parsing error.";

      return {
        statusCode: 400,
        payload: {
          error: "invalid_json",
          details: [message],
        },
      };
    }
  }

  return {
    statusCode: 404,
    payload: {
      error: "not_found",
      details: [`No route for ${method} ${pathname}`],
    },
  };
}

export function createJudgeModeServer(options: {
  operatorBoundary?: ExposurePlanOperatorBoundaryConfig;
  exposureDependencies?: ExposureServiceDependencies;
  planRefresh?: () => Promise<ExposurePlanRefreshResult>;
} = {}) {
  const serverConfig = resolveServerConfig();
  const configuredOrigin = options.operatorBoundary?.allowed_origin
    ?? process.env.SENTINEL_ALLOWED_ORIGIN
    ?? `http://127.0.0.1:${serverConfig.port}`;
  const operatorBoundary: ExposurePlanOperatorBoundaryConfig = {
    ...options.operatorBoundary,
    allowed_origin: configuredOrigin,
    allowed_host: options.operatorBoundary?.allowed_host
      ?? (() => {
        try {
          return new URL(configuredOrigin).host;
        } catch {
          return `127.0.0.1:${serverConfig.port}`;
        }
      })(),
  };
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const rawBodyResult = request.method === "POST"
      ? await readRawBody(request)
      : { ok: true as const, body: "" };
    if (!rawBodyResult.ok) {
      respond(response, {
        statusCode: 413,
        payload: { error: rawBodyResult.error },
      });
      return;
    }
    const result = await handleJudgeModeRequest(
      request.method ?? "UNKNOWN",
      requestUrl.pathname,
      rawBodyResult.body,
      {
        operatorBoundary,
        exposureDependencies: options.exposureDependencies,
        planRefresh: options.planRefresh,
      },
      { headers: request.headers },
    );
    respond(response, result);
  });
}

const isEntryPoint =
  typeof process.argv[1] === "string" &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isEntryPoint) {
  const { host, port } = resolveServerConfig();
  const server = createJudgeModeServer();
  server.listen(port, host, () => {
    console.log(`Sentinel judge mode listening on http://${host}:${port}`);
  });
}
