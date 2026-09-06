import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGraphEndpoint,
  parsePreflightPayload,
  runGraphPreflight,
} from "../../scripts/graph-preflight.ts";

test("buildGraphEndpoint never puts an API key in the endpoint", () => {
  assert.equal(
    buildGraphEndpoint("QmExampleSubgraph_123"),
    "https://gateway.thegraph.com/api/subgraphs/id/QmExampleSubgraph_123",
  );
  assert.throws(() => buildGraphEndpoint("bad/id"), /invalid_subgraph_id/);
});

test("preflight fails closed when credentials are missing", async () => {
  let called = false;
  const result = await runGraphPreflight({
    fetchImpl: async () => {
      called = true;
      throw new Error("must not call provider");
    },
  });

  assert.deepEqual(result, {
    status: "blocked",
    reason: "missing_configuration",
    missing: ["GRAPH_API_KEY", "GRAPH_SUBGRAPH_ID"],
  });
  assert.equal(called, false);
});

test("preflight sends bearer auth and returns sanitized indexed metadata", async () => {
  const apiKey = "secret-test-key";
  let request: { url: string; headers: Headers; body: string } | undefined;
  const result = await runGraphPreflight({
    apiKey,
    subgraphId: "QmExampleSubgraph_123",
    chainId: "8453",
    now: new Date("2026-09-06T12:00:00.000Z"),
    fetchImpl: async (url, init) => {
      request = {
        url,
        headers: new Headers(init?.headers),
        body: String(init?.body),
      };
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              _meta: {
                block: {
                  number: 123,
                  hash: "0xabc",
                  timestamp: 1_788_672_000,
                },
                hasIndexingErrors: false,
              },
            },
          };
        },
      };
    },
  });

  assert.equal(result.status, "ok");
  assert.equal(request?.headers.get("authorization"), `Bearer ${apiKey}`);
  assert.equal(request?.url.includes(apiKey), false);
  assert.equal(JSON.stringify(result).includes(apiKey), false);
  if (result.status === "ok") {
    assert.equal(result.subgraph_id, "QmExampleSubgraph_123");
    assert.equal(result.chain_id, "8453");
    assert.equal(result.indexed_block.number, 123);
    assert.equal(result.indexed_block.hash, "0xabc");
  }
  assert.match(request?.body ?? "", /PositionEvidencePreflight/);
});

test("GraphQL errors remain explicit without returning provider text", () => {
  const result = parsePreflightPayload({
    errors: [{ message: "secret-key\nprovider rejected query" }],
  });

  assert.deepEqual(result, {
    status: "error",
    reason: "graphql_error",
    details: "provider_rejected_query",
  });
});

test("missing freshness metadata becomes a visible warning", () => {
  const result = parsePreflightPayload(
    { data: { _meta: { block: { number: 123 }, hasIndexingErrors: true } } },
    new Date("2026-09-06T12:00:00.000Z"),
  );

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.deepEqual(result.warnings, [
      "missing_block_timestamp",
      "missing_block_hash",
      "provider_reports_indexing_errors",
    ]);
  }
});
