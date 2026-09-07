import test from "node:test";
import assert from "node:assert/strict";

import {
  handleJudgeModeRequest,
} from "../app/server.ts";
import {
  loadScenarioIntent,
} from "../app/scenarios.ts";

const ACCOUNT = "0x00068c8cb77e6eed45d274f5c51a0461a8cfdbbd";
const SUBGRAPH_ID = "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF";
const NOW = new Date("2026-09-07T10:00:00.000Z");
const META = {
  block: {
    number: 30_000_000,
    hash: "0xblockhash",
    timestamp: Math.floor(NOW.getTime() / 1000) - 20,
  },
  hasIndexingErrors: false,
};

function graphResponse() {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        data: {
          _meta: META,
          userReserves: [
            {
              id: `${ACCOUNT}0xreserve1xpool1`,
              user: { id: ACCOUNT },
              reserve: {
                id: "0xreserve1",
                underlyingAsset: "0x0000000000000000000000000000000000000001",
                symbol: "USDC",
                name: "USD Coin",
                decimals: 6,
                price: {
                  priceInEth: "1000000000000000",
                  priceSource: "0xoracle1",
                  lastUpdateTimestamp: META.block.timestamp,
                },
              },
              usageAsCollateralEnabledOnUser: true,
              currentATokenBalance: "1000000",
              currentTotalDebt: "0",
              currentStableDebt: "0",
              currentVariableDebt: "0",
              lastUpdateTimestamp: META.block.timestamp,
            },
          ],
        },
      };
    },
  };
}

test("GET /position-evidence serves the evidence demo shell", async () => {
  const result = await handleJudgeModeRequest("GET", "/position-evidence", "");

  assert.equal(result.statusCode, 200);
  assert.equal(result.contentType, "text/html; charset=utf-8");
  assert.match(String(result.payload), /Position Evidence/);
});

test("POST /api/position-evidence/evaluate rejects an invalid trade intent", async () => {
  const result = await handleJudgeModeRequest(
    "POST",
    "/api/position-evidence/evaluate",
    JSON.stringify({ trace_id: "" }),
  );

  assert.equal(result.statusCode, 400);
  assert.equal((result.payload as { error: string }).error, "invalid_trade_intent");
});

test("POST /api/position-evidence/evaluate returns live evidence and a fail-closed policy result", async () => {
  const intent = await loadScenarioIntent("allow-btc-buy");
  const result = await handleJudgeModeRequest(
    "POST",
    "/api/position-evidence/evaluate",
    JSON.stringify(intent),
    {
      graphOptions: {
        apiKey: "secret-test-key",
        subgraphId: SUBGRAPH_ID,
        chainId: "8453",
        account: ACCOUNT,
      },
      fetchImpl: async () => graphResponse(),
      now: NOW,
    },
  );

  assert.equal(result.statusCode, 200);
  const payload = result.payload as {
    intent: { intent_id: string };
    evidence: {
      schema_version: string;
      source: { indexed_block: { number: number } };
      quality: { decision: string; reason_codes: string[] };
      evidence_hash: string;
    };
    policy: { verdict: string; reason_code: string };
  };
  assert.equal(payload.intent.intent_id, intent.intent_id);
  assert.equal(payload.evidence.schema_version, "position_evidence.v1");
  assert.equal(payload.evidence.source.indexed_block.number, META.block.number);
  assert.equal(payload.evidence.quality.decision, "DENY");
  assert.deepEqual(payload.evidence.quality.reason_codes, ["usd_valuation_unavailable"]);
  assert.equal(payload.policy.verdict, "DENY");
  assert.equal(payload.policy.reason_code, "POSITION_EVIDENCE_BLOCKED");
  assert.match(payload.evidence.evidence_hash, /^0x[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(result.payload).includes("secret-test-key"), false);
});

test("POST /api/position-evidence/evaluate returns a non-authorizing 503 when Graph configuration is blocked", async () => {
  let providerCalled = false;
  const intent = await loadScenarioIntent("allow-btc-buy");
  const result = await handleJudgeModeRequest(
    "POST",
    "/api/position-evidence/evaluate",
    JSON.stringify(intent),
    {
      graphOptions: {},
      fetchImpl: async () => {
        providerCalled = true;
        return graphResponse();
      },
      now: NOW,
    },
  );

  assert.equal(result.statusCode, 503);
  assert.equal(providerCalled, false);
  assert.deepEqual(result.payload, {
    status: "blocked",
    reason: "missing_configuration",
    missing: [
      "GRAPH_API_KEY",
      "GRAPH_SUBGRAPH_ID",
      "GRAPH_DEMO_ACCOUNT",
      "GRAPH_CHAIN_ID",
    ],
  });
});

test("POST /api/position-evidence/evaluate returns a non-authorizing 503 for provider errors", async () => {
  const intent = await loadScenarioIntent("allow-btc-buy");
  const result = await handleJudgeModeRequest(
    "POST",
    "/api/position-evidence/evaluate",
    JSON.stringify(intent),
    {
      graphOptions: {
        apiKey: "secret-test-key",
        subgraphId: SUBGRAPH_ID,
        chainId: "8453",
        account: ACCOUNT,
      },
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        async json() {
          return {};
        },
      }),
      now: NOW,
    },
  );

  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.payload, {
    status: "error",
    reason: "http_error",
    http_status: 503,
  });
});
