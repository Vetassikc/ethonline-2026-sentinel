import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPositionQuery,
  runGraphPositionQuery,
} from "../app/graph-client.ts";
import { resolveGraphPositionOptions } from "../../scripts/graph-position.ts";

const ACCOUNT = "0x42bc857b5751126a71d203bde38ee8243b3ad1ed";
const SUBGRAPH_ID = "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF";
const META = {
  block: {
    number: 50989075,
    hash: "0x181bf855f6981c23116dc0b982f3bcd5698d792eaab82c080d81cb818e0e95b9",
    timestamp: 1_788_767_497,
  },
  hasIndexingErrors: false,
};

test("resolveGraphPositionOptions maps the local Graph environment without exposing credentials", () => {
  const options = resolveGraphPositionOptions({
    GRAPH_API_KEY: "secret-test-key",
    GRAPH_SUBGRAPH_ID: SUBGRAPH_ID,
    GRAPH_CHAIN_ID: "8453",
    GRAPH_DEMO_ACCOUNT: ACCOUNT,
  });

  assert.deepEqual(options, {
    apiKey: "secret-test-key",
    subgraphId: SUBGRAPH_ID,
    chainId: "8453",
    account: ACCOUNT,
  });
});

test("runGraphPositionQuery fails closed when the live configuration is missing", async () => {
  const result = await runGraphPositionQuery({});

  assert.deepEqual(result, {
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

function reserveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: `${ACCOUNT}0xreserve1xpool1`,
    user: { id: ACCOUNT },
    reserve: {
      id: "0xreserve1",
      underlyingAsset: "0xasset1",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      price: {
        priceInEth: "99990000",
        priceSource: "0xoracle1",
        lastUpdateTimestamp: 1_788_767_450,
      },
    },
    usageAsCollateralEnabledOnUser: true,
    currentATokenBalance: "227443188",
    currentTotalDebt: "6163337934",
    currentStableDebt: "0",
    currentVariableDebt: "6163337934",
    scaledVariableDebt: "5129338674",
    lastUpdateTimestamp: 1_788_767_307,
    ...overrides,
  };
}

function response(rows: unknown[], meta = META) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        data: {
          _meta: meta,
          userReserves: rows,
        },
      };
    },
  };
}

test("buildPositionQuery exposes a fixed account-position query and bounded variables", () => {
  const request = buildPositionQuery({
    account: ACCOUNT,
    pageSize: 25,
    cursor: "0xprevious",
  });

  assert.match(request.query, /userReserves/);
  assert.match(request.query, /currentTotalDebt/);
  assert.match(request.query, /_meta/);
  assert.deepEqual(request.variables, {
    account: ACCOUNT,
    first: 25,
    idGt: "0xprevious",
  });
  assert.equal(request.query.includes("GRAPH_API_KEY"), false);
});

test("runGraphPositionQuery returns normalized live observations and indexed provenance", async () => {
  let requestBody = "";
  const result = await runGraphPositionQuery({
    apiKey: "secret-test-key",
    subgraphId: SUBGRAPH_ID,
    chainId: "8453",
    account: ACCOUNT,
    pageSize: 10,
    now: new Date(1_788_767_498_000),
    fetchImpl: async (url, init) => {
      requestBody = String(init?.body);
      assert.equal(url.includes("secret-test-key"), false);
      return response([reserveRow()]);
    },
  });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.subject.account, ACCOUNT);
    assert.equal(result.subject.chain_id, 8453);
    assert.equal(result.observations.length, 1);
    assert.equal(result.observations[0]?.asset.symbol, "USDC");
    assert.equal(result.observations[0]?.supplied_raw, "227443188");
    assert.equal(result.observations[0]?.debt_raw, "6163337934");
    assert.equal(result.source.indexed_block.number, META.block.number);
    assert.deepEqual(result.gaps, ["usd_valuation_unavailable"]);
  }
  assert.match(requestBody, /PositionEvidence/);
  assert.equal(requestBody.includes("secret-test-key"), false);
});

test("runGraphPositionQuery follows id cursor pagination and marks a complete result", async () => {
  const calls: Array<{ first: number; idGt: string | null }> = [];
  const rows = [reserveRow({ id: "a" }), reserveRow({ id: "b" }), reserveRow({ id: "c" })];
  const result = await runGraphPositionQuery({
    apiKey: "secret-test-key",
    subgraphId: SUBGRAPH_ID,
    chainId: 8453,
    account: ACCOUNT,
    pageSize: 2,
    now: new Date(1_788_767_498_000),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { variables: { account: string; first: number; idGt?: string } };
      calls.push(body.variables);
      return response(calls.length === 1 ? rows.slice(0, 2) : rows.slice(2));
    },
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(calls, [
    { account: ACCOUNT, first: 2 },
    { account: ACCOUNT, first: 2, idGt: "b" },
  ]);
  if (result.status === "ok") {
    assert.equal(result.observations.length, 3);
    assert.equal(result.pagination.complete, true);
    assert.equal(result.pagination.pages, 2);
    assert.deepEqual(result.gaps, ["usd_valuation_unavailable"]);
  }
});

test("runGraphPositionQuery blocks before network access for an invalid account", async () => {
  let called = false;
  const result = await runGraphPositionQuery({
    apiKey: "secret-test-key",
    subgraphId: SUBGRAPH_ID,
    chainId: 8453,
    account: "not-an-address",
    fetchImpl: async () => {
      called = true;
      throw new Error("must not call provider");
    },
  });

  assert.deepEqual(result, {
    status: "blocked",
    reason: "invalid_subject",
    details: ["account must be a 20-byte EVM address."],
  });
  assert.equal(called, false);
});

test("runGraphPositionQuery keeps provider errors sanitized", async () => {
  const result = await runGraphPositionQuery({
    apiKey: "secret-test-key",
    subgraphId: SUBGRAPH_ID,
    chainId: 8453,
    account: ACCOUNT,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { errors: [{ message: "secret-test-key provider details" }] };
      },
    }),
  });

  assert.deepEqual(result, {
    status: "error",
    reason: "graphql_error",
    details: "provider_rejected_query",
  });
  assert.equal(JSON.stringify(result).includes("secret-test-key"), false);
});

test("runGraphPositionQuery reports a bounded provider timeout", async () => {
  const result = await runGraphPositionQuery({
    apiKey: "secret-test-key",
    subgraphId: SUBGRAPH_ID,
    chainId: 8453,
    account: ACCOUNT,
    fetchImpl: async () => {
      const error = new Error("provider timeout details");
      error.name = "AbortError";
      throw error;
    },
  });

  assert.deepEqual(result, { status: "error", reason: "timeout" });
});

test("runGraphPositionQuery exposes freshness, indexing and pagination gaps", async () => {
  const result = await runGraphPositionQuery({
    apiKey: "secret-test-key",
    subgraphId: SUBGRAPH_ID,
    chainId: 8453,
    account: ACCOUNT,
    pageSize: 1,
    maxPages: 1,
    now: new Date(1_788_767_498_000),
    fetchImpl: async () =>
      response(
        [reserveRow({ currentTotalDebt: "-7" })],
        {
          block: { number: 123, hash: "", timestamp: undefined },
          hasIndexingErrors: true,
        },
      ),
  });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.deepEqual(result.gaps, [
      "usd_valuation_unavailable",
      "missing_block_timestamp",
      "missing_block_hash",
      "provider_reports_indexing_errors",
      "negative_debt_value",
      "pagination_limit_reached",
    ]);
    assert.equal(result.pagination.complete, false);
  }
});

test("runGraphPositionQuery marks an old oracle price as a visible gap", async () => {
  const row = reserveRow({
    reserve: {
      ...reserveRow().reserve,
      price: {
        ...reserveRow().reserve.price,
        lastUpdateTimestamp: 1_788_766_000,
      },
    },
  });
  const result = await runGraphPositionQuery({
    apiKey: "secret-test-key",
    subgraphId: SUBGRAPH_ID,
    chainId: 8453,
    account: ACCOUNT,
    now: new Date(1_788_767_498_000),
    fetchImpl: async () => response([row]),
  });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.observations[0]?.asset.price_age_seconds, 1_498);
    assert.equal(result.gaps.includes("stale_oracle_price"), true);
  }
});
