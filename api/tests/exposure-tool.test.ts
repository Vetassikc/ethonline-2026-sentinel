import test from "node:test";
import assert from "node:assert/strict";

import type { GraphPositionEvidence } from "../app/graph-client.ts";
import {
  EXPOSURE_GRAPH_TOOL_DEFINITION,
  runExposureGraphTool,
  validateExposureGraphToolRequest,
} from "../app/exposure-tool.ts";
import { createExposureRuntimeState } from "../app/exposure-service.ts";
import type { ExposureGraphV1, ExposureRequest } from "../../shared/schemas/exposure-graph.ts";

const ACCOUNT = "0x42bc857b5751126a71d203bde38ee8243b3ad1ed";
const REQUEST: ExposureRequest = {
  schema_version: "sentinel-exposure-buy.v1",
  action: "BUY_EXPOSURE",
  asset: "wstETH",
  unit: "wstETH",
  requested_units: "2.000000000000000000",
};

const GRAPH_RESULT = {
  status: "ok" as const,
  mode: "live" as const,
  subject: { account: ACCOUNT, chain_id: 8453 },
  source: {
    provider: "thegraph" as const,
    subgraph_id: "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF",
    endpoint: "https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>",
    fetched_at: "2026-09-07T14:00:00.000Z",
    indexed_block: { number: 123, hash: "0x181bf855f6981c23116dc0b982f3bcd5698d792eaab82c080d81cb818e0e95b9", timestamp: 1_788_790_000 },
    has_indexing_errors: false,
    index_age_seconds: 1,
  },
  observations: [{
    id: "candidate",
    account: ACCOUNT,
    asset: {
      address: "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452",
      symbol: "wstETH",
      name: "Wrapped liquid staked Ether 2.0",
      decimals: 18,
      price_in_eth_raw: null,
      price_source: null,
      price_updated_at: null,
      price_age_seconds: null,
    },
    supplied_raw: "30000000000000000",
    scaled_supplied_raw: "30000000000000000",
    a_token: { address: "0x99cbc45ea5bb7ef3a5bc08fb1b7e56bb2442ef0d", underlying_asset: "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452", decimals: 18 },
    pool_address: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5",
    supply_index_raw: "1000000000000000000000000000",
    debt_raw: "0",
    stable_debt_raw: "0",
    variable_debt_raw: "0",
    collateral_enabled: false,
    position_updated_at: 1_788_790_000,
  }],
  valuation: { unit: "ETH" as const, usd_available: false as const, note: "provider_exposes_price_in_eth_only" as const },
  pagination: { page_size: 100, pages: 1, complete: true },
  gaps: ["usd_valuation_unavailable", "stale_oracle_price"],
} satisfies GraphPositionEvidence;

const GRAPH: ExposureGraphV1 = {
  schema_version: "exposure_graph.v1",
  mode: "live",
  source_status: "ok",
  subject: { account: ACCOUNT, chain_id: 8453 },
  source: {
    graph_subgraph_id: GRAPH_RESULT.source.subgraph_id,
    graph_endpoint: GRAPH_RESULT.source.endpoint,
    rpc_endpoint: "https://mainnet.base.org",
    block: GRAPH_RESULT.source.indexed_block,
  },
  nodes: [],
  edges: [],
  paths: [],
  debt: [],
  gaps: GRAPH_RESULT.gaps,
  graph_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

function dependencies() {
  return {
    runtimeState: createExposureRuntimeState(),
    now: new Date("2026-09-07T14:00:00.000Z"),
    graphOptions: { account: ACCOUNT, chainId: "8453", subgraphId: "public", apiKey: "secret-test-key" },
    graphQuery: async () => GRAPH_RESULT,
    rpcReader: async () => ({
      status: "ok" as const,
      snapshot: {
        block: GRAPH_RESULT.source.indexed_block,
        contracts: { underlying: "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452", a_token: "0x99cbc45ea5bb7ef3a5bc08fb1b7e56bb2442ef0d", pool: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5", a_token_underlying_matches: true, decimals_match: true },
        direct_balance_raw: "20000000000000000",
        aave_scaled_supply_raw: "30000000000000000",
        normalized_income_raw: "1000000000000000000000000000",
        normalized_aave_supply_raw: "30000000000000000",
        aave_balance_raw: "30000000000000000",
        gaps: [],
      },
    }),
    graphBuilder: () => ({ status: "ok" as const, graph: GRAPH }),
    policyEvaluator: () => ({
      verdict: "ALLOW_WITH_DOWNSIZE" as const,
      requested_units: REQUEST.requested_units,
      allowed_units: "0.950000000000000000",
      dependency_cap_units: "1.000000000000000000",
      gross_exposure_units: "0.050000000000000000",
      headroom_units: "0.950000000000000000",
      binding_constraint: "dependency_cap" as const,
      policy_version: "exposure-wsteth-v1",
      unit: "wstETH" as const,
      reason_codes: ["dependency_cap_applied"],
      debt_units: "0.000000000000000000",
    }),
  };
}

test("exposure graph tool is read-only and accepts the exact purchase request", async () => {
  assert.equal(EXPOSURE_GRAPH_TOOL_DEFINITION.name, "sentinel_exposure_graph");
  assert.equal(EXPOSURE_GRAPH_TOOL_DEFINITION.readOnly, true);
  assert.equal(EXPOSURE_GRAPH_TOOL_DEFINITION.inputSchema.additionalProperties, false);
  assert.deepEqual(EXPOSURE_GRAPH_TOOL_DEFINITION.inputSchema.required, [
    "schema_version",
    "action",
    "asset",
    "unit",
    "requested_units",
  ]);

  const result = await runExposureGraphTool(REQUEST, dependencies());
  assert.equal(result.statusCode, 200);
  const payload = result.payload as {
    tool_name: string;
    request: ExposureRequest;
    query_plan: { read_only: boolean; account_source: string; provider: string };
    result: { graph: unknown; policy: { verdict: string }; evaluation_ref: string | null };
  };
  assert.equal(payload.tool_name, "sentinel_exposure_graph");
  assert.deepEqual(payload.request, REQUEST);
  assert.equal(payload.query_plan.read_only, true);
  assert.equal(payload.query_plan.account_source, "server_configuration");
  assert.equal(payload.query_plan.provider, "thegraph+base-rpc");
  assert.equal(payload.result.policy.verdict, "ALLOW_WITH_DOWNSIZE");
  assert.equal(payload.result.evaluation_ref?.startsWith("exposure_"), true);
  assert.equal(JSON.stringify(payload).includes("secret-test-key"), false);
});

test("exposure graph tool rejects scenarios, custom subjects, URLs, policy overrides and bad scale", async () => {
  for (const input of [
    { ...REQUEST, scenario: "allow-btc-buy" },
    { ...REQUEST, account: ACCOUNT },
    { ...REQUEST, rpc_url: "https://evil.example" },
    { ...REQUEST, policy: { dependency_cap_units: "999" } },
    { ...REQUEST, requested_units: "2.0000000000000000001" },
  ]) {
    assert.equal(validateExposureGraphToolRequest(input).ok, false);
    const result = await runExposureGraphTool(input, dependencies());
    assert.equal(result.statusCode, 400);
  }
});

test("blocked source stays non-authorizing and the existing scenario tool remains separate", async () => {
  const blocked = await runExposureGraphTool(REQUEST, {
    ...dependencies(),
    graphQuery: async () => ({ status: "blocked" as const, reason: "missing_configuration" as const, missing: ["GRAPH_API_KEY"] }),
  });
  assert.equal(blocked.statusCode, 503);
  assert.equal((blocked.payload as { result: { policy: { verdict: string } } }).result.policy.verdict, "DENY");
});
