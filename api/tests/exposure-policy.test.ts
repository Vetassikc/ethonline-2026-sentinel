import test from "node:test";
import assert from "node:assert/strict";

import type { ExposureGraphV1 } from "../../shared/schemas/exposure-graph.ts";
import {
  evaluateExposurePolicy,
  formatFixedUnits,
  parseFixedUnits,
} from "../app/exposure-policy.ts";

const GRAPH: ExposureGraphV1 = {
  schema_version: "exposure_graph.v1",
  mode: "live",
  source_status: "ok",
  subject: {
    account: "0x42bc857b5751126a71d203bde38ee8243b3ad1ed",
    chain_id: 8453,
  },
  source: {
    graph_subgraph_id: "GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF",
    graph_endpoint: "https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>",
    rpc_endpoint: "https://mainnet.base.org",
    block: {
      number: 123,
      hash: "0x181bf855f6981c23116dc0b982f3bcd5698d792eaab82c080d81cb818e0e95b9",
      timestamp: 1_788_790_000,
    },
  },
  nodes: [],
  edges: [],
  paths: [
    {
      id: "path:direct:wsteth",
      kind: "direct_holding",
      unit: "wstETH",
      asset_id: "asset:base:wsteth",
      raw_quantity: "20000000000000000",
      decimal_quantity: "0.020000000000000000",
      decimals: 18,
      capital_contribution: true,
      representation_of: "asset:base:wsteth",
      edge_ids: [],
    },
    {
      id: "path:aave:wsteth",
      kind: "aave_supply",
      unit: "wstETH",
      asset_id: "asset:base:wsteth",
      raw_quantity: "30000000000000000",
      decimal_quantity: "0.030000000000000000",
      decimals: 18,
      capital_contribution: true,
      representation_of: "asset:base:wsteth",
      edge_ids: [],
    },
  ],
  debt: [
    {
      id: "debt:aave:wsteth",
      quantity: {
        raw: "500000000000000000",
        decimal: "0.500000000000000000",
        decimals: 18,
        unit: "wstETH",
      },
      source_path: "userReserves[].currentTotalDebt",
      block_number: 123,
      block_hash: "0x181bf855f6981c23116dc0b982f3bcd5698d792eaab82c080d81cb818e0e95b9",
    },
  ],
  gaps: ["usd_valuation_unavailable", "stale_oracle_price"],
  graph_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const CONFIG = {
  policy_version: "exposure-wsteth-v1",
  dependency_cap_units: "1.000000000000000000",
  unit: "wstETH" as const,
};

const REQUEST = {
  schema_version: "sentinel-exposure-buy.v1" as const,
  action: "BUY_EXPOSURE" as const,
  asset: "wstETH" as const,
  unit: "wstETH" as const,
  requested_units: "2.000000000000000000",
};

test("evaluateExposurePolicy downsizes to remaining dependency headroom", () => {
  const result = evaluateExposurePolicy(GRAPH, CONFIG, REQUEST);

  assert.equal(result.verdict, "ALLOW_WITH_DOWNSIZE");
  assert.equal(result.allowed_units, "0.950000000000000000");
  assert.equal(result.gross_exposure_units, "0.050000000000000000");
  assert.equal(result.headroom_units, "0.950000000000000000");
  assert.equal(result.binding_constraint, "dependency_cap");
});

test("evaluateExposurePolicy handles exact cap equality and requests below headroom", () => {
  const exactCap = evaluateExposurePolicy(
    {
      ...GRAPH,
      paths: GRAPH.paths.map((path) => ({
        ...path,
        raw_quantity: path.kind === "direct_holding" ? "1000000000000000000" : "0",
        decimal_quantity: path.kind === "direct_holding" ? "1.000000000000000000" : "0.000000000000000000",
      })),
    },
    CONFIG,
    { ...REQUEST, requested_units: "0.100000000000000000" },
  );
  assert.equal(exactCap.verdict, "DENY");
  assert.equal(exactCap.allowed_units, "0.000000000000000000");
  assert.equal(exactCap.binding_constraint, "dependency_cap");

  const belowHeadroom = evaluateExposurePolicy(
    GRAPH,
    CONFIG,
    { ...REQUEST, requested_units: "0.500000000000000000" },
  );
  assert.equal(belowHeadroom.verdict, "ALLOW");
  assert.equal(belowHeadroom.allowed_units, "0.500000000000000000");
  assert.equal(belowHeadroom.binding_constraint, "none");
});

test("evaluateExposurePolicy denies zero headroom and reacts to changed path quantities", () => {
  const zero = evaluateExposurePolicy(
    {
      ...GRAPH,
      paths: GRAPH.paths.map((path) => ({
        ...path,
        raw_quantity: path.kind === "direct_holding" ? "1000000000000000000" : "0",
        decimal_quantity: path.kind === "direct_holding" ? "1.000000000000000000" : "0.000000000000000000",
      })),
    },
    CONFIG,
    REQUEST,
  );
  assert.equal(zero.verdict, "DENY");
  assert.equal(zero.reason_codes.includes("dependency_cap_reached"), true);

  const changed = evaluateExposurePolicy(
    {
      ...GRAPH,
      paths: GRAPH.paths.map((path) => ({
        ...path,
        raw_quantity: path.kind === "direct_holding" ? "300000000000000000" : "400000000000000000",
        decimal_quantity: path.kind === "direct_holding" ? "0.300000000000000000" : "0.400000000000000000",
      })),
    },
    CONFIG,
    REQUEST,
  );
  assert.equal(changed.gross_exposure_units, "0.700000000000000000");
  assert.equal(changed.allowed_units, "0.300000000000000000");
  assert.equal(changed.verdict, "ALLOW_WITH_DOWNSIZE");
});

test("evaluateExposurePolicy shows debt but never nets it against gross exposure", () => {
  const result = evaluateExposurePolicy(
    GRAPH,
    CONFIG,
    { ...REQUEST, requested_units: "0.950000000000000000" },
  );

  assert.equal(result.verdict, "ALLOW");
  assert.equal(result.allowed_units, "0.950000000000000000");
  assert.equal(result.debt_units, "0.500000000000000000");
});

test("evaluateExposurePolicy denies required source gaps, invalid decimals and missing quantities", () => {
  const sourceGap = evaluateExposurePolicy(
    { ...GRAPH, gaps: ["block_mismatch"] },
    CONFIG,
    REQUEST,
  );
  assert.equal(sourceGap.verdict, "DENY");
  assert.equal(sourceGap.binding_constraint, "source_quality");

  const invalidDecimals = evaluateExposurePolicy(
    {
      ...GRAPH,
      paths: [{ ...GRAPH.paths[0]!, decimals: 6 }, GRAPH.paths[1]!],
    },
    CONFIG,
    REQUEST,
  );
  assert.equal(invalidDecimals.verdict, "DENY");

  const missing = evaluateExposurePolicy({ ...GRAPH, paths: [] }, CONFIG, REQUEST);
  assert.equal(missing.verdict, "DENY");
  assert.equal(missing.reason_codes.includes("missing_exposure_path"), true);
});

test("fixed-point arithmetic rejects negative/overflow input and preserves exact scale", () => {
  assert.equal(parseFixedUnits("0.950000000000000000"), 950000000000000000n);
  assert.equal(formatFixedUnits(950000000000000000n), "0.950000000000000000");
  assert.throws(() => parseFixedUnits("-1.000000000000000000"), /negative_units/);
  assert.throws(() => parseFixedUnits(`1${"0".repeat(100)}`), /units_overflow/);
  assert.throws(() => parseFixedUnits("1.0000000000000000001"), /too_many_decimals/);
});

test("non-contributing receipt representations do not increase gross exposure", () => {
  const receipt = {
    ...GRAPH.paths[1]!,
    id: "path:receipt:aave-wsteth",
    capital_contribution: false,
    raw_quantity: "900000000000000000",
    decimal_quantity: "0.900000000000000000",
  };
  const result = evaluateExposurePolicy({ ...GRAPH, paths: [...GRAPH.paths, receipt] }, CONFIG, REQUEST);
  assert.equal(result.gross_exposure_units, "0.050000000000000000");
});
