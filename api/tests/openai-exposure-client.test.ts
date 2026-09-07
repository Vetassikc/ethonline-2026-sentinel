import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPOSURE_GRAPH_TOOL_DEFINITION,
  runExposureGraphTool,
} from "../app/exposure-tool.ts";
import {
  OPENAI_RESPONSES_ENDPOINT,
  runOpenAIExposureClient,
} from "../app/openai-exposure-client.ts";
import type { ExposureRequest } from "../../shared/schemas/exposure-graph.ts";

const REQUEST: ExposureRequest = {
  schema_version: "sentinel-exposure-buy.v1",
  action: "BUY_EXPOSURE",
  asset: "wstETH",
  unit: "wstETH",
  requested_units: "0.500000000000000000",
};

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function toolPayload() {
  return {
    tool_name: "sentinel_exposure_graph",
    schema_version: "exposure-graph-tool.v1",
    request: REQUEST,
    query_plan: {
      rpc_host: "https://rpc.example.test",
      account_source: "server_configuration",
      policy_source: "server_configuration",
    },
    result: {
      status: "ok",
      mode: "live",
      graph: {
        source_status: "ok",
        source: {
          graph_endpoint: "https://gateway.example.test/secret",
          rpc_endpoint: "https://rpc.example.test/secret",
          block: { number: 123, hash: `0x${"ab".repeat(32)}` },
        },
        subject: { account: "0x42bc857b5751126a71d203bde38ee8243b3ad1ed" },
        paths: [{ kind: "direct_holding" }, { kind: "aave_supply" }],
        gaps: ["usd_valuation_unavailable"],
      },
      policy: {
        verdict: "ALLOW",
        requested_units: REQUEST.requested_units,
        allowed_units: REQUEST.requested_units,
        gross_exposure_units: "0.000012505725902551",
        headroom_units: "0.999987494274097449",
        binding_constraint: "none",
        reason_codes: [],
      },
    },
  };
}

test("OpenAI Responses client performs a model-selected restricted tool round trip", async () => {
  const requests: Array<{ body: Record<string, unknown>; headers: HeadersInit }> = [];
  let toolInput: unknown;
  const fetchImpl = async (_input: string, init?: RequestInit) => {
    requests.push({
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: init?.headers ?? {},
    });
    if (requests.length === 1) {
      return response({
        output: [{
          type: "function_call",
          name: "sentinel_exposure_graph",
          call_id: "call_1",
          arguments: JSON.stringify(REQUEST),
        }],
      });
    }
    return response({ output_text: "The source-backed policy allows the bounded request." });
  };

  const result = await runOpenAIExposureClient({
    naturalLanguageRequest: "Check whether a bounded 0.5 wstETH exposure purchase is allowed.",
    apiKey: "test-api-key",
    model: "test-model",
    fetchImpl,
    toolRunner: async (input) => {
      toolInput = input;
      return { statusCode: 200, payload: toolPayload() };
    },
  });

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.model_tool_call.arguments, REQUEST);
  assert.deepEqual(toolInput, REQUEST);
  assert.equal(result.tool_result.result.source?.block, 123);
  assert.deepEqual(result.tool_result.result.source?.path_kinds, ["direct_holding", "aave_supply"]);
  assert.equal(result.model_response, "The source-backed policy allows the bounded request.");
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.body.store, false);
  assert.deepEqual(requests[0]!.body.tool_choice, { type: "function", name: "sentinel_exposure_graph" });
  assert.equal(requests[0]!.body.tools?.[0]?.name, "sentinel_exposure_graph");
  assert.deepEqual(requests[0]!.body.tools?.[0]?.parameters, EXPOSURE_GRAPH_TOOL_DEFINITION.inputSchema);
  const secondBody = JSON.stringify(requests[1]!.body);
  assert.equal(secondBody.includes("42bc857b5751126a71d203bde38ee8243b3ad1ed"), false);
  assert.equal(secondBody.includes("gateway.example.test"), false);
  assert.equal(secondBody.includes("rpc.example.test"), false);
  assert.equal(secondBody.includes("function_call_output"), true);
  assert.equal(requests[1]!.body.tool_choice, "none");
  assert.equal(OPENAI_RESPONSES_ENDPOINT, "https://api.openai.com/v1/responses");
});

test("OpenAI Responses client fails closed on model arguments outside the local contract", async () => {
  let calls = 0;
  let toolRan = false;
  const result = await runOpenAIExposureClient({
    naturalLanguageRequest: "Check a purchase.",
    apiKey: "test-api-key",
    model: "test-model",
    fetchImpl: async () => {
      calls += 1;
      return response({
        output: [{
          type: "function_call",
          name: "sentinel_exposure_graph",
          call_id: "call_oversized",
          arguments: JSON.stringify({ ...REQUEST, requested_units: "10.000000000000000001" }),
        }],
      });
    },
    toolRunner: async () => {
      toolRan = true;
      return { statusCode: 200, payload: toolPayload() };
    },
  });

  assert.equal(result.status, "blocked");
  if (result.status !== "blocked") return;
  assert.equal(result.code, "invalid_tool_arguments");
  assert.equal(result.details.some((detail) => detail.includes("bounded request maximum")), true);
  assert.equal(calls, 1);
  assert.equal(toolRan, false);
});

test("OpenAI Responses client sanitizes external failures and missing configuration", async () => {
  const failed = await runOpenAIExposureClient({
    naturalLanguageRequest: "Check a purchase.",
    apiKey: "test-api-key",
    model: "test-model",
    fetchImpl: async () => response({ error: { message: "secret provider detail" } }, 429),
  });
  assert.equal(failed.status, "blocked");
  if (failed.status !== "blocked") return;
  assert.equal(failed.code, "external_request_failed");
  assert.equal(failed.http_status, 429);
  assert.equal(JSON.stringify(failed).includes("secret provider detail"), false);

  const missing = await runOpenAIExposureClient({
    naturalLanguageRequest: "Check a purchase.",
    apiKey: "",
    model: "test-model",
    fetchImpl: async () => response({}),
  });
  assert.equal(missing.status, "blocked");
  if (missing.status !== "blocked") return;
  assert.equal(missing.code, "missing_configuration");
  assert.equal(missing.details.includes("OPENAI_API_KEY is not configured."), true);
});

test("OpenAI Responses client remains compatible with the existing restricted runner", async () => {
  const result = await runExposureGraphTool(REQUEST, {
    mode: "fixture",
    graphQuery: async () => ({ status: "blocked", reason: "missing_configuration", missing: ["fixture"] }),
  });
  assert.equal(result.statusCode, 503);
  assert.equal(JSON.stringify(result.payload).includes("fixture"), true);
});
