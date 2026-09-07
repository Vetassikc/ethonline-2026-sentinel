# Status — September 7, 2026

## FACT — verified now

- The public repository is isolated on `ethonline-2026/position-evidence`; the
  historical upstream tree was not rewritten and no push was performed in
  this work session.
- The configured The Graph source passed a read-only `_meta` preflight with
  fresh indexed metadata and no indexing errors during the recorded check.
- A bounded live account query returned a complete page containing the
  qualified wstETH observation. The committed manifest stores no account,
  balance or credential.
- One same-block Base read verified the wstETH direct balance, Aave aToken
  relation, decimals, Graph scaled supply and normalized Aave supply path.
  The adapter uses `scaledATokenBalance` plus
  `getReserveNormalizedIncome`/Ray multiplication; it does not treat the
  indexed `currentATokenBalance` as an exact normalized amount.
- The Graph `UserReserve` relation is load-bearing. Missing Graph evidence or
  a Graph/RPC identity failure produces no evaluation reference and a
  non-authorizing `DENY`; RPC is validation/normalization, not a decorative
  second query.
- `sentinel_exposure_graph` accepts one exact bounded purchase shape:
  `BUY_EXPOSURE`, `wstETH`, fixed-point wstETH units and a maximum request of
  `10.000000000000000000`.
- The policy computes exact wstETH-unit gross exposure from direct and Aave
  paths, keeps debt separate, and returns `ALLOW`, `ALLOW_WITH_DOWNSIZE` or
  `DENY`. The default dependency cap is
  `1.000000000000000000 wstETH` and is server-owned.
- Permit issuance, independent verification, fresh-condition checks and
  one-use paper execution are implemented behind bounded server routes. State
  is in memory and expires; durable authorization is not claimed.
- `GET /exposure-graph` renders the graph, provenance, decision, demo permit,
  paper executor and labeled replay. A synthetic browser rehearsal completed
  the full flow at narrow width; it is explicitly `FIXTURE`/`REPLAY`, not live
  portfolio evidence.
- `npm test` passes `160` tests with zero failures, skips or todos. The UI
  contract test passes `3/3`; JavaScript syntax and `git diff --check` pass.

## FACT — known source limitation

Fresh live acceptance on September 7: Graph preflight returned `status: ok`
at indexed block `51004968`, indexed age `2` seconds and
`hasIndexingErrors: false`. The exact exposure-tool request then returned CLI
exit `2`, `DENY`, no evaluation reference and reason `rpc_rpc_http_error`.
One 15-second cooldown retry returned the same sanitized result.

The sampled public Base RPC endpoint returned HTTP `429`/`over rate limit`
during a later repeated live-browser probe. The adapter returned a blocked,
non-authorizing result instead of reusing an old success or silently switching
to a fixture. The request-budget regression remains covered locally. A fresh
provider-available live browser positive flow is therefore not claimed by this
status file.

## UNKNOWN or explicitly not delivered

- The Graph deployment is not qualified for USD valuation. Its `priceInEth`
  and the sampled stale oracle timestamp do not justify a USD risk model.
- No public demo account is frozen in the repository. The configured account
  remains operator-owned local configuration.
- No genuine external natural-language AI/MCP invocation has been exercised.
  The local restricted CLI is a tool contract and regression boundary, not
  evidence of model selection or MCP connectivity.
- Evaluation references, pending-account locks and consumed nonces are
  process-local in-memory state and disappear on restart.
- No production deployment, wallet transaction, live trade, portal
  submission, outbound message, adoption, partnership, revenue, audit,
  security assurance or prize outcome is claimed.
- Founder review of policy choices, live output, demo narration and media is
  still required.

## Current dependency audit

`npm audit --json` on September 7 reported two affected locked dependency
entries: `ethers` (moderate via `ws`) and `ws` (high, including uninitialized
memory disclosure and memory-exhaustion DoS advisories). This is a dependency
review item, not proof of an exploitable application path. No forced upgrade or
dependency mutation was performed.

## Next bounded actions

1. Refresh the live source/tool run once the fixed public RPC budget is
   available, recording only sanitized status, block, path count and policy
   fields.
2. If desired, configure and record a genuine external AI/tool trace without
   granting the model control of account, policy, URLs, signing or execution.
3. Founder reviews this narrow action policy and decides whether further
   reproduction/media work is worth the remaining event scope.

## Authority boundary

Local implementation and verification are complete for the committed slice.
Public push, paid services, account changes, deployment, portal submission and
wallet actions remain separate founder decisions. This file reports local
facts and bounded unknowns, not release readiness or sponsor qualification.
