import test from "node:test";
import assert from "node:assert/strict";

import { createExposureRuntimeState } from "../app/exposure-service.ts";
import {
  checkExposurePermitConditions,
  executeExposurePermit,
} from "../app/condition-check.ts";
import { issueExposurePermit } from "../app/exposure-permit.ts";
import type { ExposureEvaluation, ExposureGraphV1, ExposureRequest } from "../../shared/schemas/exposure-graph.ts";

const ACCOUNT = "0x42bc857b5751126a71d203bde38ee8243b3ad1ed";
const BLOCK_HASH = "0x181bf855f6981c23116dc0b982f3bcd5698d792eaab82c080d81cb818e0e95b9";
const NOW = new Date("2026-09-07T14:00:00.000Z");
const REQUEST: ExposureRequest = {
  schema_version: "sentinel-exposure-buy.v1",
  action: "BUY_EXPOSURE",
  asset: "wstETH",
  unit: "wstETH",
  requested_units: "0.500000000000000000",
};

function makeEvaluation(overrides: {
  graph?: Partial<ExposureGraphV1>;
  policy?: Partial<ExposureEvaluation["policy"]>;
} = {}): ExposureEvaluation {
  return {
    schema_version: "exposure_evaluation.v1",
    mode: "live",
    request: REQUEST,
    graph: {
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
      graph_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ...overrides.graph,
    },
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
      ...overrides.policy,
    },
    created_at: NOW.toISOString(),
    expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
  };
}

function permitFor(evaluation = makeEvaluation()) {
  const result = issueExposurePermit(evaluation, { now: NOW, nonce: "7" });
  assert.equal(result.status, "issued");
  if (result.status !== "issued") throw new Error("expected permit");
  return result.permit;
}

test("condition check allows an unrelated block/hash change when headroom remains", () => {
  const permit = permitFor();
  const current = makeEvaluation({
    graph: {
      source: {
        ...makeEvaluation().graph.source,
        block: { number: 124, hash: `0x${"bb".repeat(32)}`, timestamp: 1_788_790_001 },
      },
    },
  });

  const result = checkExposurePermitConditions(permit, current);
  assert.equal(result.executable, true);
  assert.equal(result.code, "CONDITIONS_OK");
});

test("condition check blocks a valid old signature when current headroom falls", () => {
  const permit = permitFor();
  const current = makeEvaluation({
    policy: {
      verdict: "DENY",
      allowed_units: "0.000000000000000000",
      headroom_units: "0.000000000000000000",
    },
  });

  const result = checkExposurePermitConditions(permit, current);
  assert.equal(result.executable, false);
  assert.equal(result.code, "CURRENT_HEADROOM_INSUFFICIENT");
});

test("condition check blocks current source failure and policy changes", () => {
  const permit = permitFor();
  const source = checkExposurePermitConditions(
    permit,
    makeEvaluation({ graph: { source_status: "error", gaps: ["block_mismatch"] } }),
  );
  assert.equal(source.code, "CURRENT_SOURCE_UNAVAILABLE");

  const policy = checkExposurePermitConditions(
    permit,
    makeEvaluation({ policy: { policy_version: "exposure-wsteth-v2" } }),
  );
  assert.equal(policy.code, "POLICY_VERSION_MISMATCH");
});

test("executeExposurePermit consumes a nonce once and releases pending state", async () => {
  const permit = permitFor();
  const state = createExposureRuntimeState();
  const first = await executeExposurePermit({
    request: REQUEST,
    permit,
    state,
    now: NOW,
    refresh: async () => makeEvaluation(),
  });
  assert.equal(first.executable, true);
  assert.equal(state.consumed_nonces.has("7"), true);
  assert.equal(state.pending_accounts.size, 0);

  const second = await executeExposurePermit({
    request: REQUEST,
    permit,
    state,
    now: NOW,
    refresh: async () => makeEvaluation(),
  });
  assert.equal(second.executable, false);
  assert.equal(second.code, "NONCE_ALREADY_USED");
});

test("executeExposurePermit blocks same-account concurrent actions and does not consume on refresh failure", async () => {
  const permit = permitFor();
  const state = createExposureRuntimeState();
  let release: ((evaluation: ExposureEvaluation) => void) | undefined;
  const pending = new Promise<ExposureEvaluation>((resolve) => { release = resolve; });
  const firstPromise = executeExposurePermit({
    request: REQUEST,
    permit,
    state,
    now: NOW,
    refresh: async () => pending,
  });
  await Promise.resolve();
  const second = await executeExposurePermit({
    request: REQUEST,
    permit,
    state,
    now: NOW,
    refresh: async () => makeEvaluation(),
  });
  assert.equal(second.code, "ACCOUNT_ACTION_PENDING");
  release!(makeEvaluation());
  const first = await firstPromise;
  assert.equal(first.executable, true);
  assert.equal(state.pending_accounts.size, 0);

  const failed = await executeExposurePermit({
    request: REQUEST,
    permit: permitFor(makeEvaluation({ policy: { allowed_units: "0.6" } })),
    state: createExposureRuntimeState(),
    now: NOW,
    refresh: async () => ({ status: "blocked" as const, code: "REFRESH_FAILED" }),
  });
  assert.equal(failed.executable, false);
  assert.equal(failed.code, "REFRESH_FAILED");
});
