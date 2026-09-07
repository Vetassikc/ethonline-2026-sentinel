import test from "node:test";
import assert from "node:assert/strict";

import type { BaseWstEthSnapshot } from "../app/base-rpc.ts";
import { BASE_WSTETH_ADDRESS } from "../app/base-rpc.ts";
import type { GraphPositionEvidence } from "../app/graph-client.ts";
import { buildExposureGraph } from "../app/exposure-graph.ts";

const ACCOUNT = "0x42bc857b5751126a71d203bde38ee8243b3ad1ed";
const A_TOKEN = "0x99cbc45ea5bb7ef3a5bc08fb1b7e56bb2442ef0d";
const AAVE_POOL = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5";
const SUBGRAPH_ID = "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF";
const BLOCK_HASH = "0x181bf855f6981c23116dc0b982f3bcd5698d792eaab82c080d81cb818e0e95b9";
const BLOCK_NUMBER = 123;
const BLOCK_TIMESTAMP = 1_788_790_000;
const DIRECT_BALANCE = "20000000000000000";
const AAVE_SUPPLY = "30000000000000000";

function graphEvidence(
  observationOverrides: Record<string, unknown> = {},
  evidenceOverrides: Partial<GraphPositionEvidence> = {},
): GraphPositionEvidence {
  return {
    status: "ok",
    mode: "live",
    subject: { account: ACCOUNT, chain_id: 8453 },
    source: {
      provider: "thegraph",
      subgraph_id: SUBGRAPH_ID,
      endpoint: "https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>",
      fetched_at: "2026-09-07T14:00:00.000Z",
      indexed_block: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
      has_indexing_errors: false,
      index_age_seconds: 1,
    },
    observations: [
      {
        id: `${ACCOUNT}${BASE_WSTETH_ADDRESS}`,
        account: ACCOUNT,
        asset: {
          address: BASE_WSTETH_ADDRESS,
          symbol: "wstETH",
          name: "Wrapped liquid staked Ether 2.0",
          decimals: 18,
          price_in_eth_raw: null,
          price_source: null,
          price_updated_at: null,
          price_age_seconds: null,
        },
        supplied_raw: AAVE_SUPPLY,
        scaled_supplied_raw: AAVE_SUPPLY,
        a_token: {
          address: A_TOKEN,
          underlying_asset: BASE_WSTETH_ADDRESS,
          decimals: 18,
        },
        pool_address: AAVE_POOL,
        supply_index_raw: "1000000000000000000000000000",
        debt_raw: "1000000000000000",
        stable_debt_raw: "0",
        variable_debt_raw: "1000000000000000",
        collateral_enabled: false,
        position_updated_at: BLOCK_TIMESTAMP,
        ...observationOverrides,
      },
    ],
    valuation: {
      unit: "ETH",
      usd_available: false,
      note: "provider_exposes_price_in_eth_only",
    },
    pagination: { page_size: 100, pages: 1, complete: true },
    gaps: ["usd_valuation_unavailable", "stale_oracle_price"],
    ...evidenceOverrides,
  };
}

function rpcSnapshot(overrides: Partial<BaseWstEthSnapshot> = {}): BaseWstEthSnapshot {
  return {
    block: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    contracts: {
      underlying: BASE_WSTETH_ADDRESS,
      a_token: A_TOKEN,
      pool: AAVE_POOL,
      a_token_underlying_matches: true,
      decimals_match: true,
    },
    direct_balance_raw: DIRECT_BALANCE,
    aave_scaled_supply_raw: AAVE_SUPPLY,
    normalized_income_raw: "1000000000000000000000000000",
    normalized_aave_supply_raw: AAVE_SUPPLY,
    aave_balance_raw: AAVE_SUPPLY,
    gaps: [],
    ...overrides,
  };
}

test("buildExposureGraph converges direct and Aave paths on one asset", () => {
  const result = buildExposureGraph({ graph: graphEvidence(), rpc: rpcSnapshot() });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.graph.nodes.filter((node) => node.type === "asset").length, 1);
    assert.equal(result.graph.paths.length, 2);
    assert.deepEqual(new Set(result.graph.paths.map((path) => path.unit)), new Set(["wstETH"]));
    assert.equal(result.graph.edges.every((edge) => edge.provenance.block_number === BLOCK_NUMBER), true);
    assert.equal(result.graph.paths.every((path) => path.capital_contribution), true);
  }
});

test("buildExposureGraph rejects a Graph/RPC block mismatch", () => {
  const result = buildExposureGraph({
    graph: graphEvidence(),
    rpc: rpcSnapshot({ block: { number: BLOCK_NUMBER + 1, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP } }),
  });

  assert.deepEqual(result, { status: "error", reason: "block_mismatch" });
});

test("buildExposureGraph rejects a non-Base or non-wstETH candidate", () => {
  const result = buildExposureGraph({
    graph: graphEvidence({
      asset: {
        ...graphEvidence().observations[0]!.asset,
        address: "0x0000000000000000000000000000000000000001",
      },
    }),
    rpc: rpcSnapshot(),
  });

  assert.deepEqual(result, { status: "error", reason: "unsupported_asset" });
});

test("buildExposureGraph rejects duplicate path IDs and malformed quantities", () => {
  const duplicateObservation = graphEvidence({});
  duplicateObservation.observations.push({ ...duplicateObservation.observations[0]! });
  const duplicate = buildExposureGraph({ graph: duplicateObservation, rpc: rpcSnapshot() });
  assert.deepEqual(duplicate, { status: "error", reason: "duplicate_path_id" });

  const malformed = buildExposureGraph({
    graph: graphEvidence(),
    rpc: rpcSnapshot({ direct_balance_raw: "not-a-number" }),
  });
  assert.deepEqual(malformed, { status: "error", reason: "malformed_quantity" });
});

test("buildExposureGraph rejects an aToken claim for another underlying", () => {
  const result = buildExposureGraph({
    graph: graphEvidence({
      a_token: {
        address: A_TOKEN,
        underlying_asset: "0x0000000000000000000000000000000000000001",
        decimals: 18,
      },
    }),
    rpc: rpcSnapshot(),
  });

  assert.deepEqual(result, { status: "error", reason: "a_token_underlying_mismatch" });
});

test("the Aave receipt relation represents the same asset without a duplicate capital path", () => {
  const result = buildExposureGraph({ graph: graphEvidence(), rpc: rpcSnapshot() });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    const assetId = `asset:base:${BASE_WSTETH_ADDRESS}`;
    const aavePath = result.graph.paths.find((path) => path.kind === "aave_supply");
    assert.equal(result.graph.nodes.filter((node) => node.type === "asset").length, 1);
    assert.equal(aavePath?.representation_of, assetId);
    assert.equal(result.graph.paths.filter((path) => path.capital_contribution).length, 2);
    assert.equal(result.graph.edges.some((edge) => edge.type === "supplied_claim_on" && edge.to === assetId), true);
  }
});
