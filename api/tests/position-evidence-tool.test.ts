import test from "node:test";
import assert from "node:assert/strict";

import {
  POSITION_EVIDENCE_TOOL_DEFINITION,
  runPositionEvidenceTool,
  validatePositionEvidenceToolRequest,
} from "../app/position-evidence-tool.ts";

const ACCOUNT = "0x00068c8cb77e6eed45d274f5c51a0461a8cfdbbd";
const SUBGRAPH_ID = "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF";
const NOW = new Date("2026-09-07T10:00:00.000Z");

function graphResponse() {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        data: {
          _meta: {
            block: {
              number: 30_000_000,
              hash: "0xblockhash",
              timestamp: Math.floor(NOW.getTime() / 1000) - 20,
            },
            hasIndexingErrors: false,
          },
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
                  lastUpdateTimestamp: Math.floor(NOW.getTime() / 1000) - 20,
                },
              },
              usageAsCollateralEnabledOnUser: true,
              currentATokenBalance: "1000000",
              currentTotalDebt: "0",
              currentStableDebt: "0",
              currentVariableDebt: "0",
              lastUpdateTimestamp: Math.floor(NOW.getTime() / 1000) - 20,
            },
          ],
        },
      };
    },
  };
}

test("position evidence tool definition is read-only and scenario constrained", () => {
  assert.equal(POSITION_EVIDENCE_TOOL_DEFINITION.name, "sentinel_position_evidence");
  assert.equal(POSITION_EVIDENCE_TOOL_DEFINITION.inputSchema.additionalProperties, false);
  assert.deepEqual(
    POSITION_EVIDENCE_TOOL_DEFINITION.inputSchema.properties.scenario.enum,
    ["allow-btc-buy", "deny-oversize-eth", "downsize-eth-buy", "fail-closed-oracle"],
  );
  assert.equal(POSITION_EVIDENCE_TOOL_DEFINITION.readOnly, true);
  assert.equal(POSITION_EVIDENCE_TOOL_DEFINITION.capabilities.includes("trade_execution"), false);
});

test("position evidence tool rejects arbitrary subjects and unknown fields", () => {
  assert.deepEqual(
    validatePositionEvidenceToolRequest({
      scenario: "allow-btc-buy",
      account: ACCOUNT,
    }),
    {
      ok: false,
      error: {
        error: "invalid_tool_request",
        details: ["Only the scenario field is accepted."],
      },
    },
  );
  assert.equal(validatePositionEvidenceToolRequest({ scenario: "custom" }).ok, false);
});

test("position evidence tool wraps the validated intent and live evidence result", async () => {
  const result = await runPositionEvidenceTool(
    { scenario: "allow-btc-buy" },
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
    tool_name: string;
    schema_version: string;
    request: { scenario: string };
    query_plan: { read_only: boolean; template_id: string; account_source: string };
    result: {
      status: string;
      evidence: { source: { subgraph_id: string }; quality: { decision: string } };
    };
  };
  assert.equal(payload.tool_name, "sentinel_position_evidence");
  assert.equal(payload.schema_version, "position-evidence-tool.v1");
  assert.deepEqual(payload.request, { scenario: "allow-btc-buy" });
  assert.equal(payload.query_plan.read_only, true);
  assert.equal(payload.query_plan.template_id, "aave-v3-user-reserves");
  assert.equal(payload.query_plan.account_source, "server_configuration");
  assert.equal(payload.result.status, "ok");
  assert.equal(payload.result.evidence.source.subgraph_id, SUBGRAPH_ID);
  assert.equal(payload.result.evidence.quality.decision, "DENY");
  assert.equal(JSON.stringify(payload).includes("secret-test-key"), false);
});

test("position evidence tool preserves a blocked provider result without inventing evidence", async () => {
  let providerCalled = false;
  const result = await runPositionEvidenceTool(
    { scenario: "allow-btc-buy" },
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
  const payload = result.payload as {
    result: { status: string; reason: string; missing: string[] };
  };
  assert.deepEqual(payload.result, {
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
