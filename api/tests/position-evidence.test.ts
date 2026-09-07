import test from "node:test";
import assert from "node:assert/strict";

import type { GraphPositionEvidence } from "../app/graph-client.ts";
import {
  canonicalStringify,
  computePositionEvidenceHash,
  normalizePositionEvidence,
  rawIntegerToDecimal,
} from "../app/position-evidence.ts";

const ACCOUNT = "0x00068c8cb77e6eed45d274f5c51a0461a8cfdbbd";
const SUBGRAPH_ID = "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF";
const NOW = new Date("2026-09-07T10:00:00.000Z");

function graphEvidence(
  overrides: Partial<GraphPositionEvidence> = {},
): GraphPositionEvidence {
  return {
    status: "ok",
    mode: "live",
    subject: {
      account: ACCOUNT,
      chain_id: 8453,
    },
    source: {
      provider: "thegraph",
      subgraph_id: SUBGRAPH_ID,
      endpoint: "https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>",
      fetched_at: NOW.toISOString(),
      indexed_block: {
        number: 30_000_000,
        hash: "0xblockhash",
        timestamp: Math.floor(NOW.getTime() / 1000) - 20,
      },
      has_indexing_errors: false,
      index_age_seconds: 20,
    },
    observations: [
      {
        id: `${ACCOUNT}0xreserve1xpool1`,
        account: ACCOUNT,
        asset: {
          address: "0x0000000000000000000000000000000000000001",
          symbol: "USDC",
          name: "USD Coin",
          decimals: 6,
          price_in_eth_raw: "99990000",
          price_source: "0xoracle1",
          price_updated_at: Math.floor(NOW.getTime() / 1000) - 20,
          price_age_seconds: 20,
        },
        supplied_raw: "227443188",
        debt_raw: "6163337934",
        stable_debt_raw: "0",
        variable_debt_raw: "6163337934",
        collateral_enabled: true,
        position_updated_at: Math.floor(NOW.getTime() / 1000) - 20,
      },
    ],
    valuation: {
      unit: "ETH",
      usd_available: false,
      note: "provider_exposes_price_in_eth_only",
    },
    pagination: {
      page_size: 100,
      pages: 1,
      complete: true,
    },
    gaps: ["usd_valuation_unavailable"],
    ...overrides,
  };
}

test("canonicalStringify sorts object keys while preserving array order", () => {
  assert.equal(
    canonicalStringify({ z: 2, a: { y: 1, x: ["first", "second"] } }),
    '{"a":{"x":["first","second"],"y":1},"z":2}',
  );
});

test("rawIntegerToDecimal preserves exact token scale without floating point", () => {
  assert.equal(rawIntegerToDecimal("227443188", 6), "227.443188");
  assert.equal(rawIntegerToDecimal("1", 8), "0.00000001");
  assert.equal(rawIntegerToDecimal("100000000", 6), "100.000000");
  assert.equal(rawIntegerToDecimal("-7", 2), "-0.07");
});

test("normalizePositionEvidence emits a versioned envelope with decimal amounts and a hash", () => {
  const result = normalizePositionEvidence(graphEvidence(), {
    expected_account: ACCOUNT,
    expected_chain_id: 8453,
    expected_subgraph_id: SUBGRAPH_ID,
    now: NOW,
  });

  assert.equal(result.schema_version, "position_evidence.v1");
  assert.equal(result.mode, "live");
  assert.equal(result.subject.account, ACCOUNT);
  assert.equal(result.subject.chain_id, 8453);
  assert.equal(result.subject.deployment.subgraph_id, SUBGRAPH_ID);
  assert.equal(result.observations[0]?.supplied.decimal, "227.443188");
  assert.equal(result.observations[0]?.debt.decimal, "6163.337934");
  assert.equal(result.observations[0]?.supplied.raw, "227443188");
  assert.equal(result.quality.decision, "DENY");
  assert.deepEqual(result.quality.reason_codes, ["usd_valuation_unavailable"]);
  assert.match(result.evidence_hash, /^0x[0-9a-f]{64}$/);
  assert.equal("evidence_hash" in result, true);
  assert.equal(JSON.stringify(result).includes("undefined"), false);
});

test("normalizePositionEvidence produces the same hash for the same payload and changes it after mutation", () => {
  const first = normalizePositionEvidence(graphEvidence(), { now: NOW });
  const second = normalizePositionEvidence(graphEvidence(), { now: NOW });
  const changed = normalizePositionEvidence(
    graphEvidence({
      observations: [
        {
          ...graphEvidence().observations[0]!,
          supplied_raw: "227443189",
        },
      ],
    }),
    { now: NOW },
  );

  assert.equal(first.evidence_hash, second.evidence_hash);
  assert.notEqual(first.evidence_hash, changed.evidence_hash);
});

test("computePositionEvidenceHash independently recomputes the stored hash", () => {
  const result = normalizePositionEvidence(graphEvidence(), { now: NOW });

  assert.equal(computePositionEvidenceHash(result), result.evidence_hash);
  assert.notEqual(
    computePositionEvidenceHash({
      ...result,
      gaps: ["tampered"],
    }),
    result.evidence_hash,
  );
});

test("normalizePositionEvidence fails closed for stale block, incomplete pagination and empty observations", () => {
  const stale = normalizePositionEvidence(
    graphEvidence({
      source: {
        ...graphEvidence().source,
        indexed_block: {
          ...graphEvidence().source.indexed_block,
          timestamp: Math.floor(NOW.getTime() / 1000) - 301,
        },
        index_age_seconds: 301,
      },
      pagination: { page_size: 100, pages: 10, complete: false },
    }),
    { now: NOW },
  );
  const empty = normalizePositionEvidence(
    graphEvidence({ observations: [], gaps: [] }),
    { now: NOW },
  );

  assert.equal(stale.quality.decision, "DENY");
  assert.equal(stale.quality.reason_codes.includes("stale_indexed_block"), true);
  assert.equal(stale.quality.reason_codes.includes("pagination_incomplete"), true);
  assert.equal(empty.quality.decision, "DENY");
  assert.deepEqual(empty.quality.reason_codes, ["no_position_observations", "usd_valuation_unavailable"]);
});

test("normalizePositionEvidence records subject mismatches as quality gaps", () => {
  const result = normalizePositionEvidence(graphEvidence(), {
    expected_account: "0x0000000000000000000000000000000000000002",
    expected_chain_id: 1,
    expected_subgraph_id: "different-deployment",
    now: NOW,
  });

  assert.equal(result.quality.decision, "DENY");
  assert.equal(result.quality.reason_codes.includes("account_mismatch"), true);
  assert.equal(result.quality.reason_codes.includes("chain_mismatch"), true);
  assert.equal(result.quality.reason_codes.includes("deployment_mismatch"), true);
});

test("normalizePositionEvidence rejects malformed token integers instead of inventing zero", () => {
  assert.throws(() => rawIntegerToDecimal("not-an-integer", 6), /invalid_raw_integer/);
  assert.throws(() => rawIntegerToDecimal("1", 256), /invalid_decimals/);

  const result = normalizePositionEvidence(
    graphEvidence({
      observations: [
        {
          ...graphEvidence().observations[0]!,
          supplied_raw: "not-an-integer",
        },
      ],
    }),
    { now: NOW },
  );

  assert.equal(result.quality.decision, "DENY");
  assert.equal(result.quality.reason_codes.includes("invalid_supply_amount"), true);
  assert.equal(result.observations[0]?.supplied.decimal, null);
});
