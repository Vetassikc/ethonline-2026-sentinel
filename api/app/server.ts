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
import type { ExposureEvaluation } from "../../shared/schemas/exposure-graph.ts";

type JudgeModeResponse = {
  statusCode: number;
  payload: unknown;
  contentType?: string;
};

export type PositionEvidenceRequestDependencies = {
  graphOptions?: ReturnType<typeof resolveGraphPositionOptions>;
  fetchImpl?: GraphFetchLike;
  now?: Date;
};

export type JudgeModeRequestDependencies = PositionEvidenceRequestDependencies & {
  exposureDependencies?: ExposureServiceDependencies;
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
      rpc_endpoint: "https://mainnet.base.org",
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

async function buildScenarioBundle(pathname: string): Promise<JudgeModeResponse | null> {
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

  if (method === "GET") {
    const scenarioBundle = await buildScenarioBundle(pathname);
    if (scenarioBundle) {
      return scenarioBundle;
    }
  }

  if (method === "POST" && pathname.startsWith("/api/exposure/")) {
    let payload: unknown;
    try {
      payload = rawBody.length === 0 ? {} : JSON.parse(rawBody);
    } catch {
      return {
        statusCode: 400,
        payload: { error: "invalid_json" },
      };
    }

    const exposureDependencies = resolveExposureDependencies(dependencies);
    const now = exposureDependencies.now ?? new Date();
    const runtimeState = exposureDependencies.runtimeState ?? EXPOSURE_RUNTIME_STATE;

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

export function createJudgeModeServer() {
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
