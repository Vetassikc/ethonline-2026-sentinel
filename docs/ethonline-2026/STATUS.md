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
- `GET /exposure-graph` renders the graph, provenance, editable Task 3
  read-only plan/repair console and a separately accessible legacy
  single-purchase demo. The screen has no reservation, signing, execution or
  runtime what-if controls; the new internal Task 4A ledger is not exposed by
  the route. Legacy permit/replay controls are enabled only by their own
  eligible stored evaluation.
- Task 1/2 exact plan validation, accounting, diagnostic projection and repair
  checks remain green. After the current Task 3/Task 4A correction checkpoint,
  the focused service/UI/lifecycle/reservation checks pass `39/39`, and
  `npm test` passes `238` tests with zero failures, skips or todos; JavaScript
  syntax and `git diff --check` pass.
- The smallest external-client path is implemented locally as a native-fetch
  provider-selectable Responses wrapper around `sentinel_exposure_graph`; the
  focused provider tests pass `6/6`. It is bounded to two AI requests, one
  read-only local tool call and no signing or execution route.
- One bounded external OpenRouter run using `openai/gpt-5` completed the
  natural-language → model tool call → live source-backed policy chain for a
  read-only `0.5 wstETH` check. The result was `ALLOW` with source status `ok`
  at block `51033233`; no signing or execution authority was exposed.
- The external client now exposes a deterministic
  `application_generated_summary` derived only from the validated sanitized
  tool result. It is explicitly labeled as not completed model prose; the
  partial `model_response` remains separate and unchanged.

## FACT — Task 3 read-only plan boundary

- `POST /api/exposure/plan/validate` accepts only an opaque server evaluation
  reference and a strict versioned plan. Account, policy, provider, source and
  eligibility inputs are not client-controlled.
- `GET /api/exposure/plan/source/fixture` and its allowlisted template variants
  issue short-lived server-owned fixture references. The planner also exposes
  an explicit qualified-live path through the existing server-side evaluation
  route; a live-source failure remains an error and is never replaced by a
  fixture.
- The implemented form allows only the two registered demo agents, four
  supported goals, three allowlisted actions and one to three ordered steps.
  Exact decimal strings are submitted unchanged; changing source or any plan
  input clears the prior result, and late responses are ignored by sequence.
- The service preserves source mode and qualification separately from the
  legacy `BUY_EXPOSURE` verdict. A source-backed debt-free Aave withdrawal can
  be evaluated even when the legacy purchase verdict is `DENY`.
- Exact engine quantities cross the service boundary as decimal/raw strings.
  Source failure and expired references are explicit; no failed live source is
  replaced with fixture data.
- The canonical fixture is independently recorded as: initial direct/Aave
  `.40/.40`, hypothetical diagnostic total/Aave `1.10/.70` with both cap
  violations, and engine repair acquire/supply `.20/.10` ending at
  direct/Aave/total `.50/.50/1.00` with `PARTIAL` goal fulfillment. The
  diagnostic projection is not authorization replay.
- Separate fixture cases cover cap-restoring withdrawal and unsupported
  `reduce_total_exposure`. Shared reservations and runtime what-if return an
  explicit Task 3 boundary response; they are not fabricated successes.
- Implemented-route browser captures are
  `output/playwright/sentinel-task3-desktop.png` and
  `output/playwright/sentinel-task3-mobile.png`. They show the fixture label,
  shared dependency graph, compact exact values and the decision-first mobile
  layout. They do not establish production, sponsor or live-transaction
  readiness.
- Browser acceptance exercised the implemented route, not only markup: the
  canonical fixture loaded through a server-issued reference, an edited
  `.100000000000000000` target produced a second POST with the edited plan,
  malformed input cleared the prior decision, mocked `410`/`503` responses
  stayed explicit, and a delayed first response could not overwrite a newer
  `.200000000000000000` result. Enter-key submission, mobile width with zero
  horizontal overflow, connected graph edges, the cap-restoring template and
  the separate eligible legacy controls were also checked. The `410`/`503`
  and delayed-response checks are controlled browser fixtures, not live-source
  evidence.

- The Task 3 request-lifecycle regression is verified in the browser with a
  deterministically held `POST /api/exposure/plan/validate`: editing the exact
  target to `0.200000000000000000` immediately re-enabled Evaluate, the old
  response left the plan labeled `FIXTURE · STALE`, and a new explicit
  evaluation recovered `0.2 wstETH` without a reload. The controlled capture
  is [sentinel-task4a-recovery-desktop.png](../../output/playwright/sentinel-task4a-recovery-desktop.png).
- The cross-kind lifecycle correction is also verified against the implemented
  route: a deferred fixture-source response remained the current source load
  when Evaluate was invoked before it settled; source controls stayed disabled
  while loading, and the same page recovered to the server-derived canonical
  result after the response was released. The sanitized captures are
  [sentinel-task4a-cross-kind-pending.png](../../output/playwright/sentinel-task4a-cross-kind-pending.png)
  and
  [sentinel-task4a-cross-kind-recovered.png](../../output/playwright/sentinel-task4a-cross-kind-recovered.png).
- A source-switch failure run kept an old evaluation request pending, returned
  an explicit fixture-source error, re-enabled Evaluate, and left the error
  unchanged after the stale evaluation response was released. The sanitized
  capture is
  [sentinel-task4a-source-failure-recovery.png](../../output/playwright/sentinel-task4a-source-failure-recovery.png).

## FACT — Task 4A process-local reservation core

- `api/app/exposure-reservations.ts` now contains an internal, process-local
  reservation ledger. It binds each admission to the server-owned account
  scope, policy, qualified source identity, session mode and runtime
  generation. `createExposureRuntimeState()` owns a fresh isolated reservation
  runtime while the legacy evaluation, permit and nonce maps remain unchanged.
- Admission recomputes the exact plan against the current qualified state and
  all active reservations. It does not accept a prior PASS result or any model
  output as authority. PARTIAL results require `accept_partial: true`; invalid
  policy, unsatisfied goals, unsupported execution prerequisites and source
  failure remain fail-closed.
- In the canonical `.40` direct / `.40` Aave / `.80` total fixture, two
  independently feasible acquire-only `.15` plans were admitted through one
  ledger in a deterministic simultaneous interleaving: `agent_a` was
  `accepted_reserved` with peak total increase `.15` and peak Aave increase
  `0`; `agent_b` was rejected with `SHARED_CAPACITY_INSUFFICIENT`. The exact
  remaining total headroom was `.05`; Aave headroom remained `.10` and active
  reservation count was `1`.
- Protocol-cap contention is separate: supply `.15` from Aave `.40` was
  rejected for `aave_cap_exceeded`, not treated as shared total-headroom
  contention. Direct-inventory and Aave-inventory conflicts are checked as
  separate resources. A pending withdrawal does not release cap capacity;
  supply→withdraw retains its intermediate peak Aave requirement.
- Cancellation, expiry and duplicate release use one release event and return
  capacity exactly once. Identical idempotency keys return the original
  active reservation even after a shorter idempotency interval has elapsed; a
  different payload returns `IDEMPOTENCY_KEY_CONFLICT`. Active receipts are
  never evicted to satisfy a bounded store. Once a reservation is terminal,
  retention starts at that terminal transition and an identical retry returns
  `IDEMPOTENCY_KEY_TERMINAL` rather than an acceptance-shaped historical
  receipt; after bounded post-terminal retention, the key may be reused.
- Source updates preserve active reservations for a same-session,
  same-mode, same-generation refresh. A session/mode/runtime-generation
  rotation explicitly transitions active records to `invalidated` without
  deleting the historical record, and current context validation runs before
  the idempotency cache can return any acceptance-shaped result.
- Awaited refresh tests cover source failure and state/reservation changes
  during refresh. Both return without a new reservation or capacity debit;
  runtime generation, session, mode and source identity mismatches reject
  stale admission.
- This is an internal admission/accounting core only. No Task 4B HTTP
  acceptance route, plan permit, signing, execution, paper overlay, runtime
  what-if or reservation UI was added. It must not be presented as completed
  plan authorization or execution.

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

The changed-condition branch has reproducible fixture coverage: the existing
condition test verifies that a valid old permit is rejected as
`CURRENT_HEADROOM_INSUFFICIENT` when refreshed fixture headroom is zero. This
is controlled fixture evidence, not a live Aave changed-condition replay.

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
with the fixed endpoint and model default `google/gemini-3.8-flash`. After
explicit approval, one bounded OpenRouter request reached the model, but the
first response contained no `sentinel_exposure_graph` function call. The
sanitized code was `model_did_not_call_tool`; therefore no local tool
execution, source-backed result or second explanation request occurred. The
initial blocked envelope carried an incorrect OpenAI client label, which was
corrected locally and covered by a regression test. This remains unverified
external acceptance evidence, and no retry was made.

The final bounded variant used the OpenRouter model `openai/gpt-5` with the
router budget raised to `2000` tokens and the explanation budget bounded at
`1000`. It returned `status: "ok"`, an actual
`sentinel_exposure_graph` call with validated `requested_units: "0.5"`, and a
live tool result: `ALLOW`, requested and allowed
`0.500000000000000000 wstETH`, gross exposure
`0.000012505725903091`, headroom `0.999987494274096909`, paths
`direct_holding` and `aave_supply`, and gaps
`usd_valuation_unavailable` and `stale_oracle_price`. The model explanation
contained those source/policy fields but ended mid-sentence at the bounded
output limit; completeness of the prose explanation remains a limitation even
though the tool/source chain was demonstrated. No retry followed.

## UNKNOWN or explicitly not delivered

- The Graph deployment is not qualified for USD valuation. Its `priceInEth`
  and the sampled stale oracle timestamp do not justify a USD risk model.
- No public demo account is frozen in the repository. The configured account
  remains operator-owned local configuration.
- The bounded external natural-language AI/tool chain is demonstrated for one
  OpenRouter `openai/gpt-5` route as described above. The earlier direct OpenAI
  `gpt-5` attempt returned HTTP `429`, and the OpenRouter Gemini 3.8 Flash
  attempts remain separate failed variants, not interchangeable evidence.
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
- Task 4A reservations are also process-local and invalid after a new runtime
  generation. Task 4B still has to add the operator/session boundary,
  plan-bound permit, fresh paper recheck, overlay execution and what-if
  integration before any reservation can be called an authorization.
- No production deployment, wallet transaction, live trade, portal
  submission, outbound message, adoption, partnership, revenue, audit,
  security assurance or prize outcome is claimed.
- The completeness of the final model's prose explanation remains unverified
  because its captured text ended at the bounded output limit. Founder review
  of policy choices, live output, demo narration and media is still required.

## Current dependency audit

`npm audit --json` on September 7 reported two affected locked dependency
entries: `ethers` (moderate via `ws`) and `ws` (high, including uninitialized
memory disclosure and memory-exhaustion DoS advisories). This is a dependency
review item, not proof of an exploitable application path. No forced upgrade or
dependency mutation was performed.

## FACT — demo and submission preparation

- A single 2:30–3:00 demo sequence is drafted in [DEMO.md](./DEMO.md) and
  [../../docs/DEMO_SCRIPT.md](../../docs/DEMO_SCRIPT.md). It keeps live
  Graph/RPC data, the external model/tool trace, the separate paper-execution
  run, fixture negatives and synthetic UI rehearsal explicitly distinct.
- The external client now exposes a deterministic application-generated
  summary derived only from validated tool output. The preparation artifact
  renders that summary from the already recorded sanitized tool result; it does
  not repair or replace the truncated model explanation.
- The sanitized recorded trace and its application-generated summary are
  preserved in [EXTERNAL_AI_TRACE.md](./EXTERNAL_AI_TRACE.md). No new paid
  provider request was made to create this preparation artifact.
- Public-safe pitch, architecture, Continuity baseline/new-work disclosure,
  reproduction instructions, AI attribution and limitations are drafted in
  [SUBMISSION_DRAFT.md](./SUBMISSION_DRAFT.md). No project record, video upload
  or portal submission has been made.
- The official ETHOnline requirements were checked on September 8, 2026:
  public repository, 2–4 minute video at 720p or higher, Continuity disclosure,
  AI attribution and up to three partner-prize selections. See the [official
  submission details](https://ethglobal.com/events/ethonline2026/info/details)
  and [The Graph Continuity qualification](https://ethglobal.com/events/ethonline2026/prizes/the-graph).

## Next bounded actions

1. If stronger repeatability is still worth the event scope, investigate the
   one-unit historical-read mismatch with a bounded source trace; do not
   weaken the fresh-condition gate, exact arithmetic or fall back to a fixture.
2. No further external provider/model attempts are planned. Use the
   application-generated summary for the demo; do not obtain a new paid call
   merely to repair the model prose.
3. Founder reviews the submission draft, records the narrated 2–4 minute video,
   checks the live Hacker Dashboard fields and decides separately whether to
   publish the project.
4. Task 4B remains a separate review gate for operator-session routes,
   plan-bound permits, fresh paper execution and runtime what-if integration;
   the current Task 4A core must not be narrated as those capabilities.

## Authority boundary

Local implementation and verification are complete for the committed slice.
Public push, paid services, account changes, deployment, portal submission and
wallet actions remain separate founder decisions. This file reports local
facts and bounded unknowns, not release readiness or sponsor qualification.
