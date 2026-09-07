import test from "node:test";
import assert from "node:assert/strict";

import type { GraphPositionEvidence } from "../app/graph-client.ts";
import { normalizePositionEvidence } from "../app/position-evidence.ts";
import { evaluatePositionEvidencePolicy } from "../app/evidence-policy.ts";
import {
  issueEvidencePermit,
  verifyEvidencePermit,
} from "../app/evidence-permit.ts";
import type { PositionEvidenceV1 } from "../../shared/schemas/position-evidence.ts";
import {
  loadScenarioIntent,
} from "../app/scenarios.ts";

const ACCOUNT = "0x00068c8cb77e6eed45d274f5c51a0461a8cfdbbd";
const SUBGRAPH_ID = "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF";
const NOW = new Date("2026-09-07T10:00:00.000Z");

function cleanEvidence(): PositionEvidenceV1 {
  const timestamp = Math.floor(NOW.getTime() / 1000) - 20;
  const graph: GraphPositionEvidence = {
    status: "ok",
    mode: "fixture",
    subject: { account: ACCOUNT, chain_id: 8453 },
    source: {
      provider: "thegraph",
      subgraph_id: SUBGRAPH_ID,
      endpoint: "https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>",
      fetched_at: NOW.toISOString(),
      indexed_block: { number: 30_000_000, hash: "0xblockhash", timestamp },
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
          price_in_eth_raw: "1000000000000000",
          price_source: "0xoracle1",
          price_updated_at: timestamp,
          price_age_seconds: 20,
        },
        supplied_raw: "1000000",
        debt_raw: "0",
        stable_debt_raw: "0",
        variable_debt_raw: "0",
        collateral_enabled: true,
        position_updated_at: timestamp,
      },
    ],
    valuation: {
      unit: "ETH",
      usd_available: true,
      note: "fixture-only valuation for permit tests",
    },
    pagination: { page_size: 100, pages: 1, complete: true },
    gaps: [],
  };
  return normalizePositionEvidence(graph, { now: NOW });
}

async function issueForScenario(
  scenario: "allow-btc-buy" | "downsize-eth-buy" = "allow-btc-buy",
  options: { nonce?: string; audience?: string } = {},
) {
  const intent = await loadScenarioIntent(scenario);
  const evidence = cleanEvidence();
  const policy = evaluatePositionEvidencePolicy(intent, evidence);
  const issued = issueEvidencePermit(intent, evidence, policy, {
    now: NOW,
    nonce: options.nonce ?? "42",
    audience: options.audience,
  });
  assert.equal(issued.status, "issued");
  if (issued.status !== "issued") throw new Error("permit_not_issued");
  return { intent, evidence, policy, permit: issued.permit };
}

test("issueEvidencePermit refuses to sign a denied evidence policy", async () => {
  const intent = await loadScenarioIntent("allow-btc-buy");
  const evidence = cleanEvidence();
  const policy = evaluatePositionEvidencePolicy(intent, {
    ...evidence,
    gaps: ["stale_indexed_block"],
    quality: { decision: "DENY", reason_codes: ["stale_indexed_block"] },
  });

  const result = issueEvidencePermit(intent, evidence, policy, {
    now: NOW,
    nonce: "1",
  });

  assert.deepEqual(result, { status: "blocked", reason: "policy_denied" });
});

test("issueEvidencePermit refuses a contradictory policy envelope even when its verdict says ALLOW", async () => {
  const intent = await loadScenarioIntent("allow-btc-buy");
  const evidence = cleanEvidence();
  const policy = evaluatePositionEvidencePolicy(intent, evidence);
  const result = issueEvidencePermit(
    intent,
    evidence,
    {
      ...policy,
      evidence_quality: "DENY",
    },
    { now: NOW, nonce: "2" },
  );

  assert.deepEqual(result, { status: "blocked", reason: "invalid_evidence" });
});

test("issueEvidencePermit creates an EIP-712 permit that verifies independently", async () => {
  const { intent, evidence, permit } = await issueForScenario();
  const verification = verifyEvidencePermit({
    intent,
    evidence,
    permit,
    now: new Date(NOW.getTime() + 1_000),
    nonce_store: new Set(),
  });

  assert.equal(permit.schema_version, "position-evidence-permit.v1");
  assert.equal(permit.demo_only, true);
  assert.match(permit.permit_hash, /^0x[0-9a-f]{64}$/);
  assert.match(permit.signature, /^0x[0-9a-f]{130}$/);
  assert.equal(verification.valid, true);
  assert.equal(verification.executable, true);
  assert.equal(verification.code, "EXECUTION_PERMITTED");
});

test("verifyEvidencePermit rejects changed intent and changed evidence", async () => {
  const { intent, evidence, permit } = await issueForScenario();
  const changedIntent = {
    ...intent,
    notional_usd: "2400.01",
  };
  const changedEvidence = {
    ...evidence,
    gaps: ["tampered"],
  };

  const intentResult = verifyEvidencePermit({
    intent: changedIntent,
    evidence,
    permit,
    now: NOW,
    nonce_store: new Set(),
  });
  const evidenceResult = verifyEvidencePermit({
    intent,
    evidence: changedEvidence,
    permit,
    now: NOW,
    nonce_store: new Set(),
  });

  assert.equal(intentResult.valid, false);
  assert.equal(intentResult.executable, false);
  assert.equal(intentResult.code, "INTENT_HASH_MISMATCH");
  assert.equal(evidenceResult.valid, false);
  assert.equal(evidenceResult.executable, false);
  assert.equal(evidenceResult.code, "EVIDENCE_HASH_MISMATCH");
});

test("verifyEvidencePermit rejects an unexpected audience and malformed signature", async () => {
  const { intent, evidence, permit } = await issueForScenario("allow-btc-buy", {
    audience: "unexpected-executor",
  });
  const audienceResult = verifyEvidencePermit({
    intent,
    evidence,
    permit,
    now: NOW,
    nonce_store: new Set(),
  });
  const signatureResult = verifyEvidencePermit({
    intent,
    evidence,
    permit: { ...permit, signature: `0x${"00".repeat(65)}` },
    now: NOW,
    nonce_store: new Set(),
  });

  assert.equal(audienceResult.valid, false);
  assert.equal(audienceResult.executable, false);
  assert.equal(audienceResult.code, "AUDIENCE_MISMATCH");
  assert.equal(signatureResult.valid, false);
  assert.equal(signatureResult.executable, false);
  assert.equal(signatureResult.code, "SIGNATURE_INVALID");
});

test("verifyEvidencePermit keeps the permit valid but blocks a request above authorization", async () => {
  const { intent, evidence, permit } = await issueForScenario("downsize-eth-buy");
  const result = verifyEvidencePermit({
    intent,
    evidence,
    permit,
    requested_notional_usd: intent.notional_usd,
    now: NOW,
    nonce_store: new Set(),
  });

  assert.equal(result.valid, true);
  assert.equal(result.executable, false);
  assert.equal(result.code, "REQUEST_EXCEEDS_AUTHORIZATION");
});

test("verifyEvidencePermit rejects expired permits and consumes a valid nonce once", async () => {
  const { intent, evidence, permit } = await issueForScenario();
  const nonceStore = new Set<string>();
  const expired = verifyEvidencePermit({
    intent,
    evidence,
    permit,
    now: new Date(NOW.getTime() + 301_000),
    nonce_store: new Set(),
  });
  const first = verifyEvidencePermit({
    intent,
    evidence,
    permit,
    now: NOW,
    nonce_store: nonceStore,
  });
  const second = verifyEvidencePermit({
    intent,
    evidence,
    permit,
    now: NOW,
    nonce_store: nonceStore,
  });

  assert.equal(expired.valid, true);
  assert.equal(expired.executable, false);
  assert.equal(expired.code, "PERMIT_EXPIRED");
  assert.equal(first.executable, true);
  assert.equal(second.valid, true);
  assert.equal(second.executable, false);
  assert.equal(second.code, "NONCE_ALREADY_USED");
});

test("verifyEvidencePermit fails closed for a malformed permit payload", async () => {
  const { intent, evidence } = await issueForScenario();
  const result = verifyEvidencePermit({
    intent,
    evidence,
    permit: {} as never,
    now: NOW,
    nonce_store: new Set(),
  });

  assert.equal(result.valid, false);
  assert.equal(result.executable, false);
  assert.equal(result.code, "INVALID_PERMIT_SCHEMA");
});
