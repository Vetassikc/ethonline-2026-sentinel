import test from "node:test";
import assert from "node:assert/strict";

import {
  issueExposurePermit,
  verifyExposurePermit,
  type SignedExposurePermit,
} from "../app/exposure-permit.ts";
import type { ExposureEvaluation, ExposureGraphV1, ExposureRequest } from "../../shared/schemas/exposure-graph.ts";

const ACCOUNT = "0x42bc857b5751126a71d203bde38ee8243b3ad1ed";
const GRAPH_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BLOCK_HASH = "0x181bf855f6981c23116dc0b982f3bcd5698d792eaab82c080d81cb818e0e95b9";
const NOW = new Date("2026-09-07T14:00:00.000Z");
const REQUEST: ExposureRequest = {
  schema_version: "sentinel-exposure-buy.v1",
  action: "BUY_EXPOSURE",
  asset: "wstETH",
  unit: "wstETH",
  requested_units: "0.500000000000000000",
};

function graph(overrides: Partial<ExposureGraphV1> = {}): ExposureGraphV1 {
  return {
    schema_version: "exposure_graph.v1",
    mode: "live",
    source_status: "ok",
    subject: { account: ACCOUNT, chain_id: 8453 },
    source: {
      graph_subgraph_id: "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF",
      graph_endpoint: "https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>",
      rpc_endpoint: "https://mainnet.base.org",
      block: { number: 123, hash: BLOCK_HASH, timestamp: 1_788_790_000 },
    },
    nodes: [],
    edges: [],
    paths: [],
    debt: [],
    gaps: ["usd_valuation_unavailable", "stale_oracle_price"],
    graph_hash: GRAPH_HASH,
    ...overrides,
  };
}

function evaluation(overrides: Partial<ExposureEvaluation> = {}): ExposureEvaluation {
  return {
    schema_version: "exposure_evaluation.v1",
    mode: "live",
    request: REQUEST,
    graph: graph(),
    policy: {
      verdict: "ALLOW_WITH_DOWNSIZE",
      requested_units: REQUEST.requested_units,
      allowed_units: "0.500000000000000000",
      dependency_cap_units: "1.000000000000000000",
      gross_exposure_units: "0.500000000000000000",
      headroom_units: "0.500000000000000000",
      binding_constraint: "none",
      policy_version: "exposure-wsteth-v1",
      unit: "wstETH",
      reason_codes: [],
      debt_units: "0.000000000000000000",
    },
    created_at: NOW.toISOString(),
    expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

function issuedPermit(): SignedExposurePermit {
  const result = issueExposurePermit(evaluation(), { now: NOW, nonce: "7" });
  assert.equal(result.status, "issued");
  if (result.status !== "issued") throw new Error("expected permit");
  return result.permit;
}

test("verifyExposurePermit is pure and does not consume a nonce", () => {
  const permit = issuedPermit();
  const first = verifyExposurePermit({ request: REQUEST, permit, now: NOW });
  const second = verifyExposurePermit({ request: REQUEST, permit, now: NOW });

  assert.equal(first.valid, true);
  assert.equal(first.executable, true);
  assert.equal(second.valid, true);
  assert.equal(second.executable, true);
});

test("issueExposurePermit binds the server evaluation and refuses denied policy", () => {
  const issued = issueExposurePermit(evaluation(), { now: NOW, nonce: "7" });
  assert.equal(issued.status, "issued");
  if (issued.status === "issued") {
    assert.equal(issued.permit.payload.graph_hash, GRAPH_HASH);
    assert.equal(issued.permit.payload.authorized_units, "0.500000000000000000");
    assert.equal(issued.permit.demo_only, true);
    assert.equal(JSON.stringify(issued).includes("private"), false);
  }

  const denied = issueExposurePermit(
    evaluation({ policy: { ...evaluation().policy, verdict: "DENY", allowed_units: "0.000000000000000000" } }),
    { now: NOW, nonce: "8" },
  );
  assert.deepEqual(denied, { status: "blocked", reason: "policy_denied" });
});

test("verifyExposurePermit rejects changed request bindings and excess amount", () => {
  const permit = issuedPermit();
  const changedAction = verifyExposurePermit({
    request: { ...REQUEST, action: "BUY_EXPOSURE" },
    permit,
    now: NOW,
  });
  assert.equal(changedAction.valid, true);

  const excess = verifyExposurePermit({
    request: { ...REQUEST, requested_units: "0.500000000000000001" },
    permit,
    now: NOW,
  });
  assert.equal(excess.executable, false);
  assert.equal(excess.code, "REQUEST_EXCEEDS_AUTHORIZATION");

  const changedAsset = verifyExposurePermit({
    request: { ...REQUEST, asset: "wstETH" },
    permit,
    now: NOW,
    expected_audience: "another-executor",
  });
  assert.equal(changedAsset.valid, false);
  assert.equal(changedAsset.code, "AUDIENCE_MISMATCH");
});

test("verifyExposurePermit rejects expired, not-yet-active and untrusted permits", () => {
  const permit = issuedPermit();
  const expired = verifyExposurePermit({
    request: REQUEST,
    permit,
    now: new Date(NOW.getTime() + 301_000),
  });
  assert.equal(expired.executable, false);
  assert.equal(expired.code, "PERMIT_EXPIRED");

  const future = issueExposurePermit(evaluation(), {
    now: new Date(NOW.getTime() + 60_000),
    nonce: "8",
  });
  assert.equal(future.status, "issued");
  if (future.status === "issued") {
    const notYet = verifyExposurePermit({ request: REQUEST, permit: future.permit, now: NOW });
    assert.equal(notYet.executable, false);
    assert.equal(notYet.code, "PERMIT_NOT_YET_ACTIVE");
  }

  const untrusted = verifyExposurePermit({
    request: REQUEST,
    permit: { ...permit, signer: "0x0000000000000000000000000000000000000001" },
    now: NOW,
  });
  assert.equal(untrusted.valid, false);
  assert.equal(untrusted.code, "SIGNER_UNTRUSTED");
});

test("verifyExposurePermit fails closed for malformed typed data", () => {
  const permit = issuedPermit();
  const malformed = verifyExposurePermit({
    request: REQUEST,
    permit: { ...permit, typed_data: { ...permit.typed_data, message: {} } },
    now: NOW,
  });
  assert.equal(malformed.valid, false);
  assert.equal(malformed.executable, false);
  assert.equal(malformed.code, "PERMIT_PAYLOAD_MISMATCH");
});
