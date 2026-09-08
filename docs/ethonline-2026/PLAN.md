# Implementation plan — Sentinel Exposure Graph

Design: [SPEC.md](SPEC.md). Dates use Europe/Zurich. Checked items below are
implemented locally and must remain backed by tests or sanitized live evidence;
unchecked items are not claims of completion.

## 0. Preparation — September 5

- [x] Isolate the public upstream clone and preserve its history.
- [x] Create `ethonline-2026/position-evidence`.
- [x] Record continuity, source-selection, strategy and attribution documents.
- [ ] Founder creates or submits any portal project. Local setup is not portal
  submission.

## 1. Qualify one real source case — September 7

- [x] Verify the configured Aave V3 Base deployment, schema and `UserReserve`
  relation through The Graph.
- [x] Verify indexed block metadata, complete bounded pagination and explicit
  valuation/oracle gaps.
- [x] Verify the narrow wstETH case with same-block Base RPC reads: direct
  balance, aToken relation, decimals, Graph scaled supply and normalized
  Aave supply.
- [x] Record the sanitized result in
  [GRAPH_SOURCE_MANIFEST.md](GRAPH_SOURCE_MANIFEST.md).
- [x] Keep USD valuation unqualified and use explicit wstETH units instead.

Exit evidence: the Graph position relation is load-bearing and the supported
case is narrow enough for a bounded token-unit policy. A later public-RPC
rate-limit response remains a provider-availability limitation, not permission
to use a stale or synthetic live result.

## 2. Graph and deterministic accounting — September 7

- [x] Extend the Graph adapter with scaled supply, aToken and pool relations.
- [x] Add server-owned Base RPC configuration, Base chain validation and
  Ray-normalized supply reads with sanitized rate-limit failures.
- [x] Add `exposure_graph.v1` nodes, edges, paths, provenance, gaps and hash.
- [x] Count direct and Aave paths once on one wstETH asset; keep debt separate.
- [x] Add exact fixed-point policy arithmetic and cap/headroom reason codes.
- [x] Reject missing Graph/RPC identity, incomplete paths and malformed data.

## 3. Request, permit and execution boundary — September 7

- [x] Validate only the versioned `BUY_EXPOSURE` wstETH request, bounded to
  `10.000000000000000000` units.
- [x] Keep account, chain, provider, cap and policy server-owned.
- [x] Issue a demo-only EIP-712 permit from a stored non-denied evaluation.
- [x] Verify exact request, graph hash, subject, cap, policy, expiry, amount,
  audience, signer and nonce bindings without consuming state.
- [x] Refresh conditions at the paper executor and consume a nonce once.
- [x] Reject concurrent account actions, stale source and insufficient current
  headroom; document process-restart semantics.

## 4. Tool, routes and screen — September 7

- [x] Add `/api/exposure/evaluate`, `/permit`, `/verify`, `/paper-execute` and
  `/replay` with bounded bodies and sanitized failures.
- [x] Add `sentinel_exposure_graph` as a read-only exact-schema local tool.
- [x] Keep the older scenario-based position-evidence tool available only as
  compatibility infrastructure.
- [x] Add `/exposure-graph` with request/operator, dependency graph, decision,
  permit, paper executor and replay areas.
- [x] Make path provenance clickable and label `LIVE`, `FIXTURE`, `REPLAY`,
  `DEMO SIGNER` and `PAPER EXECUTOR` clearly.
- [x] Clear stale browser state after failed refresh and avoid credentials or
  arbitrary provider URLs in browser code.
- [x] Run a narrow synthetic browser rehearsal through the complete flow.

## 5. Genuine AI boundary — not yet evidenced

- [x] Add a bounded optional provider-selectable Responses client around the
  existing `sentinel_exposure_graph` contract without adding an SDK or
  execution path.
- [ ] Configure an existing external AI client or MCP integration, if useful,
  without installing a broad platform or exposing credentials.
- [ ] Capture the actual natural-language request, model-selected tool call,
  validated arguments, source-derived result and explanation.
- [ ] Keep the local CLI and schema description clearly separate from this
  external integration claim.

The first bounded external attempt used the configured `gpt-5` model setting
and returned sanitized HTTP `429` before a model-selected tool call. The local
OpenRouter path was then exercised once with `google/gemini-3.8-flash`, but the
model returned no tool call. Both results are recorded as provider-side
attempts, not as natural-language/tool acceptance evidence; no automatic retry
is permitted.

## 6. Freeze and founder review

- [x] Reconcile public docs, continuity and AI attribution with actual files,
  commits, tests and known limitations.
- [x] Refresh a provider-available live browser evaluation and permit run and
  record only sanitized acceptance fields. Run one bounded live HTTP paper
  execution and verify same-permit nonce rejection; repeatability remains an
  explicit limitation.
- [ ] Review the exact wstETH-unit cap, supported action and live outputs in the
  founder's own voice.
- [ ] Review current dependency advisories before proposing deployment.
- [ ] Produce video, screenshots and submission copy only after matching them
  to observed behavior.
- [ ] Founder separately approves any push, deployment, portal submission or
  wallet action.

## Verification commands

```sh
npm test
git diff --check
npm audit --json > /private/tmp/sentinel-exposure-audit.json
node --env-file=.env.local scripts/graph-preflight.ts
node --env-file=.env.local scripts/exposure-tool.ts <<'JSON'
{"schema_version":"sentinel-exposure-buy.v1","action":"BUY_EXPOSURE","asset":"wstETH","unit":"wstETH","requested_units":"2.000000000000000000"}
JSON
```

Summarize live outputs without printing account identifiers, raw portfolio
data, credentials or provider response text. Keep local tests, remote CI and
deployed behavior as separate evidence categories. Pushing remains approval
gated.
