# Sentinel Exposure Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Deliver one live, bounded \`wstETH\` exposure workflow in which Graph-backed Aave position evidence and same-block Base RPC reads change the permitted paper purchase amount, bind a demo permit, and are rechecked before execution.

**Architecture:** Keep the existing Position Evidence and judge routes unchanged. Add a narrow exposure service composed of a fixed Graph \`UserReserve\` adapter, a server-selected Base RPC reader, a typed two-path graph builder, exact 18-decimal policy arithmetic, a server-held evaluation store, a unit-based EIP-712 permit, and a paper executor with fresh-condition checks. The browser and restricted tool can request only the supported \`BUY_EXPOSURE/wstETH\` action; account, chain, sources, cap, signer, and execution state stay server-owned.

**Tech Stack:** Node 22+ direct TypeScript/ESM, \`node:http\`, \`node:test\`, \`node:assert/strict\`, \`ethers\` 6.16+, Graph Gateway, Base JSON-RPC, plain HTML/CSS/JavaScript, SVG.

---

## Task 1: Extend the Graph source contract for the qualified case

**Files:**
- Modify: \`api/app/graph-client.ts\`
- Test: \`api/tests/graph-client.test.ts\`
- Modify: \`docs/ethonline-2026/GRAPH_SOURCE_MANIFEST.md\`
- Modify: \`docs/ethonline-2026/DATA_ACCESS.md\`

- [ ] **Step 1: Add a failing fixture assertion for the required Graph fields.**

Extend \`reserveRow()\` in \`api/tests/graph-client.test.ts\` with these public synthetic fields:

~~~ts
reserve: {
  id: "0xreserve1",
  underlyingAsset: "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452",
  symbol: "wstETH",
  name: "Wrapped liquid staked Ether 2.0",
  decimals: 18,
  pool: { pool: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5" },
  aToken: {
    id: "0x99cbc45ea5bb7ef3a5bc08fb1b7e56bb2442ef0d",
    underlyingAssetAddress: "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452",
    underlyingAssetDecimals: 18,
  },
  liquidityIndex: "1000000000000000000000000000",
  price: { priceInEth: "1", priceSource: "0x0", lastUpdateTimestamp: 0 },
},
scaledATokenBalance: "30000000000000000",
~~~

Add one assertion to the existing query test:

~~~ts
assert.match(request.query, /scaledATokenBalance/);
assert.match(request.query, /aToken \{/);
assert.match(request.query, /liquidityIndex/);
~~~

- [ ] **Step 2: Run the focused test and confirm the intended RED failure.**

Run: \`node --test api/tests/graph-client.test.ts\`

Expected: FAIL because the current query does not contain the aToken, pool, or liquidity-index selections and the current normalized type drops them.

- [ ] **Step 3: Implement the minimal typed extension.**

Add the nested Graph response fields and expose them on \`GraphPositionObservation\` without changing old fields:

~~~ts
export type GraphPositionObservation = {
  // existing fields remain unchanged
  scaled_supplied_raw: string | null;
  a_token: { address: string; underlying_asset: string; decimals: number } | null;
  pool_address: string | null;
  supply_index_raw: string | null;
};
~~~

Add \`scaledATokenBalance\`, \`reserve.liquidityIndex\`, \`reserve.aToken { id underlyingAssetAddress underlyingAssetDecimals }\`, and \`reserve.pool { pool }\` to both fixed query documents. Parse signed integer fields with the existing safe parser, validate every address, and add stable gaps \`missing_a_token_relation\`, \`a_token_underlying_mismatch\`, \`missing_pool_address\`, \`missing_scaled_supply\`, and \`missing_supply_index\` when the required candidate data is absent. Do not use \`currentATokenBalance\` as the exact normalized supply amount.

- [ ] **Step 4: Run the focused test and the full baseline suite.**

Run: \`node --test api/tests/graph-client.test.ts\`

Expected: the focused file passes.

Run: \`npm test\`

Expected: all existing tests pass; old Position Evidence output remains compatible apart from the additive observation fields.

- [ ] **Step 5: Update the source notes with only public, sanitized facts.**

Record the verified Graph Explorer label/version, Base chain, the public wstETH/aToken/pool addresses, the Graph field paths, and the fact that \`scaledATokenBalance\` is the input to same-block normalization. Do not record \`GRAPH_DEMO_ACCOUNT\`, live balances, or any credential. Replace stale wording that says no live source was verified with the current source-qualified status, while preserving the explicit USD and oracle gaps.

- [ ] **Step 6: Commit the source-contract milestone.**

~~~sh
git add api/app/graph-client.ts api/tests/graph-client.test.ts \
  docs/ethonline-2026/GRAPH_SOURCE_MANIFEST.md docs/ethonline-2026/DATA_ACCESS.md
git commit -m "feat: expose qualified Graph supply relations"
~~~

## Task 2: Add the server-selected Base RPC reader and exact Aave normalization

**Files:**
- Create: \`api/app/base-rpc.ts\`
- Create: \`api/tests/base-rpc.test.ts\`

- [ ] **Step 1: Write failing tests for selectors, same-block reads, and Ray multiplication.**

Create a fake JSON-RPC transport that returns deterministic results for the block header, ERC-20 \`balanceOf\`, aToken \`scaledBalanceOf\`, \`UNDERLYING_ASSET_ADDRESS\`, \`decimals\`, \`eth_getCode\`, and Aave \`getReserveNormalizedIncome\`. The first test must assert that the adapter returns the exact synthetic values and never calls a user-supplied URL:

~~~ts
test("readBaseWstEthSnapshot validates the same block and contract relation", async () => {
  const result = await readBaseWstEthSnapshot({
    account: ACCOUNT,
    graphBlock: { number: 123, hash: BLOCK_HASH, timestamp: 1788790000 },
    graphObservation: WSTETH_GRAPH_OBSERVATION,
    fetchImpl: fakeRpcFetch,
  });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.snapshot.direct_balance_raw, "20000000000000000");
    assert.equal(result.snapshot.aave_scaled_supply_raw, "30000000000000000");
    assert.equal(result.snapshot.normalized_aave_supply_raw, "30000000000000000");
    assert.equal(result.snapshot.block.hash, BLOCK_HASH);
    assert.equal(result.snapshot.contracts.a_token_underlying_matches, true);
  }
});
~~~

Add separate tests for \`rayMul("1", "500000000000000000000000000") === "1"\`, invalid accounts, unsupported underlying assets, mismatched block hashes, zero contract code, malformed RPC hex, and an RPC error. Every failure must return a non-authorizing result with a stable reason and no provider message.

- [ ] **Step 2: Run the new file and confirm RED.**

Run: \`node --test api/tests/base-rpc.test.ts\`

Expected: FAIL because \`api/app/base-rpc.ts\` does not exist.

- [ ] **Step 3: Implement the bounded adapter.**

Use these public interfaces:

~~~ts
export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_MAINNET_RPC_URL = "https://mainnet.base.org";
export const BASE_WSTETH_ADDRESS = "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452";

export type BaseWstEthSnapshot = {
  block: { number: number; hash: string; timestamp: number };
  contracts: {
    underlying: string;
    a_token: string;
    pool: string;
    a_token_underlying_matches: boolean;
    decimals_match: boolean;
  };
  direct_balance_raw: string;
  aave_scaled_supply_raw: string;
  normalized_income_raw: string;
  normalized_aave_supply_raw: string;
  aave_balance_raw: string;
  gaps: string[];
};

export async function readBaseWstEthSnapshot(options: {
  account: string;
  graphBlock: { number: number; hash: string; timestamp: number };
  graphObservation: GraphPositionObservation;
  fetchImpl?: RpcFetchLike;
  timeoutMs?: number;
}): Promise<BaseWstEthResult>;
~~~

Use the fixed Base host by default and accept an operator-supplied \`BASE_RPC_URL\` only as an HTTPS server-side endpoint with no URL userinfo or fragment. Expose only its origin in sanitized metadata, verify custom endpoints return Base Mainnet chain ID \`8453\`, and reject invalid configuration before network access. Classify HTTP/JSON-RPC rate limits as \`rpc_rate_limited\` without provider text. Keep the request budget bounded (eight calls for the default endpoint, one additional chain-ID call for a custom endpoint). Encode selectors with \`ethers.id\`, decode only bounded \`uint256\`, \`address\`, block header, and bytecode responses, and use the Graph block number as the \`eth_call\` block tag. Verify Graph/RPC block number, hash and timestamp, \`aToken.UNDERLYING_ASSET_ADDRESS()\`, aToken decimals, and non-empty code. Compute normalized supply with Aave's exact Ray multiplication: \`(scaled * normalizedIncome + 5e26) / 1e27\`.

- [ ] **Step 4: Run the RED/GREEN cycle and regression suite.**

Run: \`node --test api/tests/base-rpc.test.ts\`

Expected: all new RPC tests pass.

Run: \`npm test\`

Expected: all tests pass with no warnings.

- [ ] **Step 5: Commit the RPC milestone.**

~~~sh
git add api/app/base-rpc.ts api/tests/base-rpc.test.ts
git commit -m "feat: validate same-block Base exposure reads"
~~~

## Task 3: Define the typed exposure graph and deterministic graph builder

**Files:**
- Create: \`shared/schemas/exposure-graph.ts\`
- Create: \`api/app/exposure-graph.ts\`
- Create: \`api/tests/exposure-graph.test.ts\`

- [ ] **Step 1: Write failing graph tests before implementation.**

Cover the two real paths with synthetic values and provenance:

~~~ts
test("buildExposureGraph converges direct and Aave paths on one asset", () => {
  const graph = buildExposureGraph({ graph: WSTETH_GRAPH_EVIDENCE, rpc: WSTETH_RPC_SNAPSHOT });
  assert.equal(graph.status, "ok");
  if (graph.status === "ok") {
    assert.equal(graph.graph.nodes.filter((node) => node.type === "asset").length, 1);
    assert.equal(graph.graph.paths.length, 2);
    assert.deepEqual(new Set(graph.graph.paths.map((path) => path.unit)), new Set(["wstETH"]));
    assert.equal(graph.graph.edges.every((edge) => edge.provenance.block_number === 123), true);
  }
});
~~~

Add tests that reject a block mismatch, a non-Base/non-wstETH candidate, duplicate path IDs, malformed raw quantities, and a claim whose aToken points to another underlying. Add a fixture with both a receipt claim and its underlying claim and assert the graph marks the receipt as a representation of the same economic path rather than adding a second capital contribution.

- [ ] **Step 2: Run the focused tests and confirm RED.**

Run: \`node --test api/tests/exposure-graph.test.ts\`

Expected: FAIL because the new schema and builder do not exist.

- [ ] **Step 3: Add versioned graph contracts.**

Define English public types for \`ExposureGraphV1\`, \`ExposureNode\`, \`ExposureEdge\`, \`ExposurePath\`, \`ExposureProvenance\`, \`ExposureRequest\`, \`ExposurePolicyConfig\`, \`ExposureEvaluation\`, and the unit-based permit payload. Use decimal strings only in JSON and preserve raw strings plus \`decimals\` in quantitative evidence. Include \`mode: "live" | "fixture" | "replay"\`, \`source_status\`, \`gaps\`, and the source block in the top-level contract.

- [ ] **Step 4: Implement the deterministic builder.**

Create stable IDs from lowercase addresses and fixed relation names. Build \`account\`, direct \`holding\`, Aave \`protocol_position\`, wstETH \`asset\`, and Aave \`protocol\` nodes. Build \`holds\`, \`supplied_claim_on\`, and \`uses_pool\` \`ExposureEdge\` values with source fields/contract methods, chain/deployment, block, transformation, raw quantity, decimal quantity, and unit. Preserve separate gross debt observations without subtracting them. Return a sanitized failure when any required relation or quantitative edge is missing.

- [ ] **Step 5: Run focused tests, all tests, and commit.**

~~~sh
node --test api/tests/exposure-graph.test.ts
npm test
git add shared/schemas/exposure-graph.ts api/app/exposure-graph.ts api/tests/exposure-graph.test.ts
git commit -m "feat: build attributable wstETH exposure graph"
~~~

Expected: both test commands pass and the commit contains no live account or balance fixture.

## Task 4: Implement exact unit policy and validated request boundary

**Files:**
- Create: \`api/app/exposure-policy.ts\`
- Create: \`api/app/exposure-request.ts\`
- Create: \`api/tests/exposure-policy.test.ts\`
- Create: \`api/tests/exposure-request.test.ts\`

- [ ] **Step 1: Write the failing arithmetic and validation tests.**

Use fixed 18-decimal synthetic quantities:

~~~ts
test("evaluateExposurePolicy downsizes to remaining dependency headroom", () => {
  const result = evaluateExposurePolicy(WSTETH_GRAPH, {
    policy_version: "exposure-wsteth-v1",
    dependency_cap_units: "1.000000000000000000",
  }, {
    schema_version: "sentinel-exposure-buy.v1",
    action: "BUY_EXPOSURE",
    asset: "wstETH",
    unit: "wstETH",
    requested_units: "2.000000000000000000",
  });

  assert.equal(result.verdict, "ALLOW_WITH_DOWNSIZE");
  assert.equal(result.allowed_units, "0.950000000000000000");
  assert.equal(result.binding_constraint, "dependency_cap");
});
~~~

Add tests for exact cap equality, request below headroom, zero headroom, changed direct or Aave quantities, invalid decimals, negative/overflow input, missing required source, debt shown but not netted, and duplicate receipt/underlying representation. Request tests must reject unknown fields, arbitrary asset/account/chain/URL, wrong action/unit, empty or too-precise amount, and amounts above the configured maximum request size.

- [ ] **Step 2: Run focused tests and confirm RED.**

Run: \`node --test api/tests/exposure-policy.test.ts api/tests/exposure-request.test.ts\`

Expected: FAIL because the new modules are absent.

- [ ] **Step 3: Implement fixed-point arithmetic and request validation.**

Use \`BigInt\` at 18 decimals. Implement these signatures:

~~~ts
export function parseFixedUnits(value: string, decimals = 18): bigint;
export function formatFixedUnits(value: bigint, decimals = 18): string;
export function evaluateExposurePolicy(
  graph: ExposureGraphV1,
  config: ExposurePolicyConfig,
  request: ExposureRequest,
): ExposurePolicyDecision;
export function validateExposureRequest(input: unknown): ExposureRequestValidation;
~~~

Calculate gross exposure from the two attributed economic paths, cap minus gross exposure with a floor at zero, and the minimum of request/headroom. Use \`DENY\` for missing or non-authorizing source gaps; never substitute zero for a missing quantity. \`validateExposureRequest\` accepts only the exact v1 fields and the fixed \`wstETH\`/Base action.

- [ ] **Step 4: Run focused tests, regression, and commit.**

~~~sh
node --test api/tests/exposure-policy.test.ts api/tests/exposure-request.test.ts
npm test
git add api/app/exposure-policy.ts api/app/exposure-request.ts \
  api/tests/exposure-policy.test.ts api/tests/exposure-request.test.ts
git commit -m "feat: calculate bounded exposure purchase amounts"
~~~

## Task 5: Add the evaluation service and server-owned state

**Files:**
- Create: \`api/app/exposure-service.ts\`
- Create: \`api/tests/exposure-service.test.ts\`
- Modify: \`api/app/server.ts\`

- [ ] **Step 1: Write failing service tests for live composition and state boundaries.**

Test that the service calls the Graph adapter, then the RPC adapter at the Graph block, then the graph builder and policy; a Graph/RPC failure must return \`DENY\` without a permit. Test the default policy cap is \`1.000000000000000000 wstETH\`, the evaluation store returns a random opaque reference, references expire, and a browser-supplied evidence hash is ignored.

- [ ] **Step 2: Run the focused service tests and confirm RED.**

Run: \`node --test api/tests/exposure-service.test.ts\`

Expected: FAIL because the service and server state do not exist.

- [ ] **Step 3: Implement the service and bounded in-memory store.**

Use these boundaries:

~~~ts
export const DEFAULT_EXPOSURE_POLICY: ExposurePolicyConfig = {
  policy_version: "exposure-wsteth-v1",
  dependency_cap_units: "1.000000000000000000",
  unit: "wstETH",
};

export type ExposureRuntimeState = {
  evaluations: Map<string, StoredExposureEvaluation>;
  consumed_nonces: Set<string>;
  pending_accounts: Set<string>;
};

export async function evaluateExposureRequest(
  request: ExposureRequest,
  dependencies: ExposureServiceDependencies,
): Promise<ExposureEvaluationResponse>;
~~~

Read the configured account/Graph settings from the server environment, never from the request. Use an allowlisted Graph observation and the server-selected Base RPC adapter, build the graph, run policy, store only authorizing or inspectable results under a short TTL, and return \`live\`/\`fixture\` mode explicitly. Do not store or return the API key or raw RPC URL.

- [ ] **Step 4: Run focused tests and regression.**

Run: \`node --test api/tests/exposure-service.test.ts && npm test\`

Expected: all tests pass.

- [ ] **Step 5: Commit the service milestone.**

~~~sh
git add api/app/exposure-service.ts api/tests/exposure-service.test.ts api/app/server.ts
git commit -m "feat: add server-owned exposure evaluations"
~~~

## Task 6: Implement unit-based EIP-712 permits and fresh condition checks

**Files:**
- Create: \`api/app/exposure-permit.ts\`
- Create: \`api/app/condition-check.ts\`
- Create: \`api/tests/exposure-permit.test.ts\`
- Create: \`api/tests/condition-check.test.ts\`

- [ ] **Step 1: Write failing permit and executor-condition tests.**

Cover all bindings and state transitions:

~~~ts
test("verifyExposurePermit is pure and does not consume a nonce", () => {
  const issued = issueExposurePermit(AUTHORIZED_EVALUATION, { nonce: "7" });
  assert.equal(issued.status, "issued");
  const first = verifyExposurePermit({ ...REQUEST, permit: issued.permit });
  const second = verifyExposurePermit({ ...REQUEST, permit: issued.permit });
  assert.equal(first.valid, true);
  assert.equal(second.valid, true);
});

test("condition check blocks a valid old signature when current headroom falls", () => {
  const result = checkExposurePermitConditions(PERMIT, CURRENT_EVALUATION_WITH_NO_HEADROOM);
  assert.equal(result.executable, false);
  assert.equal(result.code, "CURRENT_HEADROOM_INSUFFICIENT");
});
~~~

Add tests for changed action/asset/account/chain/cap/policy version, graph hash binding, amount over authorization, expired/not-yet-active permit, untrusted signer, malformed typed data, pure verification, one-time consume, same-account concurrent reservation, unrelated source block/hash change, and required source failure.

- [ ] **Step 2: Run focused tests and confirm RED.**

Run: \`node --test api/tests/exposure-permit.test.ts api/tests/condition-check.test.ts\`

Expected: FAIL because the new permit and condition modules do not exist.

- [ ] **Step 3: Implement the EIP-712 unit permit.**

Define \`sentinel-exposure-permit.v1\` payload fields for action, asset, unit, subject chain/account, authorized units, operator cap, policy version, graph/evidence hash, snapshot block, issued/expiry times, nonce, and audience. Use a separate clearly labeled demo domain or a shared signer helper; never use a funded wallet key. \`issueExposurePermit\` accepts only a stored \`ExposureEvaluation\` with an authorizing decision. \`verifyExposurePermit\` recomputes the request and graph bindings and returns checks without touching the nonce store.

- [ ] **Step 4: Implement condition checks and atomic demo state transitions.**

\`checkExposurePermitConditions\` compares relevant predicates and allows source metadata/block changes when the action, cap, unit, and current headroom remain valid. \`executeExposurePermit\` reserves the account before its async refresh, refreshes Graph+RPC, calls the condition checker, adds the nonce only after a successful result, and releases the account reservation on every denial or error. It must return \`NONCE_ALREADY_USED\` and \`ACCOUNT_ACTION_PENDING\` without consuming anything.

- [ ] **Step 5: Run focused tests, regression, and commit.**

~~~sh
node --test api/tests/exposure-permit.test.ts api/tests/condition-check.test.ts
npm test
git add api/app/exposure-permit.ts api/app/condition-check.ts \
  api/tests/exposure-permit.test.ts api/tests/condition-check.test.ts
git commit -m "feat: bind exposure permits to fresh conditions"
~~~

## Task 7: Add exposure routes, bounded bodies, and explicit replay

**Files:**
- Modify: \`api/app/server.ts\`
- Create: \`api/tests/exposure-routes.test.ts\`
- Modify: \`api/tests/server.test.ts\`

- [ ] **Step 1: Write failing route tests.**

Add tests for:

~~~ts
test("POST /api/exposure/evaluate accepts a request and returns a live graph decision", async () => {
  const response = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/evaluate",
    JSON.stringify(EXPOSURE_REQUEST),
    { exposureDependencies: SYNTHETIC_LIVE_DEPENDENCIES },
  );
  assert.equal(response.statusCode, 200);
  assert.equal((response.payload as any).policy.verdict, "ALLOW_WITH_DOWNSIZE");
  assert.equal((response.payload as any).graph.mode, "live");
});
~~~

Also test invalid/oversized JSON, blocked Graph/RPC configuration, permit issuance with an unknown/expired evaluation reference, pure verify without nonce consumption, paper execute with a refreshed denial, successful nonce consumption, replay mode labeled \`replay\`, arbitrary URL/account/policy rejection, and all old \`/judge\`/\`/api/demo/*\` regression routes.

- [ ] **Step 2: Run focused route tests and confirm RED.**

Run: \`node --test api/tests/exposure-routes.test.ts api/tests/server.test.ts\`

Expected: the exposure route tests fail with 404 while the old server tests continue to pass.

- [ ] **Step 3: Implement the routes and state wiring.**

Add static \`/exposure-graph\`, \`GET /api/exposure/config\`, and the four evaluate/permit/verify/paper-execute routes. Add a local replay route or explicit replay mode that derives a synthetic exhausted-headroom fixture from the stored evaluation and returns \`mode: "replay"\`; it must never call the live provider or present the result as current evidence.

Change \`readRawBody\` to stop reading after \`64 * 1024\` bytes and return a stable \`request_body_too_large\` error. Keep provider diagnostics out of responses, and clear all route errors to non-authorizing decisions.

- [ ] **Step 4: Run focused tests and full regression.**

~~~sh
node --test api/tests/exposure-routes.test.ts api/tests/server.test.ts
npm test
~~~

Expected: all route and regression tests pass.

- [ ] **Step 5: Commit the route milestone.**

~~~sh
git add api/app/server.ts api/tests/exposure-routes.test.ts api/tests/server.test.ts
git commit -m "feat: expose condition-checked paper execution routes"
~~~

## Task 8: Replace scenario-only exposure tooling with a validated purchase tool

**Files:**
- Create: \`api/app/exposure-tool.ts\`
- Create: \`scripts/exposure-tool.ts\`
- Create: \`api/tests/exposure-tool.test.ts\`
- Modify: \`docs/ethonline-2026/AI_TOOL.md\`

- [ ] **Step 1: Write failing tool tests.**

The accepted input is exactly:

~~~json
{
  "schema_version": "sentinel-exposure-buy.v1",
  "action": "BUY_EXPOSURE",
  "asset": "wstETH",
  "unit": "wstETH",
  "requested_units": "2.000000000000000000"
}
~~~

Test that the tool returns the validated request, fixed Graph/RPC plan, source-derived graph, policy and an opaque evaluation reference; reject unknown fields, scenario names, custom account/chain/URL, policy overrides and amounts with invalid scale. Keep the existing scenario tool as a compatibility regression path, but do not use it for the new demo claim.

- [ ] **Step 2: Run the focused test and confirm RED.**

Run: \`node --test api/tests/exposure-tool.test.ts\`

Expected: FAIL because the new tool module/script do not exist.

- [ ] **Step 3: Implement the restricted tool and CLI.**

Export a schema-described \`sentinel_exposure_graph\` definition with \`readOnly: true\` and the exact request schema. Route execution through the same evaluation service; do not duplicate GraphQL, RPC, policy or signing logic. The CLI accepts one JSON object on stdin, prints sanitized JSON, and exits with status \`2\` on a blocked/non-authorizing result.

- [ ] **Step 4: Run tool tests, describe the schema, and commit.**

~~~sh
node --test api/tests/exposure-tool.test.ts
npm run --silent exposure:tool -- --describe
npm test
git add api/app/exposure-tool.ts scripts/exposure-tool.ts api/tests/exposure-tool.test.ts \
  docs/ethonline-2026/AI_TOOL.md package.json
git commit -m "feat: add validated exposure graph tool"
~~~

The documentation must explicitly say that a local CLI invocation is not evidence of a genuine external model/MCP trace until a configured client performs the natural-language request.

## Task 9: Build the judge-readable exposure graph screen

**Files:**
- Create: \`web/exposure-graph.html\`
- Create: \`web/exposure-graph.js\`
- Modify: \`web/styles.css\`
- Modify: \`api/app/server.ts\`
- Create: \`api/tests/exposure-ui.test.ts\`

- [ ] **Step 1: Write failing static/UI contract tests.**

Assert that the new HTML contains request/operator, graph, decision, permit, execution and replay regions; the JavaScript contains no Graph/RPC credential or arbitrary provider URL; and \`/exposure-graph\` is served with the expected title. Keep the layout narrow and readable without a framework.

- [ ] **Step 2: Run the focused test and confirm RED.**

Run: \`node --test api/tests/exposure-ui.test.ts\`

Expected: FAIL because the new screen and route do not exist.

- [ ] **Step 3: Implement the screen.**

Render default request \`2.000000000000000000 wstETH\` and the server-returned operator cap as read-only configuration. Submit only the validated request. Render a deterministic inline SVG with account → direct holding → wstETH and account → Aave position → wstETH paths. Clicking either path must reveal its source field/contract read, block, units, transformation, and gap state.

Render requested, current gross, cap, headroom, allowed, and binding reason using the server response. Add explicit badges \`LIVE\`, \`REPLAY\`, \`DEMO SIGNER\`, and \`PAPER EXECUTOR\`; clear prior decision/permit state on any failed refresh.

- [ ] **Step 4: Run static tests, then perform a real browser smoke.**

Run: \`node --test api/tests/exposure-ui.test.ts\`

Start: \`npm start\`

Open \`http://127.0.0.1:8787/exposure-graph\` in a real browser and verify the complete configured flow at narrow width: evaluate, inspect both paths, issue, verify, paper-execute, and run the labeled replay. Capture only a sanitized screenshot if it is needed; do not capture the configured account or balances.

- [ ] **Step 5: Commit the UI milestone.**

~~~sh
git add web/exposure-graph.html web/exposure-graph.js web/styles.css \
  api/app/server.ts api/tests/exposure-ui.test.ts
git commit -m "feat: add readable exposure graph demo"
~~~

## Task 10: Reconcile public documentation and continuity ledger

**Files:**
- Modify: \`START_HERE.md\`
- Modify: \`CONTINUITY.md\`
- Modify: \`AI_ATTRIBUTION.md\`
- Modify: \`docs/ethonline-2026/STATUS.md\`
- Modify: \`docs/ethonline-2026/SPEC.md\`
- Modify: \`docs/ethonline-2026/PLAN.md\`
- Modify: \`docs/ethonline-2026/ROUTES.md\`
- Modify: \`docs/ethonline-2026/DEMO.md\`
- Modify: \`docs/ethonline-2026/STRATEGY.md\`
- Modify: \`README.md\`

- [ ] **Step 1: Replace proposed/obsolete statements with evidence labels.**

Mark the narrow wstETH source case and implemented routes as \`FACT\` only after the live and local checks below pass. Keep USD valuation, external AI invocation, durable state, deployment, and public account selection as \`UNKNOWN\` or explicit limitations until independently evidenced. State that Graph is load-bearing because removing the Graph UserReserve row makes the derived authorization unavailable; RPC is a validation/normalization source, not a decorative query.

- [ ] **Step 2: Update continuity and AI attribution with exact file paths.**

List the new source adapter, schemas, graph/policy/permit/executor modules, tests, UI, and docs as September 7 AI-assisted work. Do not claim founder review, external model invocation, deployment, submission, adoption, or prize outcome without evidence.

- [ ] **Step 3: Run documentation checks and commit.**

~~~sh
npm test
git diff --check
git add START_HERE.md CONTINUITY.md AI_ATTRIBUTION.md README.md docs/ethonline-2026
git commit -m "docs: document exposure graph boundaries"
~~~

## Task 11: Fresh verification, live acceptance, and release checkpoint

**Files:**
- No production code changes unless a verification failure requires a TDD fix.
- Read-only outputs: \`/private/tmp\` summaries only; never commit live account data.

- [ ] **Step 1: Run the complete local verification suite.**

~~~sh
npm test
git diff --check
npm audit --json > /private/tmp/sentinel-exposure-audit.json
~~~

Read the audit summary without copying tokens or unrelated local data. Record the current locked dependency findings, not stale earlier severity claims.

- [ ] **Step 2: Run the live source and positive bounded case.**

~~~sh
node --env-file=.env.local scripts/graph-preflight.ts
node --env-file=.env.local scripts/exposure-tool.ts <<'JSON'
{"schema_version":"sentinel-exposure-buy.v1","action":"BUY_EXPOSURE","asset":"wstETH","unit":"wstETH","requested_units":"2.000000000000000000"}
JSON
~~~

Summarize only status, Graph block freshness, path count, policy verdict, requested/allowed unit labels, and reason codes. Do not print the full live portfolio, configured account, or Graph key. Confirm the live result is positive/limited and attributable, not a synthetic fixture.

- [ ] **Step 3: Run the ablation and changed-condition checks.**

Run the service tests with the required Graph row removed and confirm the result is non-authorizing. Run the paper executor with a valid old permit and the replay/current-headroom condition; confirm pure signature verification is still valid while execution is denied. Run the unchanged-headroom case and confirm an unrelated block/hash change does not spuriously deny.

- [ ] **Step 4: Review the public diff and repository state.**

~~~sh
git status --short
git diff --stat HEAD~1..HEAD
git log --oneline --decorate -12
rg -n "GRAPH_API_KEY|PRIVATE_KEY|seed phrase|GRAPH_DEMO_ACCOUNT|0x[a-fA-F0-9]{40}" \
  START_HERE.md CONTINUITY.md AI_ATTRIBUTION.md docs web shared api scripts \
  -g '*.md' -g '*.ts' -g '*.js' -g '*.html'
~~~

Treat any credential, local account, raw live amount, or private Vartovii reference as a blocking hygiene defect. Existing public contract addresses are allowed; local \`.env.local\` must remain ignored.

- [ ] **Step 5: Commit only after fresh evidence and stop at the approval gate.**

Create a final local verification commit only if the previous commits did not already contain all documentation/status updates. Do not push, deploy, submit, send messages, or perform wallet actions. Report local tests, live checks, remote CI, and deployed behavior as separate states.

## Plan self-review

- Source qualification is represented in Tasks 1–2 and keeps the USD gap explicit.
- Graph, accounting, request validation, permit, executor, route, tool, UI, and public documentation requirements each have an owned task and tests.
- Existing judge/operator routes remain regression-covered throughout.
- No task accepts arbitrary model URLs, account subjects, policy objects, evidence hashes, private keys, or live portfolio fixtures.
- The external AI/MCP claim is deliberately a separate gate rather than being inferred from the restricted CLI tool.
