# Sentinel Plan Coordination Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (&#x60;- [ ]&#x60;) syntax for tracking.

**Goal:** Add deterministic plan validation/repair, dependency-impact what-if analysis, and two-agent shared-budget reservations as one process-local extension of the existing Sentinel Exposure Graph.

**Architecture:** Keep the existing live single-purchase route, permit schema, external AI trace, and judge surfaces working. Add a versioned plan/effect engine over the current ExposureGraphV1, then place a process-local reservation ledger, plan-bound permit envelope, dependency-impact overlay, and a progressive-disclosure operator screen on top of that same engine. The server remains the authority for account, evidence, policy, signing, runtime generation, and paper execution.

**Tech Stack:** Node 22+ direct TypeScript/ESM, node:http, node:test, node:assert/strict, ethers 6.16+, existing Graph/Base adapters, plain HTML/CSS/JavaScript, and the existing SVG graph. No new runtime dependency.

**Spec:** docs/superpowers/specs/2026-09-08-sentinel-plan-coordination-design.md

## Global Constraints

- Keep Base Mainnet, wstETH, direct holdings, Aave supply and exact 18-decimal integer arithmetic as the only qualified source case.
- Support no more than three ordered plan steps and only these three allowlisted action kinds: `acquire_wsteth`, `supply_aave`, and `withdraw_aave_to_wallet`.
- Keep the existing sentinel-exposure-permit.v1 single-purchase flow unchanged; use sentinel-exposure-plan-permit.v1 for the extension.
- Never accept arbitrary accounts, token addresses, contracts, URLs, calldata, policy overrides, quote assets, signers or provider settings from model/browser input.
- Treat acquire, supply and withdrawal as modeled/paper effects; do not claim funded swaps, protocol liquidity, health-factor validation or wallet execution.
- Keep economic exposure, data evidence and authorization dependencies in separate layers with explicit established, modeled or hypothetical status.
- Reservations are process-local, atomic, idempotent and invalid after runtime restart; never claim durable or on-chain coordination.
- Do not add arbitrary tolerance for the historical Aave +1 raw-unit mismatch or invent USD/oracle values.
- Keep LIVE SOURCE, RECORDED, WHAT-IF, FIXTURE, PAPER and REPLAY visibly distinct.
- Do not make paid AI requests, deploy, push, submit to a portal, send messages, or perform wallet actions as part of this plan.
- This design phase creates no implementation commit. Each implementation task
  below names a proposed local commit grouping for founder review; after
  implementation, create those commits only when the corresponding task is
  verified. Never push without explicit approval.
- The earlier implementation checkpoint covered Tasks 1 and 2; Task 3 is the
  read-only service/UI baseline and Task 4A is the internal process-local
  reservation core. The current bounded checkpoint implements Task 4B's local
  operator/session, plan-bound permit and paper-only lifecycle on top of that
  core. Do not begin Task 5 runtime what-if work, planner-tool integration or
  new reservation UI controls in the same milestone.
- Do not modify docs/ethonline-2026/NEW_CHAT_EXECUTION_PROMPT.md or docs/ethonline-2026/STRATEGY_REVIEW_2026-09-07.md.

## Pre-task 0: Keep the bounded Aave mismatch audit separate from pure-engine work

**Files:**
- Read: api/app/base-rpc.ts
- Read: api/tests/base-rpc.test.ts
- Read: api/app/exposure-graph.ts
- Modify only after founder review: docs/ethonline-2026/STATUS.md or a new
  sanitized acceptance note

**Interfaces:**
- Consumes: the existing deployed-contract identity checks, same-block RPC
  request construction, `rayMul` implementation and the recorded sanitized
  `rpc_aave_balance_mismatch` result.
- Produces: a source-backed classification of established arithmetic facts
  versus an unresolved cause; no provider change and no tolerance.

- [x] **Step 1: Trace the exact adapter path.**

Read the deployed aToken/Pool identity assertions and every relevant
same-block `eth_call`. Confirm that Graph block number/hash and the explicit
RPC block tag are the same, and record only sanitized method names and status
codes. Do not print or persist an account, endpoint, credential or raw
account-specific tuple.

- [x] **Step 2: Verify arithmetic and rounding as exact integers.**

Confirm the deployed/official arithmetic and local implementation use
`(scaled_supply * normalized_income + HALF_RAY) / RAY`, with no arbitrary
tolerance. Compare normalized Aave supply and `aToken.balanceOf` as exact
integers at the same block. A `+1` difference remains
`rpc_aave_balance_mismatch` unless the deployed code/read semantics establish
the cause.

- [x] **Step 3: Run bounded fixture/unit checks.**

Run the existing `base-rpc` Ray-rounding and same-block tests, plus one
sanitized source trace if already configured. Reuse the existing recorded
investigation first and time-box any additional read-only work to
approximately 30–45 minutes. Do not switch providers, add a retry loop, alter
caps, or bypass the consistency check. If the historical block is unavailable
or the cause remains ambiguous, record `UNKNOWN` rather than a provider
conclusion.

- [x] **Step 4: Stop at the mismatch review gate.**

Report FACT/INFERENCE/UNKNOWN and whether the evidence permits any source or
arithmetic change. An unresolved mismatch remains a live-source acceptance
limitation and does not block Task 1 or Task 2. No provider, rounding or
tolerance change is authorized by this pre-task, and no external model call is
part of it.

---

## Task 1: Add the versioned plan contract and strict boundary

**Files:**
- Create: shared/schemas/exposure-plan.ts
- Create: api/app/exposure-plan-request.ts
- Create: api/tests/exposure-plan-request.test.ts
- Modify: shared/schemas/exposure-graph.ts only if an exported shared quantity/helper type is required; do not alter the v1 single-purchase shape

**Interfaces:**
- Consumes: ExposureGraphV1, parseFixedUnits() and formatFixedUnits() from api/app/exposure-policy.ts.
- Produces: ExposurePlanV1, ExposureAgentId, ExposureGoalKind, ExposurePlanAction, ExposurePlanValidation, and validateExposurePlan(input: unknown).

- [x] **Step 1: Write independent boundary tests.**

~~~ts
test("validateExposurePlan accepts the bounded canonical shape", () => {
  const result = validateExposurePlan({
    schema_version: "exposure_plan.v1",
    agent_id: "agent_a",
    goal: { kind: "supply_up_to", target_units: "0.300000000000000000" },
    steps: [
      { kind: "acquire_wsteth", units: "0.300000000000000000" },
      { kind: "supply_aave", units: "0.300000000000000000" },
    ],
  });
  assert.equal(result.ok, true);
});
~~~

Add tests for both agent IDs, each goal, one-to-three steps, zero/negative/over-precision/overflow quantities, unknown fields, unsupported action kinds (including any exit/disposal action), more than three steps, arbitrary account/chain/address/URL fields, and empty or mismatched goal fields. Expected failures use one stable invalid_exposure_plan code with sanitized detail categories.

- [x] **Step 2: Run the focused tests and confirm the intended RED failure.**

Run: node --test api/tests/exposure-plan-request.test.ts

Expected: FAIL because the new schema and validator do not exist.

- [x] **Step 3: Implement the exact public types and validator.**

Use the spec's ExposurePlanV1 shape exactly. Enforce sorted exact keys at each object level, preserve decimal strings without converting them to floating point, and return a normalized copy with the original step order. The validator must not access Graph/RPC, runtime state, signing material or the environment.

- [x] **Step 4: Run the focused test, full regression, and keep the proposed commit boundary uncommitted for review.**

Run: node --test api/tests/exposure-plan-request.test.ts

Expected: all new boundary tests pass.

Run: npm test

Expected: the existing suite plus the new boundary tests pass; the current single-purchase request and permit shapes remain unchanged.

Proposed commit: feat: add bounded exposure plan contract

## Task 2: Implement deterministic effects, goal scoring and bounded repair

**Files:**
- Create: api/app/exposure-plan-engine.ts
- Create: api/app/exposure-plan-repair.ts
- Create: api/tests/exposure-plan-engine.test.ts
- Create: api/tests/exposure-plan-repair.test.ts

**Interfaces:**
- Consumes: validated ExposurePlanV1, ExposureGraphV1, server-owned plan policy, active reservation deltas, and the plan request validator.
- Produces: ExposureAccountingState, replayExposurePlan(), projectExposurePlan(), evaluateExposurePlan(), repairExposurePlan(), ExposurePlanEvaluation, and ExposureRepairResult.

- [x] **Step 1: Write failing tests for independent state transitions.**

~~~ts
const INITIAL_STATE = {
  direct_available_raw: 400000000000000000n,
  aave_exposure_raw: 400000000000000000n,
  total_exposure_raw: 800000000000000000n,
  debt_raw: 0n,
  dependency_cap_raw: 1000000000000000000n,
  aave_cap_raw: 500000000000000000n,
};

const PLAN_POLICY = {
  policy_version: "exposure-plan-wsteth-v1",
  dependency_cap_units: "1.000000000000000000",
  aave_cap_units: "0.500000000000000000",
  unit: "wstETH",
};

test("supply conserves total underlying exposure", () => {
  const result = replayExposurePlan(INITIAL_STATE, [
    { kind: "supply_aave", units: "0.100000000000000000" },
  ], PLAN_POLICY);

  assert.equal(result.final_state.total_exposure_raw, 800000000000000000n);
  assert.equal(result.final_state.direct_available_raw, 300000000000000000n);
  assert.equal(result.final_state.aave_exposure_raw, 500000000000000000n);
});
~~~

Cover receipt/underlying non-double-counting, total and Aave caps, negative direct inventory, intermediate violations, debt kept separate, supply and wallet withdrawal conservation, debt-sensitive withdrawal blocking, unexecuted withdrawal not freeing a later cap, cap-restoring withdrawal from an existing over-cap Aave state, insufficient restoration, unrelated active Aave reservations, withdrawal inventory limits, all four goal scores, target overshoot, zero progress, explicit partial acceptance, `reduce_total_exposure` returning `UNSATISFIED`/`NO_SUPPORTED_REPAIR`, and no supported repair. Assert source provenance, paper-session eligibility and real-transaction status independently: the canonical repaired plan is paper-ineligible before `accept_partial: true`, paper-authorizable after explicit acceptance, and still reports unverified acquisition funding; a valid supply-only plan reports `aave_supply_approval_and_execution_unverified` rather than `NOT_REQUIRED`. Assert that authorization replay stops at the first violation while a separate diagnostic projection reports the canonical `1.10` total and `0.70` Aave cap violations, and that impossible inventory makes that projection unavailable.

- [x] **Step 2: Run the focused tests and confirm RED.**

Run: node --test api/tests/exposure-plan-engine.test.ts api/tests/exposure-plan-repair.test.ts

Expected: FAIL because the engine and repair modules do not exist.

- [x] **Step 3: Implement the exact effect table and intermediate checks.**

Use BigInt only. The plan policy must contain:

~~~ts
export type ExposurePlanPolicy = {
  policy_version: "exposure-plan-wsteth-v1";
  dependency_cap_units: string;
  aave_cap_units: string;
  unit: "wstETH";
};
~~~

Default caps are 1.000000000000000000 total and 0.500000000000000000 Aave. Apply each step before checking all invariants. Return a separate violation object with step_index, code, before, and after; do not collapse an intermediate failure into a final-only message.

The shared design contract defines `ExposurePlanEvaluation` and
`ExposureRepairResult` as the exact result envelopes consumed by the service
and UI, including independent `source_provenance`, `policy_status`,
`goal_status`, `paper_eligibility`, `real_transaction_status`,
`execution_mode`, replay completeness, diagnostic projection, intermediate
violations and resource requirements. A modeled acquisition must not force
`execution_mode: "BLOCKED"` when the paper session is explicitly eligible; its
real transaction status remains `UNVERIFIED`. Supply and withdrawal also keep
their own unverified real-transaction prerequisites.

`acquire_wsteth` adds direct and total units and adds the explicit
`purchase_funding_unverified` precondition. `supply_aave` transfers direct to
Aave. `withdraw_aave_to_wallet` transfers Aave to direct and never reduces
total exposure. There is no supported exit/disposal action. If debt is
non-zero, the withdrawal is `BLOCKED` for executable planning. A
`reduce_total_exposure` goal therefore remains an honest unsatisfied result,
not an invented action.

For every replay and repair candidate, calculate these exact integer resource
requirements independently of final net deltas:

```text
peak_total_increase_raw
peak_aave_increase_raw
required_preexisting_direct_raw
required_preexisting_aave_raw
internal_acquired_consumed_raw
```

The tests must prove that competing withdrawals reserve Aave inventory, a
`supply_aave` → `withdraw_aave_to_wallet` plan retains its peak Aave-cap
requirement despite zero final Aave delta, and `acquire_wsteth` → `supply_aave`
consumes modeled acquired inventory before counting pre-existing direct
inventory.

- [x] **Step 4: Implement the left-to-right repair algorithm.**

The public signature is:

~~~ts
export function repairExposurePlan(
  initial: ExposureAccountingState,
  plan: ExposurePlanV1,
  policy: ExposurePlanPolicy,
  activeReservations?: ExposureReservationDelta[],
): ExposureRepairResult;

export function evaluateExposurePlan(
  initial: ExposureAccountingState,
  plan: ExposurePlanV1,
  policy: ExposurePlanPolicy,
  activeReservations?: ExposureReservationDelta[],
  options?: ExposurePlanEvaluationOptions,
): ExposurePlanEvaluation;

export function projectExposurePlan(
  initial: ExposureAccountingState,
  steps: ExposurePlanAction[],
  policy: ExposurePlanPolicy,
): ExposureDiagnosticProjection;
~~~

For each step, choose the largest feasible quantity for that step's current state, preserve order/kinds, never use a later withdrawal to free earlier capacity, and record every changed quantity. A withdrawal may require a positive minimum quantity to restore an existing cap; therefore the search checks a restoration lower bound and does not assume feasibility is a prefix beginning at zero. Return FULL, PARTIAL, UNSATISFIED, or NO_SUPPORTED_REPAIR plus the fixed algorithm ID. A target overshoot is an explicit `GOAL_TARGET_OVERSHOT` failure; a positive target with zero progress is `UNSATISFIED`. A `PARTIAL` result is never accepted by the engine without an explicit operator `accept_partial: true`, and an `UNSATISFIED` result can never be reserved or permitted. Do not claim global optimality: disclose `left_to_right_max_feasible_v1` in every repair response.

The canonical fixture must compute, rather than embed in UI text: .4 direct + .4 Aave, .3 acquire + .3 supply -> .2 acquire + .1 supply, final direct .5, Aave .5, total 1.0, partial .3 supply goal.

- [x] **Step 5: Run focused tests, regression and keep the proposed commit boundary uncommitted for review.**

Run: node --test api/tests/exposure-plan-engine.test.ts api/tests/exposure-plan-repair.test.ts

Expected: all transition and repair tests pass.

Run: npm test

Expected: all existing and new tests pass with no changed legacy verdicts.

Proposed commit: feat: validate and repair bounded exposure plans

## Milestone boundary after Task 2

Task 1/2 completed with focused and full regression checks. Task 3 is the
next bounded checkpoint; reservations, signing, execution and runtime what-if
remain separate follow-on work.

## Task 3: Connect plan evaluation to server-owned evidence and minimal UI

**Files:**
- Create: api/app/exposure-plan-service.ts
- Create: api/tests/exposure-plan-service.test.ts
- Modify: api/app/server.ts
- Modify: web/exposure-graph.html
- Modify: web/exposure-graph.js
- Modify: web/styles.css
- Modify: api/tests/exposure-ui.test.ts

**Interfaces:**
- Consumes: existing evaluateExposureRequest(), stored live/fixture evaluation references, ExposurePlanV1, ExposurePlanEvaluation, and repairExposurePlan().
- Produces: POST /api/exposure/plan/validate, GET /api/exposure/plan/config, and GET /api/exposure/plan/demo/:case with allowlisted canonical repair, cap-restoring withdrawal and unsupported total-reduction cases. Reservation and what-if cases remain explicit Task 3 boundary responses.

- [x] **Step 1: Write service and route tests before wiring the screen.**

Tests cover server-stored evaluation only, rejection of account/policy inputs,
live/fixture/replay mode preservation, exact integer serialization, explicit
source failure and expiry, canonical `.2/.1` repair, cap-restoring withdrawal,
unsupported total reduction, non-mutation and the unavailable reservation/what-if
boundary.

- [x] **Step 2: Run the focused tests and confirm route failures.**

Run: `node --test api/tests/exposure-plan-service.test.ts api/tests/exposure-ui.test.ts`

Result: 11/11 focused tests pass after implementation.

- [x] **Step 3: Implement server-owned plan evaluation.**

POST /api/exposure/plan/validate accepts exactly:

~~~json
{"evaluation_ref":"exposure_<32 hex>","plan":{"schema_version":"exposure_plan.v1","agent_id":"agent_a","goal":{"kind":"supply_up_to","target_units":"0.300000000000000000"},"steps":[{"kind":"acquire_wsteth","units":"0.300000000000000000"},{"kind":"supply_aave","units":"0.300000000000000000"}]}}
~~~

Resolve the referenced server evaluation, derive initial direct/Aave/total/debt
state from its graph, use no active reservation delta in this checkpoint, and
return the original replay plus one deterministic repair candidate. Source
qualification is separate from the legacy `BUY_EXPOSURE` verdict. BigInt values
cross the boundary as exact decimal/raw strings. No reservation, permit or
signer action is issued from this route.

GET /api/exposure/plan/config returns policy versions, caps, supported goal and
action kinds, server-only source resolution and the read-only boundary.
GET /api/exposure/plan/demo/:case returns sanitized synthetic state and the same
computed result; it never pretends fixture data is live.

- [x] **Step 4: Replace the single-purpose visual hierarchy with the compact console.**

Keep the current route and existing evidence baseline below the new plan area.
Signing, execution and runtime what-if controls are visibly unavailable in this
checkpoint. Add accessible sections with these stable IDs:

~~~text
#plan-intent-panel
#plan-graph-panel
#plan-decision-panel
#plan-repair-panel
#plan-budget-panel
#plan-timeline-panel
#plan-what-if-panel
~~~

Render goal/agent/steps, the direct/Aave shared-dependency graph, decision,
violations, repair, budget and timeline from service values. Use semantic status
classes, visible focus, no transaction-like animation, and responsive
single-column fallback. The implemented route captures are
`output/playwright/sentinel-plan-route-desktop.png` and
`output/playwright/sentinel-plan-route-mobile.png`; static mockups remain
fixture design references only.

- [x] **Step 5: Run UI contract tests and regression.**

Run: `node --test api/tests/exposure-plan-service.test.ts api/tests/exposure-ui.test.ts`

Result: 11/11 focused tests pass, including actual handler route checks.

Run: `npm test`

Result: the original Task 3 focused checks and the full regression pass; after
Task 4B, the full suite is `253/253` with no failures, skips or todos. Old
`/judge`, `/operator`, `/position-evidence` and single-purchase exposure
behavior remain available.

Proposed commit: feat: add plan repair decision console

## Task 4A: Implement the internal process-local reservation core

**Files:**
- Create: `api/app/exposure-reservations.ts`
- Create: `api/tests/exposure-reservations.test.ts`
- Modify: `api/app/exposure-service.ts`
- Create: `api/tests/exposure-plan-lifecycle.test.ts`
- Modify: `web/exposure-graph.js`

**Implemented checkpoint evidence:**

- [x] Separate response freshness from control-state ownership. A stale
  success or failure cannot render, enable legacy authorization, or release a
  newer request's busy control. Request ownership is per kind: an evaluation
  cannot make an independent source load stale, while a source switch
  invalidates dependent evaluations. Deterministic deferred tests cover input
  edits, overlapping evaluation requests, cross-kind source/evaluation
  overlap, source switching, source loading failures and recovery without
  reload.
- [x] Keep reservations internal and process-local. The runtime owns the
  server account scope, fixed policy, qualified source identity, session mode,
  runtime generation and exact BigInt resource maps. The legacy permit and
  execution path is unchanged; no reservation HTTP route or UI control is
  connected.
- [x] Recompute admission against the current qualified state and all active
  reservations. The ledger stores explicit accepted plans, supports explicit
  PARTIAL acceptance, separates total/Aave peak capacity from direct/Aave
  inventory, and keeps pending withdrawals from releasing usable capacity.
- [x] Add deterministic idempotency, cancellation, expiry, one-time release
  events, bounded terminal storage and restart/session/provenance isolation.
  Active idempotency receipts survive a shorter configured retention interval;
  post-terminal retention starts at the terminal transition, terminal replays
  are non-authorizing, and a protected active receipt is never evicted to make
  room for a different key.
- [x] Define the source-update boundary: same-session/mode/generation refreshes
  preserve active reservations, while context rotation explicitly invalidates
  active records without discarding their historical receipts. Current context
  validation runs before any cached acceptance can be returned.
- [x] Add awaited-refresh fail-closed checks for source failure, runtime
  generation, session/mode, source identity, state revision and reservation
  changes. No partial reservation or capacity debit occurs on failure.
- [x] Correction checkpoint checks pass: Task 3 service/UI/lifecycle and
  Task 4A reservation tests pass `39/39`; full `npm test` passes `238/238`.
  Browser verification exercised source loading held by a deferred response,
  an Evaluate action before source settlement, and recovery to the current
  canonical result without reload. Captures are
  `output/playwright/sentinel-task4a-cross-kind-pending.png` and
  `output/playwright/sentinel-task4a-cross-kind-recovered.png`. A separate
  source-switch failure run kept an old evaluation pending, returned an
  explicit fixture-source error, re-enabled Evaluate, and ignored the stale
  evaluation response; its capture is
  `output/playwright/sentinel-task4a-source-failure-recovery.png`.

The canonical shared-headroom result is exact: from direct/Aave/total
`.40/.40/.80` with total cap `1.00` and Aave cap `.50`, agent A's acquire-only
`.15` is admitted with peak Aave increase `0`, agent B's identical request is
rejected with only `.05` total headroom remaining. Protocol-cap contention is
kept as a separate supply `.15` rejection. This checkpoint is not completed
plan authorization or execution.

The reviewed Task 4A baseline was published as commit `aa95f40` on the
explicit `ethonline` remote. Task 4B is kept in a separate commit grouping.

## Task 4B: Add atomic shared reservations and plan-bound authorization

**Files:**
- Create: api/app/exposure-plan-permit.ts
- Create: api/app/exposure-plan-authorization.ts
- Create: api/tests/exposure-plan-permit.test.ts
- Modify: api/app/exposure-permit.ts
- Modify: api/app/exposure-plan-service.ts
- Modify: api/app/exposure-reservations.ts
- Modify: api/app/server.ts

**Interfaces:**
- Consumes: the Task 4A reservation core, ExposurePlanEvaluation,
  ExposureAccountingState, existing demo signer primitives, and
  ExposureRuntimeState.
- Produces: plan-bound permit verification, fresh paper execution, the
  operator-session boundary and the plan reservation routes. Task 4A's
  internal admission and lifecycle are already implemented above.

- [x] **Step 1: Add the Task 4B operator/session boundary on top of Task 4A.**

Add the ephemeral operator session, paper overlay state and execution-bound
state on top of the Task 4A runtime without changing the legacy permit path. The
operator session must be established server-side and protected by an
`HttpOnly`, `SameSite=Strict` cookie, same-origin `Origin`/`Host` validation,
and a session-bound CSRF nonce; this is a local demo boundary, not unrestricted
founder authentication.

- [x] **Step 2: Write Task 4B authorization and execution tests.**

Task 4B tests must cover the operator-session and CSRF boundary, plan-bound
permit payload and verification, simulation-mode rejection at the execution
boundary, runtime restart invalidation, fresh-condition recheck, nonce use and
paper-overlay conservation. The Task 4A tests already cover the shared
headroom, protocol cap, inventory, idempotency, release, source refresh and
state-race cases; do not treat those internal tests as proof of Task 4B
authorization or execution.

- [x] **Step 3: Connect operator acceptance to the Task 4A admission and
  explicit lifecycle.**

Expose the already implemented `acceptExposurePlan()` and lifecycle through an
explicit operator route only after the session and CSRF boundary is in place.
The route must preserve Task 4A's server-owned revalidation, exact resource
accounting and idempotency behavior.

Use one transition function with a release event ID. `paper_executed` applies the complete validated plan to the overlay before releasing pending capacity; the overlay then supplies the new effective state. A later request never counts both the base graph and the applied paper delta. The execution recheck excludes only the executing reservation's own ID; all other active reservations remain in the effective-state calculation.

- [x] **Step 4: Add plan-bound EIP-712 permit and restart boundary.**

Implement sentinel-exposure-plan-permit.v1 with fields from the design spec. The payload must include exact plan hash, agent, evidence ref, graph hash, reservation, runtime generation, session ID, explicit `mode: "live" | "what_if"`, expiry, nonce and fixed audience. Verification is pure. Execution rejects `mode: "what_if"` with `SIMULATION_NOT_EXECUTABLE`, rejects old generation with `RUNTIME_RESTART_INVALIDATED`, keeps the signature cryptographically separate from current executable status, and consumes nonce only after fresh conditions and reservation state pass.

- [x] **Step 5: Add routes and run focused regression.**

Add the session and exact-body routes:

~~~text
GET  /api/exposure/operator/session
POST /api/exposure/plan/accept
POST /api/exposure/reservation/execute
POST /api/exposure/reservation/cancel
POST /api/exposure/plan/permit
POST /api/exposure/plan/verify
~~~

`GET /api/exposure/operator/session` returns only an opaque session ID, CSRF
nonce, runtime generation, policy version and mode. The mutation route bodies
are exactly:

~~~json
{"evaluation_ref":"exposure_<32 hex>","plan":<ExposurePlanV1>,"idempotency_key":"<opaque client key>","accept_partial":false}
{"reservation_id":"<server id>","permit":"<plan permit>","session_id":"<server session id>","mode":"live"}
{"reservation_id":"<server id>","reason":"operator_cancel"}
{"reservation_id":"<server id>","session_id":"<server session id>","mode":"live"}
{"permit":"<plan permit>","session_id":"<server session id>","mode":"live"}
~~~

No route accepts a caller-selected account, policy, evidence, signer, provider,
chain, token or calldata. A request with a mismatching same-origin/CSRF
boundary is rejected before state mutation. Run:

~~~sh
node --test api/tests/exposure-reservations.test.ts api/tests/exposure-plan-permit.test.ts api/tests/exposure-routes.test.ts
npm test
~~~

Before any awaited source refresh, record the reservation version and paper
state revision. After the await, perform a synchronous compare of runtime
generation, reservation version, state revision, relevant identities,
effective quantities, policy predicates and all other active reservations. A
change returns `STATE_CHANGED_REQUIRES_REEVALUATION` with no nonce consumption,
release or overlay mutation. If checks pass, apply the full paper plan,
transition the reservation, consume the nonce and release capacity in one
all-or-nothing state replacement. A new block/hash alone is not a failure when
the relevant quantities, identities and policy remain acceptable. Changed live
quantities with an existing paper overlay require a new paper session and do
not merge live and simulated values.

Result: Task 4B focused checks pass `15/15`; the full suite passes `253/253`
with no failures, skips or todos. The tests cover the operator boundary,
partial acceptance, exact route-level two-agent contention, deferred refresh
fail-closed behavior, overlay non-double-counting, source block/hash refresh,
what-if rejection, permit replay and session isolation. The controlled
lifecycle uses a server-issued `FIXTURE` source reference; it is not live
paper execution. No wallet transaction or paid external provider/model
request occurred.

Implemented commit: `22e405f` — `feat: add plan-bound authorization and paper execution`.

## Task 5: Add dependency-impact propagation and the what-if experience

**Files:**
- Create: shared/schemas/exposure-impact.ts
- Create: api/app/exposure-impact.ts
- Create: api/tests/exposure-impact.test.ts
- Modify: api/app/server.ts
- Modify: web/exposure-graph.html
- Modify: web/exposure-graph.js
- Modify: api/tests/exposure-ui.test.ts

**Interfaces:**
- Consumes: base evaluation reference, plan/reservation maps, graph provenance, and plan-bound permit metadata.
- Produces: buildExposureDependencyImpact(), POST /api/exposure/what-if, ExposureWhatIfScenario, and UI impact paths.

- [ ] **Step 1: Write independent impact tests.**

Test that an Aave evidence outage blocks the total exposure predicate, affects both Aave-touching and direct-only plans that rely on that predicate, marks accepted reservations for re-evaluation/invalidation, and leaves the original live graph hash/block/policy untouched. Test that unrelated metadata/block changes do not mark an otherwise valid plan affected. Assert that the fork copies reservation/permit checks, has a distinct session ID, and cannot mutate or execute the original session.

- [ ] **Step 2: Implement the three dependency layers.**

Use economic_exposure, data_evidence and authorization nodes/edges. Each edge must point to existing evidence or state modeled/hypothetical. Create the explicit path UserReserve -> total exposure cap -> plan -> reservation -> permit for the what-if overlay.

- [ ] **Step 3: Implement the allowlisted overlay route.**

Accept exactly `{evaluation_ref, scenario}` where scenario is
`aave_evidence_unavailable`. Create a distinct `mode: "what_if"` simulation
session, copy reservation and simulated permit checks, and return its opaque
session ID. Run the same read-only condition evaluator against the original
and forked contexts and return the specific changed predicate, original
status/reason, forked status/reason, affected plans and causal path. For the
canonical fixture, `total_exposure_cap` changes from
`established/aave_user_reserve_available` to
`unavailable/aave_evidence_unavailable`.

Do not call the provider, do not mutate/release/re-accept the live evaluation
or original reservation, and do not fabricate a source incident. Any attempt
to use the simulation session for execution returns
`SIMULATION_NOT_EXECUTABLE` at the original execution boundary; that response
does not replace the causal condition comparison. The live route remains the
only operator action boundary.

- [ ] **Step 4: Render the original snapshot and overlay side by side.**

The UI must show LIVE SOURCE for the base snapshot and WHAT-IF for the overlay, with a visible statement that a cryptographically valid permit can still be rejected by the cooperating executor. Add keyboard-accessible path details and a no-data/error state.

- [ ] **Step 5: Run focused tests and commit.**

Run: node --test api/tests/exposure-impact.test.ts api/tests/exposure-ui.test.ts

Expected: the overlay and stale-state tests pass without changing any live source adapter arithmetic.

Proposed commit: feat: explain dependency impact and what-if state

## Task 6: Add the bounded read-only planner tool interface

**Files:**
- Create: shared/schemas/exposure-plan-tool.ts
- Create: api/app/exposure-plan-tool.ts
- Create: api/tests/exposure-plan-tool.test.ts
- Create: scripts/exposure-plan-tool.ts
- Modify: package.json
- Modify: docs/ethonline-2026/AI_TOOL.md

**Interfaces:**
- Consumes: `ExposurePlanV1`, the strict plan validator, current server-owned
  evaluation service and deterministic engine.
- Produces: `sentinel_exposure_plan`, schema version
  `sentinel-exposure-plan-tool.v1`, local client dispatch and a sanitized
  validation/evaluation/repair response.

- [ ] **Step 1: Write the schema and dispatch tests first.**

Use this exact read-only input shape:

~~~json
{
  "schema_version":"sentinel-exposure-plan-tool.v1",
  "action":"PROPOSE_EXPOSURE_PLAN",
  "agent_id":"agent_a",
  "goal":{"kind":"supply_up_to","target_units":"0.300000000000000000"},
  "steps":[
    {"kind":"acquire_wsteth","units":"0.300000000000000000"},
    {"kind":"supply_aave","units":"0.300000000000000000"}
  ]
}
~~~

Test accepted canonical input, exact rejection of unknown/account/policy/
provider/signer fields, all three allowlisted action kinds, malformed quantity
and goal failures, and sanitized result dispatch to the current local plan
service. Assert that the tool cannot receive an evaluation reference, operator
cookie or mode and cannot call reservation, permit, signing, cancel or execute
functions. The test must use a stubbed server-owned evaluation; it must make
no network or model request.

- [ ] **Step 2: Implement the bounded local client and CLI.**

The tool runner must validate the input, resolve the configured current
evaluation on the server, run the same engine as the browser route, and return
only `validation`, `evaluation` and `repair`. It must not accept an account,
policy, source URL, chain, token, signer, provider or execution authority from
the caller. Add a local command `npm run exposure:plan-tool -- --describe` and
`npm run exposure:plan-tool -- --input '<sanitized JSON>'`; `--describe` must
print the schema and read-only capabilities without account or credential
fields.

- [ ] **Step 3: Document the boundary and historical trace.**

Document that the prior external OpenRouter/OpenAI trace demonstrated a genuine
model-selected call to the existing `sentinel_exposure_graph` tool only. It is
not evidence that a model selected the new planner. Any real external call to
`sentinel_exposure_plan` is a separate paid-call approval and evidence gate;
this task performs only local schema/client dispatch tests.

- [ ] **Step 4: Run focused tests and regression.**

Run:

~~~sh
node --test api/tests/exposure-plan-tool.test.ts
npm test
~~~

Expected: the new tool tests pass, the existing external-AI trace tests remain
unchanged, and no external provider/model request occurs.

Proposed commit: feat: add read-only exposure plan tool boundary

## Task 7: Integrated browser rehearsal, evidence and documentation

**Files:**
- Modify: docs/ethonline-2026/SPEC.md
- Modify: docs/ethonline-2026/PLAN.md
- Modify: docs/ethonline-2026/STATUS.md
- Modify: docs/ethonline-2026/DEMO.md
- Modify: docs/DEMO_SCRIPT.md
- Modify: README.md
- Modify: api/tests/docs.test.ts
- Create only if needed: docs/ethonline-2026/PLAN_EXTENSION_TRACE.md

**Interfaces:**
- Consumes: actual route/UI behavior, focused tests, browser rehearsal output, current source limitations, and the existing external AI trace.
- Produces: synchronized public-safe claims and a separate acceptance ledger for the extension.

- [ ] **Step 1: Run the full local verification suite.**

Run:

~~~sh
npm test
git diff --check
~~~

Expected: all tests pass, no whitespace errors, and no new credential/account data appears in tracked artifacts. Do not run scripts/openai-exposure-client.ts.

- [ ] **Step 2: Rehearse the actual route with controlled cases.**

Start from the repository root with npm run start, open http://127.0.0.1:8787/exposure-graph, and exercise in order:

1. canonical over-limit repair (FIXTURE);
2. agent A reservation then agent B conflict (FIXTURE/PAPER);
3. accepted plan execute and duplicate idempotent execution;
4. what-if Aave evidence unavailable (WHAT-IF);
5. legacy live shared-dependency panel separately (LIVE), if the local server has a qualified operator source.

Capture only sanitized screen evidence. A browser check is not production, sponsor, or portal evidence.

For the visual checkpoint, serve only the static design artifact if needed and
review `docs/superpowers/mockups/sentinel-plan-coordination-mockups.html` plus
the desktop/mobile Playwright captures. Do not present these fixture mockups as
the implemented route until the route and UI tests pass.

- [ ] **Step 3: Update claims and known limitations from demonstrated results.**

State separately which cases are live, fixture, recorded, what-if and paper. Retain the unresolved Aave +1, USD/oracle gaps, process-local restart boundary, no wallet transaction, and no production/sponsor qualification. State that the existing external AI trace did not invoke the new planner unless the new path has actually been exercised under a separately approved call.

- [ ] **Step 4: Run documentation and public-safety checks.**

Run:

~~~sh
npm test -- api/tests/docs.test.ts
rg -n -i 'api[_-]?key|private[_-]?key|secret|seed phrase|authorization: bearer|GRAPH_DEMO_ACCOUNT|BASE_RPC_URL=' README.md docs web api shared
~~~

Review every match manually; placeholders and server-only configuration names may remain, but no credential, private infrastructure or undisclosed account data may be committed.

- [ ] **Step 5: Stop at the founder review gate.**

Report changed behavior, commands, evidence labels, residual gaps, files and local commit status in Ukrainian. Do not commit, push, deploy, submit, pay for AI, or perform wallet actions until the founder explicitly approves the next operation.

Proposed commit grouping after review:

~~~text
feat: add bounded exposure plan contract
feat: validate and repair bounded exposure plans
feat: add plan repair decision console
feat: coordinate shared exposure reservations
feat: explain dependency impact and what-if state
feat: add read-only exposure plan tool boundary
docs: record plan coordination acceptance evidence
~~~

## Self-review checklist

- [x] Every new action has an exact accounting effect and a stated execution limitation.
- [x] The canonical .4/.4 fixture and .2/.1 repair are computed by the engine.
- [x] Aave evidence remains a dependency for the total-cap predicate even for direct-only plans.
- [x] Reservation admission is atomic, idempotent and separate from read-only evaluation.
- [x] Withdrawals do not free capacity before paper execution.
- [x] Task 4A runtime generations isolate internal reservations without changing the legacy permit contract.
- [ ] The Task 5 what-if overlay preserves the original snapshot and does not fabricate a live incident.
- [ ] The Task 6 read-only planner tool is separate from the legacy external-AI trace and cannot mutate authorization state.
- [x] The mockup checkpoint covers desktop and narrow layouts with concrete fixture values and no clipped decisions.
- [x] The plan does not claim global optimality, durable coordination, production readiness or on-chain execution.
- [x] No new paid AI call is part of the implementation or verification sequence.
