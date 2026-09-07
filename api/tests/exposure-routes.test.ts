import test from "node:test";
import assert from "node:assert/strict";

import { createExposureRuntimeState } from "../app/exposure-service.ts";
import type { GraphPositionEvidence } from "../app/graph-client.ts";
import type {
  ExposureGraphV1,
  ExposurePolicyDecision,
  ExposureRequest,
} from "../../shared/schemas/exposure-graph.ts";
import { handleJudgeModeRequest } from "../app/server.ts";

const ACCOUNT = "0x42bc857b5751126a71d203bde38ee8243b3ad1ed";
const BLOCK_HASH = "0x181bf855f6981c23116dc0b982f3bcd5698d792eaab82c080d81cb818e0e95b9";
const REQUEST: ExposureRequest = {
  schema_version: "sentinel-exposure-buy.v1",
  action: "BUY_EXPOSURE",
  asset: "wstETH",
  unit: "wstETH",
  requested_units: "2.000000000000000000",
};
const AUTHORIZED_REQUEST: ExposureRequest = {
  ...REQUEST,
  requested_units: "0.950000000000000000",
};
const GRAPH_RESULT: GraphPositionEvidence = {
  status: "ok",
  mode: "live",
  subject: { account: ACCOUNT, chain_id: 8453 },
  source: {
    provider: "thegraph",
    subgraph_id: "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF",
    endpoint: "https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>",
    fetched_at: "2026-09-07T14:00:00.000Z",
    indexed_block: { number: 123, hash: BLOCK_HASH, timestamp: 1_788_790_000 },
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
  }],
  valuation: { unit: "ETH", usd_available: false, note: "provider_exposes_price_in_eth_only" },
  pagination: { page_size: 100, pages: 1, complete: true },
  gaps: ["usd_valuation_unavailable", "stale_oracle_price"],
};

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

const POLICY: ExposurePolicyDecision = {
  verdict: "ALLOW_WITH_DOWNSIZE",
  requested_units: REQUEST.requested_units,
  allowed_units: "0.950000000000000000",
  dependency_cap_units: "1.000000000000000000",
  gross_exposure_units: "0.050000000000000000",
  headroom_units: "0.950000000000000000",
  binding_constraint: "dependency_cap",
  policy_version: "exposure-wsteth-v1",
  unit: "wstETH",
  reason_codes: ["dependency_cap_applied"],
  debt_units: "0.000000000000000000",
};

function syntheticDependencies(overrides: Record<string, unknown> = {}) {
  let graphCalls = 0;
  const state = createExposureRuntimeState();
  const dependencies = {
    graphOptions: {
      apiKey: "secret-test-key",
      subgraphId: GRAPH_RESULT.source.subgraph_id,
      chainId: "8453",
      account: ACCOUNT,
    },
    runtimeState: state,
    now: new Date("2026-09-07T14:00:00.000Z"),
    graphQuery: async () => {
      graphCalls += 1;
      return GRAPH_RESULT;
    },
    rpcReader: async () => ({
      status: "ok" as const,
      snapshot: {
        block: GRAPH_RESULT.source.indexed_block,
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
    }),
    graphBuilder: () => ({ status: "ok" as const, graph: GRAPH }),
    policyEvaluator: () => POLICY,
    getGraphCalls: () => graphCalls,
    ...overrides,
  };
  return dependencies;
}

test("POST /api/exposure/evaluate accepts a request and returns a live graph decision", async () => {
  const dependencies = syntheticDependencies();
  const response = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/evaluate",
    JSON.stringify(REQUEST),
    { exposureDependencies: dependencies },
  );

  assert.equal(response.statusCode, 200);
  assert.equal((response.payload as { policy: { verdict: string } }).policy.verdict, "ALLOW_WITH_DOWNSIZE");
  assert.equal((response.payload as { graph: { mode: string } }).graph.mode, "live");
  assert.equal(JSON.stringify(response.payload).includes("secret-test-key"), false);
});

test("exposure routes reject arbitrary request fields and oversized bodies", async () => {
  const unknown = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/evaluate",
    JSON.stringify({ ...REQUEST, account: ACCOUNT }),
    { exposureDependencies: syntheticDependencies() },
  );
  assert.equal(unknown.statusCode, 400);
  assert.equal((unknown.payload as { error: string }).error, "invalid_exposure_request");

  const oversized = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/evaluate",
    "x".repeat(64 * 1024 + 1),
    { exposureDependencies: syntheticDependencies() },
  );
  assert.equal(oversized.statusCode, 413);
  assert.deepEqual(oversized.payload, { error: "request_body_too_large" });
});

test("GET /api/exposure/config is server-owned and blocked configuration is non-authorizing", async () => {
  const config = await handleJudgeModeRequest("GET", "/api/exposure/config", "");
  assert.equal(config.statusCode, 200);
  assert.equal((config.payload as { policy: { dependency_cap_units: string } }).policy.dependency_cap_units, "1.000000000000000000");
  assert.equal(JSON.stringify(config.payload).includes("GRAPH_API_KEY"), false);

  const blocked = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/evaluate",
    JSON.stringify(REQUEST),
    { exposureDependencies: { graphOptions: {} } },
  );
  assert.equal(blocked.statusCode, 503);
  assert.equal((blocked.payload as { policy: { verdict: string } }).policy.verdict, "DENY");
});

test("permit, pure verify and one-time paper execution route flow", async () => {
  const dependencies = syntheticDependencies();
  const evaluated = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/evaluate",
    JSON.stringify(REQUEST),
    { exposureDependencies: dependencies },
  );
  const reference = (evaluated.payload as { evaluation_ref: string }).evaluation_ref;

  const issued = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/permit",
    JSON.stringify({ evaluation_ref: reference, nonce: "7" }),
    { exposureDependencies: dependencies },
  );
  assert.equal(issued.statusCode, 200);
  const permit = (issued.payload as { permit: unknown }).permit;

  const verified = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/verify",
    JSON.stringify({ request: AUTHORIZED_REQUEST, permit }),
    { exposureDependencies: dependencies },
  );
  assert.equal(verified.statusCode, 200);
  assert.equal((verified.payload as { executable: boolean }).executable, true);
  assert.equal(dependencies.runtimeState.consumed_nonces.size, 0);

  const executed = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/paper-execute",
    JSON.stringify({ request: AUTHORIZED_REQUEST, permit }),
    { exposureDependencies: dependencies },
  );
  assert.equal(executed.statusCode, 200);
  assert.equal((executed.payload as { executable: boolean }).executable, true);
  assert.equal(dependencies.runtimeState.consumed_nonces.has("7"), true);

  const replayed = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/paper-execute",
    JSON.stringify({ request: AUTHORIZED_REQUEST, permit }),
    { exposureDependencies: dependencies },
  );
  assert.equal(replayed.statusCode, 409);
  assert.equal((replayed.payload as { code: string }).code, "NONCE_ALREADY_USED");
});

test("permit route rejects unknown references and replay never calls the live provider", async () => {
  const dependencies = syntheticDependencies();
  const unknown = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/permit",
    JSON.stringify({ evaluation_ref: "exposure_unknown", nonce: "7" }),
    { exposureDependencies: dependencies },
  );
  assert.equal(unknown.statusCode, 400);

  const evaluated = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/evaluate",
    JSON.stringify(REQUEST),
    { exposureDependencies: dependencies },
  );
  const reference = (evaluated.payload as { evaluation_ref: string }).evaluation_ref;
  const before = dependencies.getGraphCalls();
  const replay = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/replay",
    JSON.stringify({ evaluation_ref: reference }),
    { exposureDependencies: dependencies },
  );
  assert.equal(replay.statusCode, 200);
  assert.equal((replay.payload as { mode: string }).mode, "replay");
  assert.equal((replay.payload as { policy: { verdict: string } }).policy.verdict, "DENY");
  assert.equal(dependencies.getGraphCalls(), before);
});

test("old judge route stays available while exposure route is separate", async () => {
  const response = await handleJudgeModeRequest("GET", "/judge", "");
  assert.equal(response.statusCode, 200);
  assert.match(String(response.payload), /Sentinel/);
});
