import test from "node:test";
import assert from "node:assert/strict";

import type { BaseWstEthResult } from "../app/base-rpc.ts";
import type { GraphPositionEvidence, GraphPositionResult } from "../app/graph-client.ts";
import {
  createExposureRuntimeState,
  DEFAULT_EXPOSURE_POLICY,
  evaluateExposureRequest,
  getStoredExposureEvaluation,
  type ExposureEvaluationResponse,
} from "../app/exposure-service.ts";
import type {
  ExposureGraphV1,
  ExposurePolicyDecision,
  ExposureRequest,
} from "../../shared/schemas/exposure-graph.ts";

const ACCOUNT = "0x42bc857b5751126a71d203bde38ee8243b3ad1ed";
const REQUEST: ExposureRequest = {
  schema_version: "sentinel-exposure-buy.v1",
  action: "BUY_EXPOSURE",
  asset: "wstETH",
  unit: "wstETH",
  requested_units: "2.000000000000000000",
};
const NOW = new Date("2026-09-07T14:00:00.000Z");

const GRAPH_RESULT: GraphPositionEvidence = {
  status: "ok",
  mode: "live",
  subject: { account: ACCOUNT, chain_id: 8453 },
  source: {
    provider: "thegraph",
    subgraph_id: "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF",
    endpoint: "https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>",
    fetched_at: NOW.toISOString(),
    indexed_block: {
      number: 123,
      hash: "0x181bf855f6981c23116dc0b982f3bcd5698d792eaab82c080d81cb818e0e95b9",
      timestamp: 1_788_790_000,
    },
    has_indexing_errors: false,
    index_age_seconds: 1,
  },
  observations: [
    {
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
      a_token: {
        address: "0x99cbc45ea5bb7ef3a5bc08fb1b7e56bb2442ef0d",
        underlying_asset: "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452",
        decimals: 18,
      },
      pool_address: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5",
      supply_index_raw: "1000000000000000000000000000",
      debt_raw: "0",
      stable_debt_raw: "0",
      variable_debt_raw: "0",
      collateral_enabled: false,
      position_updated_at: 1_788_790_000,
    },
  ],
  valuation: { unit: "ETH", usd_available: false, note: "provider_exposes_price_in_eth_only" },
  pagination: { page_size: 100, pages: 1, complete: true },
  gaps: ["usd_valuation_unavailable", "stale_oracle_price"],
};

const RPC_RESULT: BaseWstEthResult = {
  status: "ok",
  snapshot: {
    block: {
      number: 123,
      hash: "0x181bf855f6981c23116dc0b982f3bcd5698d792eaab82c080d81cb818e0e95b9",
      timestamp: 1_788_790_000,
    },
    rpc_endpoint: "https://mainnet.base.org",
    contracts: {
      underlying: "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452",
      a_token: "0x99cbc45ea5bb7ef3a5bc08fb1b7e56bb2442ef0d",
      pool: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5",
      a_token_underlying_matches: true,
      decimals_match: true,
    },
    direct_balance_raw: "20000000000000000",
    aave_scaled_supply_raw: "30000000000000000",
    normalized_income_raw: "1000000000000000000000000000",
    normalized_aave_supply_raw: "30000000000000000",
    aave_balance_raw: "30000000000000000",
    gaps: [],
  },
};

const BUILT_GRAPH = {
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
  graph_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
} as ExposureGraphV1;

const ALLOW_WITH_DOWNSIZE: ExposurePolicyDecision = {
  verdict: "ALLOW_WITH_DOWNSIZE",
  requested_units: REQUEST.requested_units,
  allowed_units: "0.950000000000000000",
  dependency_cap_units: DEFAULT_EXPOSURE_POLICY.dependency_cap_units,
  gross_exposure_units: "0.050000000000000000",
  headroom_units: "0.950000000000000000",
  binding_constraint: "dependency_cap",
  policy_version: DEFAULT_EXPOSURE_POLICY.policy_version,
  unit: "wstETH",
  reason_codes: ["dependency_cap_applied"],
  debt_units: "0.000000000000000000",
};

function dependencies(calls: string[], now = NOW) {
  return {
    graphOptions: {
      apiKey: "secret-test-key",
      subgraphId: GRAPH_RESULT.source.subgraph_id,
      chainId: "8453",
      account: ACCOUNT,
    },
    now,
    runtimeState: createExposureRuntimeState(),
    graphQuery: async (options: { account?: string }) => {
      calls.push("graph");
      assert.equal(options.account, ACCOUNT);
      return GRAPH_RESULT;
    },
    rpcReader: async (options: { account: string; graphBlock: { number: number } }) => {
      calls.push("rpc");
      assert.equal(options.account, ACCOUNT);
      assert.equal(options.graphBlock.number, 123);
      return RPC_RESULT;
    },
    graphBuilder: (input: { graph: GraphPositionEvidence; rpc: unknown }) => {
      calls.push("builder");
      assert.equal(input.graph, GRAPH_RESULT);
      assert.equal(input.rpc, (RPC_RESULT as { snapshot: unknown }).snapshot);
      return { status: "ok" as const, graph: BUILT_GRAPH };
    },
    policyEvaluator: (_graph: ExposureGraphV1, config: typeof DEFAULT_EXPOSURE_POLICY) => {
      calls.push("policy");
      assert.deepEqual(config, DEFAULT_EXPOSURE_POLICY);
      return ALLOW_WITH_DOWNSIZE;
    },
  };
}

test("evaluateExposureRequest composes Graph, RPC, graph builder and policy in order", async () => {
  const calls: string[] = [];
  const deps = dependencies(calls);
  const result = await evaluateExposureRequest(
    { ...REQUEST, evidence_hash: "attacker-supplied" } as ExposureRequest,
    deps,
  );

  assert.deepEqual(calls, ["graph", "rpc", "builder", "policy"]);
  assert.equal(result.status, "ok");
  assert.equal(result.policy.verdict, "ALLOW_WITH_DOWNSIZE");
  assert.equal(result.evaluation_ref?.startsWith("exposure_"), true);
  assert.equal(deps.runtimeState.evaluations.size, 1);
  assert.equal(JSON.stringify(result).includes("secret-test-key"), false);
  assert.equal(JSON.stringify(result).includes("attacker-supplied"), false);
});

test("evaluateExposureRequest uses the server-owned default cap and opaque references", async () => {
  const firstCalls: string[] = [];
  const first = await evaluateExposureRequest(REQUEST, dependencies(firstCalls));
  const secondCalls: string[] = [];
  const second = await evaluateExposureRequest(REQUEST, dependencies(secondCalls));

  assert.equal(DEFAULT_EXPOSURE_POLICY.dependency_cap_units, "1.000000000000000000");
  assert.notEqual(first.evaluation_ref, second.evaluation_ref);
});

test("evaluateExposureRequest returns DENY without an evaluation when Graph or RPC fails", async () => {
  let rpcCalled = false;
  const graphBlocked = await evaluateExposureRequest(REQUEST, {
    ...dependencies([]),
    graphQuery: async () => ({ status: "blocked", reason: "missing_configuration", missing: ["GRAPH_API_KEY"] }),
    rpcReader: async () => {
      rpcCalled = true;
      return RPC_RESULT;
    },
  });
  assert.equal(graphBlocked.policy.verdict, "DENY");
  assert.equal(graphBlocked.evaluation_ref, null);
  assert.equal(rpcCalled, false);

  const rpcFailed = await evaluateExposureRequest(REQUEST, {
    ...dependencies([]),
    rpcReader: async () => ({ status: "error", reason: "block_mismatch" }),
  });
  assert.equal(rpcFailed.policy.verdict, "DENY");
  assert.equal(rpcFailed.evaluation_ref, null);
});

test("evaluateExposureRequest preserves the sanitized RPC rate-limit category", async () => {
  const result = await evaluateExposureRequest(REQUEST, {
    ...dependencies([]),
    rpcReader: async () => ({ status: "error", reason: "rpc_rate_limited" }),
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.policy.reason_codes, ["rpc_rate_limited"]);
  assert.equal(result.evaluation_ref, null);
});

test("stored exposure evaluations expire and are removed", async () => {
  const state = createExposureRuntimeState();
  const result = await evaluateExposureRequest(REQUEST, {
    ...dependencies([], NOW),
    runtimeState: state,
    ttlMs: 1_000,
  });
  assert.ok(result.evaluation_ref);
  assert.ok(getStoredExposureEvaluation(state, result.evaluation_ref!, NOW));
  assert.equal(getStoredExposureEvaluation(state, result.evaluation_ref!, new Date(NOW.getTime() + 1_001)), null);
  assert.equal(state.evaluations.size, 0);
});

test("fixture mode is explicit and does not become live evidence", async () => {
  const result = await evaluateExposureRequest(REQUEST, {
    ...dependencies([]),
    mode: "fixture",
  });
  assert.equal(result.mode, "fixture");
  assert.equal(result.graph?.mode, "fixture");
});
