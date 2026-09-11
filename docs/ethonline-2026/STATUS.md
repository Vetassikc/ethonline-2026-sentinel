# Status — September 11, 2026

## FACT — verified now

- The public repository is isolated on `ethonline-2026/position-evidence`; the
  historical upstream tree was not rewritten. The reviewed Task 3/Task 4A
  baseline is published as commit `aa95f40`; the Task 4B baseline is published
  as `4e67771` on the explicit `ethonline` remote. The recovery correction is
  separately checkpointed as `033c751`; the Task 5 dependency-impact diff is
  intentionally uncommitted for review.
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
  read-only plan/repair console, the bounded Task 5 dependency-impact panel
  and a separately accessible legacy single-purchase demo. The screen has no
  reservation, signing or execution controls; the Task 4A ledger and Task 4B
  operator mutation routes are not exposed by this screen. Legacy
  permit/replay controls are enabled only by their own eligible stored
  evaluation.
- Task 1/2 exact plan validation, accounting, diagnostic projection and repair
  checks remain green. The Task 3/Task 4A correction checks remain `39/39`,
  the Task 4B focused correction checks pass `29/29`, the current affected
  Task 5/UI/lifecycle suite passes `23/23`, and `npm test` passes `276` tests
  with zero failures, skips or todos; JavaScript syntax and `git diff --check`
  pass.
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
  `reduce_total_exposure`. Shared reservations remain outside the read-only
  planner; the separate Task 5 what-if route is documented below and remains
  non-authorizing.
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
- This is the internal Task 4A admission/accounting layer underneath the
  bounded Task 4B operator boundary. Task 4A alone is not authorization or
  execution; Task 4B adds only the local, paper-only route lifecycle described
  below.

## FACT — Task 4B bounded local paper-authorization boundary

- A separate operator session is established server-side through
  `GET /api/exposure/operator/session`. Mutation routes require the opaque
  `HttpOnly; SameSite=Strict` cookie, the fixed local `Origin` and `Host`, and
  the session-bound `x-sentinel-csrf` value. The session response excludes the
  private cookie token and internal expiry milliseconds.
- The bounded mutation surface is explicit and separate from the read-only
  planner: operator acceptance, plan-bound permit issuance, pure permit
  verification, paper execution and cancellation. Request bodies accept no
  caller-selected account, policy, provider, signer, chain, token or calldata;
  authority remains server-owned.
- `sentinel-exposure-plan-permit.v1` binds the exact plan hash, agent, server
  account, policy, evidence reference, graph hash, reservation, session,
  independent source provenance, runtime generation, mode, expiry, nonce and
  fixed audience. Cryptographic
  validity is reported separately from current execution eligibility, which
  remains `UNVERIFIED_UNTIL_FRESH_RECHECK` until the execution boundary passes.
- A bounded controlled-source lifecycle passed: operator session → accepted
  plan → reservation → plan permit → pure verification → deferred fresh-source
  recheck → `PAPER_EXECUTED` overlay. Reusing the same permit returned
  `NONCE_ALREADY_USED`; source failure, context/state changes during refresh,
  stale sessions and what-if mode remained fail-closed. Sequential paper
  executions use the effective overlay exactly once; the overlay response
  excludes the server account field.
- These Task 4B checks use a server-issued `FIXTURE` evaluation reference.
  The operator session mode `live` does not relabel fixture provenance as live,
  and this evidence is not a live paper execution, wallet transaction,
  production authorization or durable ledger. No wallet transaction was sent.
- Task 4B remains process-local and in-memory. Restart invalidates generation-
  bound state. Task 5 adds only the read-only dependency-impact panel below;
  it does not add reservation UI, execution controls or planner-tool
  integration.

## FACT — Task 4B correction checkpoint

- RED regressions reproduced the three reported defects: a stale pre-refresh
  timestamp allowed `PAPER_EXECUTED` after reservation/permit/session expiry;
  a same-quantity FIXTURE acceptance could be relabeled by a LIVE_SOURCE
  refresh; and a foreign-origin or no-cookie session GET could rotate the
  active context and invalidate state.
- GREEN behavior reads a server-owned injectable clock again after the awaited
  refresh. At `now_ms >= expires_at_ms`, reservation and operator session
  expiry reject; a permit is valid through its integer-second `expires_at` and
  expires at the next second. Reservation expiry returns
  `RESERVATION_EXPIRED`, releases capacity once and preserves the absence of
  overlay/nonce side effects. Permit/session expiry preserve the active
  reservation and also produce no overlay or nonce.
- `source_provenance` is now carried by reservation records and the signed plan
  permit, and checked against the accepted session and paper overlay. Both
  `FIXTURE -> LIVE_SOURCE` and `LIVE_SOURCE -> FIXTURE` return
  `SOURCE_PROVENANCE_MISMATCH`; an unrelated block/hash change within one
  provenance still executes in the controlled paper path. The separate
  what-if path remains `SIMULATION_NOT_EXECUTABLE`.
- GET `/api/exposure/operator/session` now rejects foreign `Origin`,
  cross-site Fetch Metadata, missing/stale cookies over an active context and
  stale sessions before mutation. Initial local bootstrap remains available
  without CSRF. Explicit rotation is a same-origin, cookie-and-CSRF protected
  `POST /api/exposure/operator/session/reset`; rejected requests preserve the
  session, active reservation and existing paper overlay.
- After a paper overlay outlives the operator session, the regular reset remains
  rejected with `operator_session_expired` and cookie-free bootstrap remains
  rejected with `operator_session_required`. A separate
  `GET /api/exposure/operator/session/recover` returns a non-mutating recovery
  challenge only for that exact current expired session cookie, the exact
  `Host`, and a safe Fetch Metadata value; an `Origin`, when present, must
  match. The server grants a finite five-minute recovery window after the
  fifteen-minute default execution TTL, bounded to fifteen minutes; the
  HttpOnly cookie `Max-Age` covers execution TTL plus that recovery window. The
  POST counterpart additionally requires the retained cookie, its recovery
  CSRF challenge, same-origin `Origin`/`Host`, and the exact body
  `{"disposition":"discard_paper_context"}`. It rotates to a new session and
  explicitly discards the old active paper overlay; it does not archive that
  overlay. At recovery-window expiry the normal cookie jar stops sending the
  cookie, while the server does not automatically delete the paper context.
  Terminal reservation/nonce lifecycle records remain only as process-local
  historical state. Foreign origin, wrong recovery CSRF and cookie-free
  requests preserve session, overlay and nonce state. This route does not
  authorize a plan, issue a permit or execute anything.
- Focused `api/tests/exposure-plan-permit.test.ts` passes `29/29`; the full
  suite at this correction checkpoint passed `267/267`; Node syntax checks and
  `git diff --check` pass. This is process-local paper authorization only. It
  does not establish durable authorization, production session security,
  wallet execution or Task 5 execution semantics; the separate read-only Task
  5 impact checkpoint is recorded below.

## FACT — Task 5 dependency-impact checkpoint (uncommitted)

- The allowlisted `POST /api/exposure/what-if` boundary accepts exactly
  `evaluation_ref` and `scenario`, with the sole scenario
  `aave_evidence_unavailable`. Evaluation references, source provenance,
  policy, account context and eligibility are resolved from server-owned
  process state. An unknown, expired or unqualified source fails explicitly;
  the route never fetches a provider or substitutes a fixture.
- The service builds a distinct `mode: what_if` simulation session from the
  stored evaluation. It copies only analysis-safe plan, reservation and
  permit-check metadata; it does not copy credentials, signed permit
  material, execution authority or operator cookies. The original graph,
  policy, reservations, paper overlay, session and consumed nonces remain
  unchanged. Repeated simulations receive distinct opaque session IDs.
- The same read-only predicate layer is evaluated for the original and
  hypothetical contexts. On the canonical `.40/.40` fixture, the original
  snapshot is `FIXTURE` with direct `.4`, Aave `.4`, total `.8` and cap `1`;
  the hypothetical snapshot is `WHAT-IF / SIMULATION` with the same direct
  `.4` and cap `1`, while Aave evidence and total exposure are
  `unavailable`. `total_exposure_cap` changes from
  `established/aave_user_reserve_available` to
  `unavailable/aave_evidence_unavailable`; `aave_evidence` is also listed as
  unavailable. The base block/hash are retained and unrelated metadata
  changes do not become an outage.
- Aave-touching and direct-only plans are both reported as affected because
  both rely on the shared total-cap predicate. An accepted reservation is
  marked `would_require_re_evaluation` only inside the hypothetical report;
  the actual reservation remains unchanged. A simulation permit/execution
  attempt is rejected at the existing boundary with
  `SIMULATION_NOT_EXECUTABLE` and has no overlay or nonce side effect.
- The implemented route renders the original and hypothetical snapshots side
  by side, keeps `FIXTURE` provenance on the base snapshot, labels the overlay
  `WHAT-IF / SIMULATION`, and exposes the causal path through keyboard-
  accessible details. Values are rendered from the response as exact decimal
  strings; raw values, permit-check evidence, loading/error and stale states remain
  separate from authorization.
- Browser evidence from the implemented route is captured in
  [sentinel-task5-what-if-desktop.png](../../output/playwright/sentinel-task5-what-if-desktop.png)
  and
  [sentinel-task5-what-if-mobile.png](../../output/playwright/sentinel-task5-what-if-mobile.png).
  The browser made the real `POST /api/exposure/what-if` request with the
  exact two-field body and rendered the returned fixture values. These are
  sanitized synthetic-fixture captures, not a live incident or production
  source result.
- Task 5 verification completed locally with `7/7` focused impact tests,
  `23/23` affected Task 5/UI/lifecycle checks and `276/276` full `npm test`
  tests, with zero failures, skips or todos. Node syntax checks and
  `git diff --check` pass. The recovery checkpoint remains the separate
  committed `033c751`; Task 5 changes, screenshots and documentation remain
  uncommitted. Task 6 has not started.
- Remaining Task 5 limitations are explicit: the simulation is process-local
  and read-only, does not model a fetched live incident or invalidate actual
  reservations, and supports only the one allowlisted scenario. The direct-
  only propagation is covered by deterministic service tests but was not a
  separate browser capture. The unresolved Aave `+1` raw-unit mismatch,
  USD/oracle gaps, absent wallet transaction and lack of production/sponsor
  qualification are unchanged. The prior external AI trace did not exercise
  this new planner.

## FACT — Task 5 corrective checkpoint (uncommitted)

- The what-if result now has an explicit `.plan-what-if-result[hidden]` CSS
  override with `display: none !important`. Browser evaluation confirmed that
  before the first simulation the element has `hidden: true`, computed
  `display: none`, zero layout height and no accessibility-tree entry. Editing
  the plan hides the old result immediately; a new evaluation and what-if
  recover without reload. A failed live-source request leaves the result hidden
  and the fixture recovery remains explicit.
- Accepted reservations no longer imply a permit check. The current
  authorization runtime does not persist permit-check receipts, so both an
  accepted plan with no permit issuance and an accepted plan whose local
  fixture permit was successfully issued return an empty
  `simulated_permits_copy`, `permit_check_id: null`,
  `original.permit_status: not_recorded` and a hypothetical permit edge.
  The explanation is: "No permit-check evidence is recorded in this analysis;
  issuance/check history is not established." This status does not
  claim that issuance never happened. Explicit builder inputs may still
  represent a genuinely recorded check; no reservation identifier is used as
  a fallback.
- The public hub now exposes a prominent `Open Sentinel Exposure Graph` link
  without changing `/judge`, `/operator` or other legacy routes. The Exposure
  Graph header labels LIVE SOURCE and REPLAY as capabilities, while the active
  source remains shown separately as `FIXTURE`, `LIVE_SOURCE` or `REPLAY`.
- A bounded proposal artifact is available at
  `docs/superpowers/mockups/sentinel-exposure-graph-visual-proposals.html`.
  Proposal A is the recommended direction, not an approved production
  redesign: it uses a full-width decision-first desktop workspace and
  decision → plan → graph mobile order, while borrowing the short causal
  explanation from Proposal B. Proposal B remains reference material. Both
  are explicitly labeled proposals and contain only sanitized fixture values.
  Proposal A now keeps the comparison board readable at 1024, 1280, 1440 and
  390 pixels; its mobile graph says `Projected after repair — not executed`,
  while the what-if baseline explicitly remains the original `.40/.40/.80`
  fixture. Policy PASS, goal PARTIAL and execution authority none remain
  separate, and the causal path is visible before technical hashes/raw IDs.
- The affected corrective suite passed `23/23`; the fresh full suite passed
  `276/276`. Syntax checks and `git diff --check` passed. Actual browser
  verification used the implemented route and a deferred-response harness:
  the initial what-if result was hidden with computed `display: none` and
  zero height; a successful what-if became visible with `FIXTURE` original
  and `WHAT-IF / SIMULATION` overlay; source invalidation hid the result and
  disabled the what-if control; editing during an in-flight what-if kept the
  stale response hidden; a controlled `503` kept the result hidden and
  `BLOCKED`; reevaluation and a new what-if recovered on the same page.
  The controlled `503` creates an expected failed-resource console entry; it
  is not live-source evidence.
- Sanitized browser captures are available at
  `output/playwright/sentinel-task5-corrective-desktop.png`,
  `output/playwright/sentinel-task5-corrective-what-if-desktop.png` and
  `output/playwright/sentinel-task5-corrective-what-if-mobile.png`. The
  revised proposal captures are
  `output/playwright/sentinel-proposals-corrective-1024.png`,
  `output/playwright/sentinel-proposals-corrective-1440.png` and
  `output/playwright/sentinel-proposals-corrective-390.png`.

## FACT — bounded Proposal A frontend checkpoint (uncommitted)

- The implemented `/exposure-graph` route now follows the revised Proposal A
  direction without replacing the working application: a compact provenance
  header, shared-dependency graph and decision summary share the primary
  workspace; the requested-versus-repaired table is populated from the
  server response; and the legacy single-purchase controls remain in a
  separate visual section with their existing gates.
- The canonical fixture rendered by the route remains original direct/Aave
  `.40/.40` and total `.80`. The diagnostic projection renders total `1.10`
  and Aave `.70`; the repaired candidate renders direct/Aave `.50/.50` and
  total `1.00`, with candidate policy `PASS`, goal `PARTIAL`, explicit
  `Candidate · not executed`, and no reservation or execution authority.
- Source provenance is visible in the header and graph (`FIXTURE` by default),
  and the qualified-live path remains explicit. A failed live-source request
  showed `Live source blocked` and `No fixture was substituted after
  live-source failure`; the prior fixture result was not retained as current.
- The what-if remains based on the original snapshot, with `FIXTURE` on the
  base and `WHAT-IF / SIMULATION` on the hypothetical side. The response
  continues to show `SIMULATION_NOT_EXECUTABLE`, missing Aave/total as
  unavailable, and no actual reservation invalidation. Legacy permit/paper
  controls stayed disabled after planner-only results in the browser run.
- Browser evidence from the implemented route is captured at
  [390px](../../output/playwright/sentinel-exposure-graph-proposal-a-390.png),
  [768px](../../output/playwright/sentinel-exposure-graph-proposal-a-768.png),
  [1024px](../../output/playwright/sentinel-exposure-graph-proposal-a-1024.png),
  [1280px](../../output/playwright/sentinel-exposure-graph-proposal-a-1280.png),
  [1440px](../../output/playwright/sentinel-exposure-graph-proposal-a-1440.png)
  and the [mobile what-if state](../../output/playwright/sentinel-exposure-graph-proposal-a-390-what-if.png).
  These are sanitized local browser captures, not production or live-source
  qualification evidence.
- Actual browser checks covered all three canonical cases, edited exact input
  and POST-backed reevaluation, malformed input clearing, explicit live-source
  failure without fixture fallback, what-if visibility/recovery, Back and
  refresh, keyboard Enter submission, zero horizontal overflow at all five
  requested widths, and legacy-control separation. A deferred response held
  by the real page handler was released after an input edit; it could not
  restore the old result or disable the current Evaluate control.
- The frontend checkpoint does not add routes, planner-tool integration,
  reservations, signing, execution, runtime what-if, provider changes or
  Task 6 work. The Aave `+1` raw-unit mismatch and all previously documented
  source/USD/oracle limitations remain unchanged. The Proposal A mockup is
  still a design reference; these captures are the implemented route.

## FACT — bounded repair-table correspondence correction (uncommitted)

- The repair comparison now uses the service-provided `repair.changes` and
  each original `step_index` to associate candidate quantities. It no longer
  pairs the candidate subset by array position alone, so removed zero-quantity
  steps do not shift later rows and repeated action kinds remain distinguishable.
- Removed steps render `Removed`. A missing repair candidate renders `No
  candidate`; the UI does not use that label for an ordinary removed step and
  does not recalculate repair policy in the browser.
- Deterministic regressions cover first-step removal, middle-step removal,
  repeated action kinds, the canonical `.30/.30` to `.20/.10` repair and
  `NO_SUPPORTED_REPAIR`. The actual route reproduced the mixed
  `supply_aave .10` plus `withdraw_aave_to_wallet .20` case: the table showed
  `Supply to Aave → Removed` and `Withdraw Aave supply to wallet → .20`, while
  the expanded candidate list contained only the withdrawal.
- Browser evidence is captured at
  `output/playwright/sentinel-frontend-repair-correspondence-details.png`.
  The focused UI file passed `10/10`; the complete affected checkpoint and
  full-suite reruns remain the review gate for this correction.

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
- Task 4A reservations and the Task 4B operator/session state are process-local
  and invalid after a new runtime generation. Task 5 is limited to the
  read-only dependency-impact scenario above; reservation UI and
  planner-tool integration remain outside this checkpoint.
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
4. Review the uncommitted Task 5 dependency-impact diff separately from the
   recovery commit and Task 4B evidence. Do not narrate the controlled fixture
   lifecycle as live paper execution, durable authorization, a live incident,
   external-AI planner integration or wallet execution.

## Authority boundary

Local implementation and verification are complete for the committed recovery
slice and the uncommitted Task 5 review slice; the reviewed commits were
pushed only to the explicit `ethonline` remote after approval. Paid services,
account changes, deployment, portal submission and wallet actions remain
separate founder decisions. This file reports local facts and bounded
unknowns, not release readiness or sponsor qualification.
