# Status — September 8, 2026

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
- Base RPC configuration is server-owned. The default public endpoint is
  `https://mainnet.base.org`; an operator may set an ignored local
  `BASE_RPC_URL` override, which must be HTTPS and is chain-checked as `8453`.
  Sanitized metadata exposes only its origin, never a credential-bearing
  path/query.
- A configured HTTPS Base RPC override at `https://base-rpc.publicnode.com`
  passed the server configuration check and returned chain ID `8453`. A fresh
  Graph preflight at `2026-09-07T20:43:26Z` returned block `51012228`, indexed
  age `3` seconds and no indexing errors.
- Permit issuance, independent verification, fresh-condition checks and
  one-use paper execution are implemented behind bounded server routes. State
  is in memory and expires; durable authorization is not claimed.
- `GET /exposure-graph` renders the graph, provenance, decision, demo permit,
  paper executor and labeled replay. A synthetic browser rehearsal completed
  the full flow at narrow width; it is explicitly `FIXTURE`/`REPLAY`, not live
  portfolio evidence.
- `npm test` passes `172` tests with zero failures, skips or todos. The UI
  contract test passes `3/3`; JavaScript syntax and `git diff --check` pass.
- The smallest external-client path is implemented locally as a native-fetch
  provider-selectable Responses wrapper around `sentinel_exposure_graph`; the
  focused provider tests pass `5/5`. It is bounded to two AI requests, one
  read-only local tool call and no signing or execution route.

## FACT — bounded diagnosis and live paper gate

The default public Base RPC still returned the sanitized `rpc_rate_limited`
category during the earlier refresh. With the configured HTTPS override, the
exact exposure-tool request returned `status: 200`, `LIVE`, two attributable
paths and `ALLOW_WITH_DOWNSIZE` for the `2.000000000000000000 wstETH` request;
the recorded allowed amount was approximately
`0.999987494274097461 wstETH`.

A fresh browser evaluation then rendered the live Graph/RPC same-block graph,
and direct/Aave path inspection showed the shared wstETH dependency. The
browser issued and independently verified a demo permit successfully. A
second browser request for `0.500000000000000000 wstETH` returned `ALLOW`, and
its permit verification passed all executable checks. The cooperating paper
executor deliberately remained fail-closed during fresh refreshes: the first
permit returned `CURRENT_HEADROOM_INSUFFICIENT`, and the second returned
`CURRENT_SOURCE_UNAVAILABLE` with HTTP `409`. No live transaction was sent.

The live evaluation and permit gates were refreshed. One bounded HTTP route
run then recorded a successful paper-executor path: a fresh
`0.500000000000000000 wstETH` request returned
`ALLOW`, a new permit verified with all executable checks, the first paper
execution returned `PAPER_EXECUTED`, and a second execution of that same permit
returned `NONCE_ALREADY_USED` with HTTP `409`. This remained paper-only; no
wallet transaction was sent.

The two earlier denial codes were diagnosed separately. For
`CURRENT_HEADROOM_INSUFFICIENT`, the local diagnostic compared the original
and refreshed exposure, normalized Aave supply, headroom, allowed amount and
signed amount as exact integers. In a bounded live full-headroom control pair,
the original and refreshed exposure/headroom/allowed/signed values were equal
at the raw-unit level and normalized Aave supply changed by `0` raw units.
The older browser failure did not retain the fresh evaluation payload behind
the route wrapper, so Aave accrual is not a demonstrated cause; it remains an
unverified hypothesis rather than a provider or policy conclusion.

For `CURRENT_SOURCE_UNAVAILABLE`, the underlying sanitized adapter result was
`rpc_aave_balance_mismatch`, not the wrapper code alone. A same-block local
trace reproduced the strict consistency failure twice: the `rayMul`-derived
normalized Aave supply exceeded the `aToken.balanceOf` result by exactly one
raw unit. This demonstrates that the adapter's source-consistency predicate
failed; whether the one-unit divergence comes from historical-read semantics,
on-chain rounding/timing or another upstream detail remains unverified. Full
account-specific integer tuples and all credentials stayed out of committed
artifacts.

The custom provider's intermittent historical-read consistency remains an
explicit acceptance limitation even though the bounded positive route gate
passed.

## FACT — deployed Aave arithmetic inspection

- The inspected Base proxy slots resolved to the official Aave V3 Base
  implementations: aToken implementation
  `0x273e4b97c3f5280aff4949aa19a27ff54968458d` and Pool implementation
  `0xa4abc5fcba6d0d7e3d144d6dbf6cb6128599dfdb`. The public address book lists
  the same Base implementation addresses and the wstETH reserve addresses.
- The deployed aToken `POOL()` and `UNDERLYING_ASSET_ADDRESS()` getters, plus
  Pool `getReserveData().aTokenAddress`, matched the expected Base Pool,
  wstETH underlying and wstETH aToken. This is an identity check, not a
  permission to trust an arbitrary contract.
- At a fresh same-block control snapshot, the Graph block equaled the RPC
  block and every relevant `eth_call` carried the same explicit block tag.
  On-chain `getReserveNormalizedIncome` exactly matched the Aave formula: the
  same-block timestamp branch returns the stored liquidity index; otherwise
  linear interest uses `rate * elapsed / 365 days` with integer floor and then
  Ray multiplication. The aToken balance exactly matched
  `rayMul(scaledBalance, normalizedIncome)` at that control block.
- The official implementation uses half-up Ray multiplication,
  `(a * b + HALF_RAY) / RAY`; no tolerance or bypass was introduced. The
  earlier `+1` observation therefore remains an unresolved read/result
  divergence, not evidence that the deployed arithmetic should be weakened.
  A later attempt to re-read the old historical block returned a sanitized
  JSON-RPC `-32602` on a proxy call, so the old block cannot currently be used
  as a conclusive contract-level reproduction. References: the [Aave Base
  address book](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Base.sol),
  [AToken balance arithmetic](https://github.com/aave/aave-v3-core/blob/master/contracts/protocol/tokenization/AToken.sol),
  [ReserveLogic normalized income](https://github.com/aave/aave-v3-core/blob/master/contracts/protocol/libraries/logic/ReserveLogic.sol),
  and [WadRayMath rounding](https://github.com/aave/aave-dao/aave-v3-origin/blob/main/src/contracts/protocol/libraries/math/WadRayMath.sol).

## FACT — fixture and boundary negatives

- The existing fixture condition test demonstrates a valid old permit being
  rejected as `CURRENT_HEADROOM_INSUFFICIENT` when current headroom is zero;
  this validates the authorization-drift branch without presenting it as live
  Aave evidence.
- A separate request-boundary check rejected
  `10.000000000000000001` with the bounded maximum error. This is distinct from
  same-permit replay rejection and from live source availability.

One in-session model-to-local-contract invocation also mapped a natural-language
intent to the restricted `sentinel_exposure_graph` schema while keeping account,
policy, provider, signing and execution server-owned. That live read returned
fail-closed `DENY` with `rpc_aave_balance_mismatch`; it demonstrates the
authority boundary and sanitized failure path, not a successful external
AI/MCP integration.

The bounded external client was exercised once on September 8 with the local
`OPENAI_MODEL=gpt-5` setting and the natural-language request to check a bounded
`0.5 wstETH` exposure purchase. The fixed Responses endpoint returned the
sanitized result `status: "blocked"`, `code: "external_request_failed"` and
HTTP `429` before returning a model message or `sentinel_exposure_graph`
function call. No source-backed response, second explanation request, retry,
signing or execution was observed. This is a bounded integration attempt, not
external AI acceptance evidence; the sanitized result does not establish
whether the `429` was caused by rate limit, quota or another provider policy.

After that bounded diagnosis, the client gained an explicit OpenRouter mode
with the fixed endpoint and model default `google/gemini-3.8-flash`. The local
provider path is covered by focused tests, but `OPENROUTER_API_KEY` is not
configured in the local environment and no OpenRouter request has been run.

## UNKNOWN or explicitly not delivered

- The Graph deployment is not qualified for USD valuation. Its `priceInEth`
  and the sampled stale oracle timestamp do not justify a USD risk model.
- No public demo account is frozen in the repository. The configured account
  remains operator-owned local configuration.
- No genuine external natural-language AI/MCP integration has been
  demonstrated. The one bounded OpenAI attempt returned HTTP `429` before a
  model-selected tool call, so it provides no source-backed external response.
  The OpenRouter/Gemini path is implemented and unverified live.
  The in-session model-to-local-contract trace above is not evidence of model
  selection through an external client or MCP connectivity.
- Provider-stable repeatability of the live paper-executor success is not
  established. The bounded successful route run and the separate fail-closed
  source/headroom observations must not be generalized beyond this narrow
  attempt.
- The exact root cause of the earlier `CURRENT_HEADROOM_INSUFFICIENT` browser
  observation remains unverified because its refreshed evaluation payload was
  not retained by the wrapper.
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

1. If stronger repeatability is still worth the event scope, investigate the
   one-unit historical-read mismatch with a bounded source trace; do not
   weaken the fresh-condition gate, exact arithmetic or fall back to a fixture.
2. If external AI evidence remains required, configure OpenRouter with the
   exact local variables documented in `AI_TOOL.md`, then obtain approval for
   one new bounded attempt. Do not retry the recorded OpenAI `429`
   automatically and do not grant the model control of account, policy, URLs,
   signing or execution.
3. Founder reviews this narrow action policy and decides whether further
   reproduction/media work is worth the remaining event scope.

## Authority boundary

Local implementation and verification are complete for the committed slice.
Public push, paid services, account changes, deployment, portal submission and
wallet actions remain separate founder decisions. This file reports local
facts and bounded unknowns, not release readiness or sponsor qualification.
