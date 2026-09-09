import {
  EXPOSURE_GRAPH_TOOL_NAME,
  EXPOSURE_GRAPH_TOOL_SCHEMA_VERSION,
  EXPOSURE_GRAPH_TOOL_DEFINITION,
  runExposureGraphTool,
  validateExposureGraphToolRequest,
} from "./exposure-tool.ts";
import type { ExposureRequest } from "../../shared/schemas/exposure-graph.ts";

export const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
export const OPENROUTER_RESPONSES_ENDPOINT = "https://openrouter.ai/api/v1/responses";
export const DEFAULT_OPENAI_MODEL = "gpt-5";
export const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.8-flash";
export const MAX_NATURAL_LANGUAGE_REQUEST_CHARS = 2_000;
export const MAX_MODEL_RESPONSE_CHARS = 4_000;
export const ROUTER_MAX_OUTPUT_TOKENS = 2_000;
export const EXPLANATION_MAX_OUTPUT_TOKENS = 1_000;

export type ExternalAIProvider = "openai" | "openrouter";
type ExternalAIClientName = "openai_responses_api" | "openrouter_responses_api";

type JsonRecord = Record<string, unknown>;

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type OpenAIExposureFetch = (
  input: string,
  init?: RequestInit,
) => Promise<FetchResponse>;

type ToolRunner = (
  input: unknown,
) => Promise<{ statusCode: number; payload: unknown }>;

type OpenAIResponse = {
  output?: unknown;
  output_text?: unknown;
};

export type SanitizedExposureToolResult = {
  status_code: number;
  tool_name: string;
  schema_version: string;
  request: ExposureRequest;
  result: {
    status: string | null;
    mode: string | null;
    policy: {
      verdict: string | null;
      requested_units: string | null;
      allowed_units: string | null;
      gross_exposure_units: string | null;
      headroom_units: string | null;
      binding_constraint: string | null;
      reason_codes: string[];
    };
    source: {
      source_status: string | null;
      block: number | null;
      path_kinds: string[];
      gaps: string[];
    } | null;
  };
  authority_boundary: {
    account: "server_configuration";
    chain: "server_configuration";
    policy: "server_configuration";
    provider: "server_configuration";
    signing: "outside_model_control";
    execution: "outside_model_control";
    read_only: true;
  };
};

export type OpenAIExposureClientResult =
  | {
    status: "ok";
    client: ExternalAIClientName;
    model: string;
    natural_language_request: string;
    model_tool_call: {
      name: "sentinel_exposure_graph";
      arguments: ExposureRequest;
    };
    tool_result: SanitizedExposureToolResult;
    application_generated_summary: string;
    model_response: string;
  }
  | {
    status: "blocked";
    client: ExternalAIClientName;
    code:
      | "missing_configuration"
      | "invalid_configuration"
      | "invalid_natural_language_request"
      | "external_request_failed"
      | "model_did_not_call_tool"
      | "unexpected_tool_call"
      | "invalid_tool_arguments"
      | "tool_execution_failed"
      | "model_response_failed";
    details: string[];
    http_status?: number;
  };

type OpenAIExposureClientOptions = {
  naturalLanguageRequest: string;
  provider?: ExternalAIProvider;
  apiKey?: string;
  model?: string;
  fetchImpl?: OpenAIExposureFetch;
  toolRunner?: ToolRunner;
};

const ROUTER_INSTRUCTIONS = [
  "You are a constrained read-only routing layer for Sentinel Exposure Graph.",
  "Use the single sentinel_exposure_graph function exactly once for a bounded wstETH exposure request.",
  "Translate only the user's requested wstETH amount into the exact versioned request schema.",
  "Never choose or request an account, chain, cap, policy, provider URL, signer, permit, or execution route.",
  "The function is read-only and its result is a signal/policy decision, not a trade authorization or transaction.",
  "After the function result, explain the observed source status, policy verdict and relevant gaps without inventing facts.",
].join(" ");

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function blocked(
  code: Extract<OpenAIExposureClientResult, { status: "blocked" }>["code"],
  details: string[],
  httpStatus?: number,
  client: ExternalAIClientName = "openai_responses_api",
): OpenAIExposureClientResult {
  return {
    status: "blocked",
    client,
    code,
    details,
    ...(httpStatus === undefined ? {} : { http_status: httpStatus }),
  };
}

function toolDefinition() {
  return {
    type: "function" as const,
    name: EXPOSURE_GRAPH_TOOL_DEFINITION.name,
    description: EXPOSURE_GRAPH_TOOL_DEFINITION.description,
    parameters: EXPOSURE_GRAPH_TOOL_DEFINITION.inputSchema,
    strict: true,
  };
}

function initialInput(naturalLanguageRequest: string): Array<JsonRecord> {
  return [
    {
      role: "developer",
      content: [{ type: "input_text", text: ROUTER_INSTRUCTIONS }],
    },
    {
      role: "user",
      content: [{ type: "input_text", text: naturalLanguageRequest }],
    },
  ];
}

function functionCalls(response: OpenAIResponse): JsonRecord[] {
  if (!Array.isArray(response.output)) return [];
  return response.output.filter((item): item is JsonRecord =>
    isRecord(item) && item.type === "function_call",
  );
}

function responseText(response: OpenAIResponse): string | null {
  if (typeof response.output_text === "string") {
    return response.output_text.slice(0, MAX_MODEL_RESPONSE_CHARS);
  }
  if (!Array.isArray(response.output)) return null;
  const text = response.output
    .filter((item): item is JsonRecord => isRecord(item) && item.type === "message")
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((item): item is JsonRecord => isRecord(item) && item.type === "output_text")
    .map((item) => typeof item.text === "string" ? item.text : "")
    .join("\n")
    .trim();
  return text.length > 0 ? text.slice(0, MAX_MODEL_RESPONSE_CHARS) : null;
}

function sanitizeToolResult(
  request: ExposureRequest,
  statusCode: number,
  payload: unknown,
): SanitizedExposureToolResult {
  const envelope = isRecord(payload) ? payload : {};
  const result = isRecord(envelope.result) ? envelope.result : {};
  const policy = isRecord(result.policy) ? result.policy : {};
  const graph = isRecord(result.graph) ? result.graph : null;
  const source = graph && isRecord(graph.source) ? graph.source : null;
  const block = source && isRecord(source.block) ? source.block : null;
  const paths = graph && Array.isArray(graph.paths) ? graph.paths : [];

  return {
    status_code: statusCode,
    tool_name: EXPOSURE_GRAPH_TOOL_NAME,
    schema_version: EXPOSURE_GRAPH_TOOL_SCHEMA_VERSION,
    request,
    result: {
      status: stringOrNull(result.status),
      mode: stringOrNull(result.mode),
      policy: {
        verdict: stringOrNull(policy.verdict),
        requested_units: stringOrNull(policy.requested_units),
        allowed_units: stringOrNull(policy.allowed_units),
        gross_exposure_units: stringOrNull(policy.gross_exposure_units),
        headroom_units: stringOrNull(policy.headroom_units),
        binding_constraint: stringOrNull(policy.binding_constraint),
        reason_codes: stringArray(policy.reason_codes),
      },
      source: graph ? {
        source_status: stringOrNull(graph.source_status),
        block: block ? numberOrNull(block.number) : null,
        path_kinds: paths
          .filter((path): path is JsonRecord => isRecord(path))
          .map((path) => path.kind)
          .filter((kind): kind is string => typeof kind === "string"),
        gaps: stringArray(graph.gaps),
      } : null,
    },
    authority_boundary: {
      account: "server_configuration",
      chain: "server_configuration",
      policy: "server_configuration",
      provider: "server_configuration",
      signing: "outside_model_control",
      execution: "outside_model_control",
      read_only: true,
    },
  };
}

export function buildApplicationGeneratedSummary(
  toolResult: SanitizedExposureToolResult,
): string {
  const { result } = toolResult;
  const policy = result.policy;
  const source = result.source;
  const unit = toolResult.request.unit;
  const block = source?.block === null || source?.block === undefined
    ? "unknown"
    : String(source.block);
  const paths = source?.path_kinds.length
    ? source.path_kinds.join(", ")
    : "none reported";
  const gaps = source?.gaps.length
    ? source.gaps.join(", ")
    : "none reported";
  const reasons = policy.reason_codes.length
    ? policy.reason_codes.join(", ")
    : "none";

  return [
    "Application-generated summary (derived from validated tool output; not completed model prose).",
    `Source: ${source?.source_status ?? "unknown"}; mode: ${result.mode ?? "unknown"}; block: ${block}.`,
    `Policy: ${policy.verdict ?? "unknown"}; requested ${policy.requested_units ?? "unknown"} ${unit}; allowed ${policy.allowed_units ?? "unknown"} ${unit}.`,
    `Exposure: gross ${policy.gross_exposure_units ?? "unknown"} ${unit}; headroom ${policy.headroom_units ?? "unknown"} ${unit}; binding constraint ${policy.binding_constraint ?? "unknown"}; reason codes ${reasons}.`,
    `Paths: ${paths}.`,
    `Visible gaps: ${gaps}.`,
    "Authority: read-only; account, policy, provider, signing and execution remain outside model control.",
  ].join("\n");
}

async function callResponsesApi(
  body: JsonRecord,
  apiKey: string,
  endpoint: string,
  client: ExternalAIClientName,
  fetchImpl: OpenAIExposureFetch,
): Promise<{ ok: true; response: OpenAIResponse } | { ok: false; result: OpenAIExposureClientResult }> {
  let response: FetchResponse;
  let payload: unknown;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    payload = await response.json();
  } catch {
    return {
      ok: false,
      result: blocked(
        "external_request_failed",
        ["The external AI request did not complete."],
        undefined,
        client,
      ),
    };
  }
  if (!response.ok || !isRecord(payload)) {
    return {
      ok: false,
      result: blocked(
        "external_request_failed",
        ["The external AI request returned a non-success response."],
        response.status,
        client,
      ),
    };
  }
  return { ok: true, response: payload as OpenAIResponse };
}

export async function runOpenAIExposureClient(
  options: OpenAIExposureClientOptions,
): Promise<OpenAIExposureClientResult> {
  const naturalLanguageRequest = options.naturalLanguageRequest.trim();
  if (
    naturalLanguageRequest.length === 0
    || naturalLanguageRequest.length > MAX_NATURAL_LANGUAGE_REQUEST_CHARS
  ) {
    return blocked("invalid_natural_language_request", [
      `The natural-language request must be between 1 and ${MAX_NATURAL_LANGUAGE_REQUEST_CHARS} characters.`,
    ]);
  }

  const configuredProvider = options.provider ?? process.env.EXTERNAL_AI_PROVIDER?.trim() ?? "openai";
  if (configuredProvider !== "openai" && configuredProvider !== "openrouter") {
    return blocked("invalid_configuration", [
      "EXTERNAL_AI_PROVIDER must be either openai or openrouter.",
    ]);
  }
  const provider = configuredProvider as ExternalAIProvider;
  const client: ExternalAIClientName = provider === "openrouter"
    ? "openrouter_responses_api"
    : "openai_responses_api";
  const endpoint = provider === "openrouter"
    ? OPENROUTER_RESPONSES_ENDPOINT
    : OPENAI_RESPONSES_ENDPOINT;
  const apiKeyName = provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
  const modelName = provider === "openrouter" ? "OPENROUTER_MODEL" : "OPENAI_MODEL";
  const apiKey = options.apiKey ?? (
    provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY?.trim()
      : process.env.OPENAI_API_KEY?.trim()
  );
  const model = options.model ?? (
    provider === "openrouter"
      ? process.env.OPENROUTER_MODEL?.trim() ?? DEFAULT_OPENROUTER_MODEL
      : process.env.OPENAI_MODEL?.trim() ?? DEFAULT_OPENAI_MODEL
  );
  if (!apiKey || !model) {
    return blocked("missing_configuration", [
      ...(apiKey ? [] : [`${apiKeyName} is not configured.`]),
      ...(model ? [] : [`${modelName} is not configured.`]),
    ], undefined, client);
  }

  const fetchImpl = options.fetchImpl ?? (fetch as unknown as OpenAIExposureFetch);
  const toolRunner = options.toolRunner ?? runExposureGraphTool;
  const tools = [toolDefinition()];
  const first = await callResponsesApi({
    model,
    store: false,
    input: initialInput(naturalLanguageRequest),
    tools,
    tool_choice: { type: "function", name: EXPOSURE_GRAPH_TOOL_NAME },
    parallel_tool_calls: false,
    max_output_tokens: ROUTER_MAX_OUTPUT_TOKENS,
  }, apiKey, endpoint, client, fetchImpl);
  if (!first.ok) return first.result;

  const calls = functionCalls(first.response);
  if (calls.length === 0) {
    return blocked("model_did_not_call_tool", ["The model returned no function call."], undefined, client);
  }
  if (calls.length !== 1 || calls[0]!.name !== EXPOSURE_GRAPH_TOOL_NAME) {
    return blocked("unexpected_tool_call", ["The model selected an unsupported tool call."], undefined, client);
  }
  const call = calls[0]!;
  if (typeof call.arguments !== "string") {
    return blocked("invalid_tool_arguments", ["The model tool arguments were not a JSON string."], undefined, client);
  }

  let modelArguments: unknown;
  try {
    modelArguments = JSON.parse(call.arguments);
  } catch {
    return blocked("invalid_tool_arguments", ["The model tool arguments were not valid JSON."], undefined, client);
  }
  const validation = validateExposureGraphToolRequest(modelArguments);
  if (!validation.ok) {
    return blocked("invalid_tool_arguments", validation.error.details, undefined, client);
  }

  let toolExecution: { statusCode: number; payload: unknown };
  try {
    toolExecution = await toolRunner(validation.request);
  } catch {
    return blocked("tool_execution_failed", ["The restricted exposure tool could not complete."], undefined, client);
  }
  const toolResult = sanitizeToolResult(validation.request, toolExecution.statusCode, toolExecution.payload);
  const callId = typeof call.call_id === "string" ? call.call_id : null;
  if (!callId || !Array.isArray(first.response.output)) {
    return blocked("model_response_failed", ["The model tool call did not include a usable call id."], undefined, client);
  }

  const second = await callResponsesApi({
    model,
    store: false,
    input: [
      ...initialInput(naturalLanguageRequest),
      ...first.response.output.filter((item): item is JsonRecord => isRecord(item)),
      {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(toolResult),
      },
    ],
    tools,
    tool_choice: "none",
    parallel_tool_calls: false,
    max_output_tokens: EXPLANATION_MAX_OUTPUT_TOKENS,
  }, apiKey, endpoint, client, fetchImpl);
  if (!second.ok) return second.result;
  const modelResponse = responseText(second.response);
  if (!modelResponse) {
    return blocked("model_response_failed", ["The model returned no bounded explanation."], undefined, client);
  }

  return {
    status: "ok",
    client,
    model,
    natural_language_request: naturalLanguageRequest,
    model_tool_call: {
      name: EXPOSURE_GRAPH_TOOL_NAME,
      arguments: validation.request,
    },
    tool_result: toolResult,
    application_generated_summary: buildApplicationGeneratedSummary(toolResult),
    model_response: modelResponse,
  };
}
