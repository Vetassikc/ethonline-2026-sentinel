import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateTradeIntent,
} from "../app/policy.ts";
import { evaluatePositionEvidencePolicy } from "../app/evidence-policy.ts";
import type { PositionEvidenceV1 } from "../../shared/schemas/position-evidence.ts";
import {
  loadScenarioIntent,
} from "../app/scenarios.ts";

const ACCOUNT = "0x00068c8cb77e6eed45d274f5c51a0461a8cfdbbd";
const SUBGRAPH_ID = "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF";

function evidence(
  overrides: Partial<PositionEvidenceV1> = {},
): PositionEvidenceV1 {
  return {
    schema_version: "position_evidence.v1",
    mode: "fixture",
    subject: {
      chain_id: 8453,
      account: ACCOUNT,
      protocol: "aave-v3",
      deployment: { subgraph_id: SUBGRAPH_ID },
    },
    query: {
      template_id: "aave-v3-user-reserves",
      template_version: "1",
      variables_hash: "0xvariables",
    },
    source: {
      provider: "thegraph",
      subgraph_id: SUBGRAPH_ID,
      fetched_at: "2026-09-07T10:00:00.000Z",
      indexed_block: {
        number: 30_000_000,
        hash: "0xblockhash",
        timestamp: 1_788_770_380,
      },
      has_indexing_errors: false,
      index_age_seconds: 20,
    },
    observations: [],
    valuation: {
      unit: "ETH",
      usd_available: true,
      note: "fixture-only valuation for policy contract tests",
    },
    pagination: {
      page_size: 100,
      pages: 1,
      complete: true,
    },
    gaps: [],
    quality: {
      decision: "ACCEPT",
      reason_codes: [],
    },
    evidence_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...overrides,
  };
}

test("evidence policy blocks a baseline ALLOW when live evidence quality is denied", async () => {
  const intent = await loadScenarioIntent("allow-btc-buy");
  const baseline = evaluateTradeIntent(intent);
  const result = evaluatePositionEvidencePolicy(intent, evidence({
    mode: "live",
    gaps: ["stale_indexed_block"],
    quality: {
      decision: "DENY",
      reason_codes: ["stale_indexed_block"],
    },
  }));

  assert.equal(baseline.verdict, "ALLOW");
  assert.equal(result.verdict, "DENY");
  assert.equal(result.baseline_verdict, "ALLOW");
  assert.equal(result.reason_code, "POSITION_EVIDENCE_BLOCKED");
  assert.deepEqual(result.reason_detail, [
    "evidence_quality_denied",
    "stale_indexed_block",
  ]);
  assert.equal(result.allowed_notional_usd, "0.00");
});

test("evidence policy preserves an existing baseline ALLOW when evidence quality is accepted", async () => {
  const intent = await loadScenarioIntent("allow-btc-buy");
  const baseline = evaluateTradeIntent(intent);
  const result = evaluatePositionEvidencePolicy(intent, evidence());

  assert.equal(result.verdict, baseline.verdict);
  assert.equal(result.reason_code, baseline.reason_code);
  assert.equal(result.allowed_notional_usd, baseline.allowed_notional_usd);
  assert.equal(result.evidence_hash, evidence().evidence_hash);
});

test("evidence policy preserves a baseline downsized decision after evidence acceptance", async () => {
  const intent = await loadScenarioIntent("downsize-eth-buy");
  const baseline = evaluateTradeIntent(intent);
  const result = evaluatePositionEvidencePolicy(intent, evidence());

  assert.equal(baseline.verdict, "ALLOW_WITH_DOWNSIZE");
  assert.equal(result.verdict, "ALLOW_WITH_DOWNSIZE");
  assert.equal(result.allowed_notional_usd, "2500.00");
});

test("evidence policy never weakens an existing baseline DENY", async () => {
  const intent = await loadScenarioIntent("deny-oversize-eth");
  const baseline = evaluateTradeIntent(intent);
  const result = evaluatePositionEvidencePolicy(intent, evidence());

  assert.equal(baseline.verdict, "DENY");
  assert.equal(result.verdict, "DENY");
  assert.equal(result.reason_code, baseline.reason_code);
  assert.equal(result.allowed_notional_usd, baseline.allowed_notional_usd);
});

test("evidence policy fails closed for an invalid or internally inconsistent envelope", async () => {
  const intent = await loadScenarioIntent("allow-btc-buy");
  const invalidSchema = evaluatePositionEvidencePolicy(intent, evidence({
    schema_version: "position_evidence.unknown" as PositionEvidenceV1["schema_version"],
  }));
  const inconsistentQuality = evaluatePositionEvidencePolicy(intent, evidence({
    gaps: ["stale_oracle_price"],
    quality: { decision: "ACCEPT", reason_codes: [] },
  }));

  assert.equal(invalidSchema.verdict, "DENY");
  assert.equal(invalidSchema.reason_code, "INVALID_POSITION_EVIDENCE");
  assert.equal(inconsistentQuality.verdict, "DENY");
  assert.equal(inconsistentQuality.reason_code, "INVALID_POSITION_EVIDENCE");
});
