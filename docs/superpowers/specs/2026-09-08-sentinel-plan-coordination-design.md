# Sentinel Plan Validation, Dependency Impact, and Shared Budget Design

Date: 2026-09-08
Status: integrated design; Tasks 1-2 implementation checkpoint authorized; later extension tasks remain gated

## Goal

Extend the existing Sentinel Exposure Graph into one bounded decision workflow:

> An agent proposes a structured plan. Sentinel replays its effects against
> source-backed exposure and policy constraints, returns a deterministic full,
> partial, or unsatisfied result, offers a bounded repair, coordinates two
> allowlisted agents against one shared budget, and rechecks the accepted plan
> before paper execution.

The existing single-action live graph, permit, paper-execution and external
AI/tool evidence remain available as the continuity baseline. The extension is
not a generic trading platform, multi-agent orchestrator, risk score, or
on-chain executor.

## Current baseline and constraints

- Supported evidence remains Base Mainnet, wstETH, direct holdings and Aave
  V3 supply through the existing Graph/RPC same-block adapter.
- Quantities remain non-negative exact integer strings at 18 decimals.
- The existing live source may show `usd_valuation_unavailable`,
  `stale_oracle_price`, and the unresolved historical Aave `+1` raw-unit
  mismatch. The extension must not add tolerance or invent USD values.
- Existing `BUY_EXPOSURE` permits and nonce/fresh-condition checks remain
  unchanged for the current demo route until the plan authorization envelope
  is separately introduced and verified.
- New plan state is process-local for the hackathon slice. Every new plan
  authorization binds a runtime generation and is invalid after restart.
  Durable coordination is not claimed.
- Mutating plan actions are operator-session actions, not model-tool actions.
  Same-origin and CSRF checks protect the local demo boundary, but this is not
  production authentication or a founder-only HTTP security claim.
- No plan action accepts an account, token address, venue, URL, calldata,
  signer, policy object, quote asset or provider configuration from a caller.

## Aave mismatch audit gate

The historical `rpc_aave_balance_mismatch` remains a source-consistency
failure, not a reason to weaken the check. Before proposing any provider or
adapter change, inspect the exact deployed contract arithmetic, rounding and
same-block read semantics. The audit must preserve raw integer tuples only in
local diagnostics and publish sanitized conclusions:

- `api/app/base-rpc.ts` currently computes normalized supply with exact
  half-up Ray arithmetic, `(scaled_supply * normalized_income +
  HALF_RAY) / RAY`.
- The relevant `eth_call` reads must use one explicit block tag matching the
  Graph observation block: aToken identity/underlying, `scaledBalanceOf`,
  `balanceOf`, and Pool `getReserveNormalizedIncome`.
- Compare `scaled_supply`, `normalized_income`, derived normalized supply and
  `aaveBalance` as exact integers. Classify a one-raw-unit difference as
  `rpc_aave_balance_mismatch` until deployed code and read semantics
  demonstrate the cause.
- Do not add tolerance, floor/ceil changes, provider switching or a bypass as
  an “incident fix”. A new block/hash by itself is not proof of cause.
- Keep account identifiers, raw account-specific tuples, endpoints and
  credentials out of committed/public artifacts. Record only sanitized error
  codes, contract identity conclusions, arithmetic formula and whether the
  cause is established or unknown.

This audit is a separate live-source acceptance limitation. An unresolved
upstream mismatch does not block independent schema validation or the pure
deterministic plan engine. It does block any provider, rounding or tolerance
change until the cause is established and reviewed.

## Product model

The three new capabilities share one state model:

```text
server-owned source snapshot
        |
        v
plan goal + ordered bounded steps + agent identity
        |
        v
deterministic intermediate-state replay
        |
        +--> full / partial / unsatisfied / blocked
        |         |
        |         +--> bounded repaired candidate (operator review only)
        |
        +--> dependency impact graph and what-if overlay
        |
        +--> operator acceptance
                    |
                    v
          atomic shared-budget reservation
                    |
                    v
        plan-bound paper permit and fresh recheck
                    |
                    v
             paper overlay + event timeline
```

The model tool and the browser may propose only the structured goal and
candidate plan. The server owns the observed account, policy, sources, signing
key, runtime generation and execution boundary. A read-only question never
creates a reservation. An explicit operator action may request server-
controlled validation, reservation, signing or paper execution through the
same-origin operator session; the browser never receives signing secrets or
chooses account/policy values.

## Main-screen wireframe

The existing `/exposure-graph` route remains the entry point. The first screen
composition should become a decision console rather than a sequence of JSON
panels:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Sentinel Exposure Graph   LIVE SOURCE · Base 8453 · snapshot/freshness        │
│ account: server-configured                         policy: 1.0 / Aave 0.5     │
├──────────────────────┬──────────────────────────────────┬─────────────────────┤
│ INTENT                │ DEPENDENCY GRAPH                 │ DECISION            │
│ Goal: supply ≤ 0.30   │ account                          │ FULL / PARTIAL /     │
│ Agent: Agent A        │   ├─ direct wstETH ──────┐       │ UNSATISFIED / BLOCKED│
│                       │   └─ Aave supply ────────┼─ wstETH│ violated predicates │
│ Proposed plan        │      └─ Aave pool         │       │ headroom / caps     │
│ 1. acquire 0.30      │                             │       │ repair candidate    │
│ 2. supply 0.30       │ [click path for provenance]  │       │ [Accept repair]     │
│                       │ before → after quantities   │       │ [Reject]            │
├──────────────────────┴──────────────────────────────────┴─────────────────────┤
│ SHARED BUDGET                                                                  │
│ total headroom 0.20  | Agent A 0.15 RESERVED | Agent B 0.05 AVAILABLE          │
│ reservations: state · expiry · evidence · affected permit                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ EVENT TIMELINE                                                                 │
│ source snapshot → plan validated → repair proposed → accepted → executing     │
│ → paper-executed / rejected / invalidated                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ secondary details: source fields, raw units, hashes, JSON, limitations         │
└──────────────────────────────────────────────────────────────────────────────┘
```

Visible badges must distinguish `LIVE SOURCE`, `RECORDED`, `WHAT-IF`,
`FIXTURE`, and `PAPER`. A what-if overlay never replaces the original source
snapshot. Raw units and JSON remain progressive-disclosure details.

Reviewable visual mockups for the three curated states, including desktop and
narrow layouts, are in
`docs/superpowers/mockups/sentinel-plan-coordination-mockups.html` and the
captured previews in
`output/playwright/sentinel-plan-coordination-desktop.png` and
`output/playwright/sentinel-plan-coordination-mobile.png`. They are design
artifacts, not the production route; the screenshots contain only controlled
fixture values.

## Exact plan contract

Add a separate versioned plan contract instead of overloading the current
single-purchase request:

```ts
export const EXPOSURE_PLAN_SCHEMA_VERSION = "exposure_plan.v1" as const;

export type ExposureAgentId = "agent_a" | "agent_b";

export type ExposureGoalKind =
  | "acquire_up_to"
  | "supply_up_to"
  | "reduce_aave_exposure"
  | "reduce_total_exposure";

export type ExposurePlanAction =
  | { kind: "acquire_wsteth"; units: string }
  | { kind: "supply_aave"; units: string }
  | { kind: "withdraw_aave_to_wallet"; units: string };

export type ExposurePlanV1 = {
  schema_version: typeof EXPOSURE_PLAN_SCHEMA_VERSION;
  agent_id: ExposureAgentId;
  goal: { kind: ExposureGoalKind; target_units: string };
  steps: ExposurePlanAction[]; // one to three ordered steps
};

export type ExposurePlanValidation =
  | { ok: true; plan: ExposurePlanV1 }
  | { ok: false; error: { code: "invalid_exposure_plan"; details: string[] } };
```

The validator accepts exactly the fields above, one of the two agent IDs, one
to three steps, fixed-point quantities with at most 18 decimals, and no empty
or zero step. It rejects unknown fields, duplicate/reordered step metadata,
custom accounts, contracts, URLs, chains, policy overrides and unsupported
actions.

### Action semantics

All effects are calculated in the server snapshot's wstETH units:

| Action | Direct available | Aave exposure | Total underlying | Execution claim |
| --- | ---: | ---: | ---: | --- |
| `acquire_wsteth` | `+q` | `0` | `+q` | modeled purchase; funding/venue unverified |
| `supply_aave` | `-q` | `+q` | `0` | modeled transfer; no wallet transaction |
| `withdraw_aave_to_wallet` | `+q` | `-q` | `0` | hypothetical until liquidity/health checks are established |

`withdraw_aave_to_wallet` reduces Aave exposure but does not reduce total
wstETH exposure. No supported action reduces total exposure in this slice.
`reduce_total_exposure` remains a supported goal so the engine can honestly
return `UNSATISFIED`/`NO_SUPPORTED_REPAIR` instead of inventing a disposal
action. Debt is never netted against exposure. If debt is present,
debt-sensitive withdrawals are blocked as unsupported rather than treated as
executable. `acquire_wsteth` adds the real-transaction precondition
`purchase_funding_unverified`; `withdraw_aave_to_wallet` adds an unverified
liquidity/health precondition. These preconditions make the real transaction
status `UNVERIFIED`, but do not make an explicitly eligible local paper
session ineligible. A modeled acquisition can therefore be paper-authorized
without claiming a funded swap.

### Goals and satisfaction

- `acquire_up_to`: net increase in total underlying units.
- `supply_up_to`: net increase in Aave exposure units.
- `reduce_aave_exposure`: decrease in Aave exposure units.
- `reduce_total_exposure`: decrease in total underlying units.

The goal is never silently replaced. Goal satisfaction and authorization are
separate outputs:

```ts
type ExposurePolicyStatus = "PASS" | "VIOLATION" | "BLOCKED";
type ExposureGoalStatus = "FULL" | "PARTIAL" | "UNSATISFIED";
type ExposureSourceProvenance = "LIVE_SOURCE" | "FIXTURE" | "REPLAY" | "MODELED";
type ExposurePaperEligibility = "ELIGIBLE" | "INELIGIBLE";
type ExposureRealTransactionStatus = "NOT_REQUIRED" | "UNVERIFIED" | "BLOCKED";
type ExposureExecutionMode = "PAPER_AUTHORIZABLE" | "BLOCKED";
```

`ExposurePolicyStatus` answers whether every intermediate state satisfies the
configured policy. `ExposureGoalStatus` answers only how much of the requested
goal the candidate achieves. `ExposureSourceProvenance` labels where the
starting state came from; it does not assert that a modeled action was funded.
`ExposurePaperEligibility` answers whether this exact result may enter an
explicitly eligible local paper session. `ExposureRealTransactionStatus`
answers only whether real wallet/protocol preconditions are established.
Every supported action records its own real-transaction uncertainty when
relevant: acquire requires `purchase_funding_unverified`, supply requires
`aave_supply_approval_and_execution_unverified`, and withdrawal requires
`aave_liquidity_and_health_unverified`. Therefore `NOT_REQUIRED` is reserved
for plans with no supported real-action prerequisite; it never means a supply
or withdrawal is production-ready.
`ExposureExecutionMode` is `BLOCKED` for policy violations, unsupported
preconditions or an `UNSATISFIED` goal, and `PAPER_AUTHORIZABLE` only when
policy passes, the goal is `FULL` or an explicitly accepted `PARTIAL`, the
paper session is eligible, and the local paper effects are supported.
Paper-authorizable never means funded, wallet-executable or production-ready.

Targets are upper bounds because all goal names end in `_up_to` or describe a
requested reduction. A candidate that would exceed `target_units` is blocked
with `GOAL_TARGET_OVERSHOT`; the repair clamps the final monotonic step to the
target. A positive target with zero progress is `UNSATISFIED` and cannot be
accepted. `UNSATISFIED` candidates never receive a reservation or permit.
`PARTIAL` candidates require an explicit operator `accept_partial: true`; the
read-only evaluator never accepts them automatically. Before that explicit
acceptance, the candidate remains `paper_eligibility: "INELIGIBLE"` and
`execution_mode: "BLOCKED"`. Re-evaluating the same exact candidate with
`accept_partial: true` may return `paper_eligibility: "ELIGIBLE"` and
`execution_mode: "PAPER_AUTHORIZABLE"` without changing source provenance or
claiming real transaction preconditions.

## Read-only planner AI boundary

The extension adds one bounded local planner interface for schema and dispatch
testing. It is a proposal/evaluation tool, not an agent-control surface:

```ts
export const EXPOSURE_PLAN_TOOL_NAME = "sentinel_exposure_plan" as const;
export const EXPOSURE_PLAN_TOOL_SCHEMA = "sentinel-exposure-plan-tool.v1" as const;

export type ExposurePlanToolInput = {
  schema_version: typeof EXPOSURE_PLAN_TOOL_SCHEMA;
  action: "PROPOSE_EXPOSURE_PLAN";
  agent_id: ExposureAgentId;
  goal: { kind: ExposureGoalKind; target_units: string };
  steps: ExposurePlanAction[];
};

export type ExposurePlanToolResult = {
  tool_name: typeof EXPOSURE_PLAN_TOOL_NAME;
  schema_version: typeof EXPOSURE_PLAN_TOOL_SCHEMA;
  validation: ExposurePlanValidation;
  evaluation: ExposurePlanEvaluation | null;
  repair: ExposureRepairResult | null;
};
```

The server maps the validated proposal to the current server-owned evaluation
and policy. The tool input must not contain an evaluation reference, account,
chain, token, provider URL, signer, policy object, operator session, or
execution mode. The tool can only return validation, replay, evaluation and a
bounded repair candidate. It cannot reserve, accept, cancel, sign, issue a
permit, or execute. It never receives the operator cookie. The existing
external-AI trace remains evidence for the legacy
`sentinel_exposure_graph` read-only tool only; a real external call to this new
planner is a separate approval gate and is not part of this design review.

## Deterministic effects and repair

The plan engine starts from this exact state:

```ts
export type ExposureAccountingState = {
  direct_available_raw: bigint;
  aave_exposure_raw: bigint;
  total_exposure_raw: bigint;
  debt_raw: bigint;
  dependency_cap_raw: bigint;
  aave_cap_raw: bigint;
};

export type ExposurePlanResourceRequirements = {
  peak_total_increase_raw: bigint;
  peak_aave_increase_raw: bigint;
  required_preexisting_direct_raw: bigint;
  required_preexisting_aave_raw: bigint;
  internal_acquired_consumed_raw: bigint;
};

export type ExposurePlanPolicy = {
  policy_version: "exposure-plan-wsteth-v1";
  dependency_cap_units: string;
  aave_cap_units: string;
  unit: "wstETH";
};

export type ExposureReservationDelta = {
  reservation_id: string;
  agent_id: ExposureAgentId;
  peak_total_increase_raw: bigint;
  peak_aave_increase_raw: bigint;
  required_preexisting_direct_raw: bigint;
  required_preexisting_aave_raw: bigint;
  status: "accepted_reserved" | "executing";
};

export type ExposureReplayCompleteness = "COMPLETE" | "STOPPED_ON_VIOLATION" | "INVALID";

export type ExposureDiagnosticProjection = {
  status: "COMPLETE" | "UNAVAILABLE";
  projected_final_state: ExposureAccountingState | null;
  intermediate_states: ExposureAccountingState[];
  violations: Array<{ step_index: number; code: string; before: ExposureAccountingState; after: ExposureAccountingState }>;
  unevaluated_step_indices: number[];
  reason: string | null;
};

export type ExposurePlanEvaluation = {
  source_provenance: ExposureSourceProvenance;
  policy_status: ExposurePolicyStatus;
  goal_status: ExposureGoalStatus;
  paper_eligibility: ExposurePaperEligibility;
  real_transaction_status: ExposureRealTransactionStatus;
  execution_mode: ExposureExecutionMode;
  plan_hash: string;
  original_steps: ExposurePlanAction[];
  initial_state: ExposureAccountingState;
  final_state: ExposureAccountingState;
  final_state_semantics: "COMPLETE_REPLAY" | "PARTIAL_REPLAY";
  replay_completeness: ExposureReplayCompleteness;
  unevaluated_step_indices: number[];
  diagnostic_projection: ExposureDiagnosticProjection;
  intermediate_states: ExposureAccountingState[];
  violations: Array<{ step_index: number; code: string; before: ExposureAccountingState; after: ExposureAccountingState }>;
  fulfilled_units: string;
  target_units: string;
  execution_preconditions: string[];
  real_transaction_preconditions: string[];
  resource_requirements: ExposurePlanResourceRequirements;
};

export type ExposureRepairResult = {
  status: "FULL" | "PARTIAL" | "UNSATISFIED" | "NO_SUPPORTED_REPAIR";
  repair_algorithm: "left_to_right_max_feasible_v1";
  candidate: ExposurePlanV1 | null;
  evaluation: ExposurePlanEvaluation | null;
  changes: Array<{ step_index: number; requested_units: string; repaired_units: string }>;
};

export type ExposurePlanEvaluationOptions = {
  source_provenance?: ExposureSourceProvenance;
  paper_session_eligible?: boolean;
  accept_partial?: boolean;
};
```

The new server-owned plan policy defaults to a total dependency cap of
`1.000000000000000000` wstETH and an Aave protocol cap of
`0.500000000000000000` wstETH. These are separate from the existing
single-purchase policy version and are not caller-configurable.

An existing Aave balance above the Aave cap is an already-observed policy
condition, not newly reservable capacity. Additional Aave capacity checks use
the capped baseline `min(initial_aave_exposure, aave_cap)` plus active
reservations and the candidate's positive peak increase. The post-step Aave
state must still be at or below the cap. This permits a debt-free withdrawal
that restores an existing over-cap state while preventing that over-cap amount
from being lent to another pending plan.

For every original and candidate step, the engine applies the effect first,
then checks:

1. direct available units are non-negative;
2. Aave exposure is non-negative and no greater than the Aave cap;
3. total underlying exposure is non-negative and no greater than the total cap;
4. a transfer has not spent direct units reserved by another accepted plan;
5. unsupported debt-sensitive or execution preconditions are reported;
6. the goal satisfaction is computed from the final state, not inferred from
   the requested quantity.

Authorization replay is fail-closed and stops at the first violation. Its
`final_state` is therefore a replayed state, not a complete-plan state unless
`replay_completeness` is `COMPLETE`; `unevaluated_step_indices` identifies the
steps that were not replayed. Separately, `projectExposurePlan()` may produce
an explicitly diagnostic projection. It can continue through cap-only
violations when arithmetic, inventory and action semantics remain valid, but
it returns `UNAVAILABLE` at malformed input, unsupported actions, debt-sensitive
withdrawals or impossible inventory. Diagnostic projections are never used to
authorize, reserve, issue a permit or apply paper effects.

For the canonical `.30 acquire -> .30 supply` fixture, authorization replay
stops after the acquire step at total `1.10 > 1.00` and marks the supply step
unevaluated. The separate diagnostic projection evaluates the supply step and
reports total `1.10 > 1.00` plus Aave `0.70 > 0.50`; those projected values are
not executable candidate values.

The repair algorithm is deliberately bounded and greedy:

1. preserve the goal, action order and action kinds;
2. visit steps left-to-right;
3. clamp each step to the largest non-negative quantity that is valid for the
   state immediately before and after that step;
4. never use a later, unexecuted withdrawal to free capacity for an earlier
   step;
5. remove a step only when its clamped quantity is zero and record the change;
6. return one candidate, with `repair_algorithm: "left_to_right_max_feasible_v1"`.

The quantity search does not assume that feasibility starts at zero. For a
withdrawal, an existing over-cap Aave state may require a positive minimum
quantity before the candidate becomes policy-valid. The repair checks that
restoration lower bound first and then searches the feasible interval; it does
not treat an infeasible zero-quantity probe as proof that no larger quantity
can work.

This is not a global optimum claim. A repair with no positive feasible step
returns `NO_SUPPORTED_REPAIR`. For the canonical synthetic state
`direct=0.4`, `aave=0.4`, `total_cap=1.0`, `aave_cap=0.5`, and proposed
`acquire 0.3` then `supply 0.3`, the engine must produce the candidate
`acquire 0.2` then `supply 0.1`, with final direct `0.5`, Aave `0.5`, total
`1.0`, and a `PARTIAL` supply goal. These values must come from the engine,
not UI constants.

## Dependency impact and what-if overlay

Economic exposure, data evidence and authorization are separate layers:

```ts
export type ExposureDependencyLayer =
  | "economic_exposure"
  | "data_evidence"
  | "authorization";

export type ExposureDependencyEdge = {
  id: string;
  layer: ExposureDependencyLayer;
  from: string;
  to: string;
  relation: string;
  status: "established" | "modeled" | "hypothetical";
  evidence_ref: string | null;
  explanation: string;
};
```

Every material edge either carries existing graph provenance/evidence or is
explicitly `modeled`/`hypothetical`. No reputation, incident, bridge, oracle
or risk probability is inferred.

The first what-if scenario is an allowlisted enum only:

```ts
type ExposureWhatIfScenario = "aave_evidence_unavailable";

export type ExposureSimulationSession = {
  session_id: string;
  mode: "what_if";
  parent_session_id: string;
  base_evaluation_ref: string;
  base_graph_hash: string;
  reservations_copy: string[];
  simulated_permits_copy: string[];
  revision: number;
};
```

`POST /api/exposure/what-if` accepts exactly
`{ "evaluation_ref": "exposure_<32 hex>", "scenario":
"aave_evidence_unavailable" }` and creates a separate immutable simulation
session/fork over a stored evaluation. The fork copies reservations and
simulated permit checks for analysis only; it never mutates, releases or
re-accepts anything in the original session. It marks the Aave evidence
predicate unavailable, leaves the original block/hash and policy result
intact, and returns:

- predicates that can no longer be established;
- plans requiring refresh or becoming blocked;
- affected reservations and plan permits;
- a path such as `UserReserve -> total exposure cap -> accepted plan -> permit`.

The response includes `simulation_session_id` and `mode: "what_if"`. Any
simulation execute/permit route must reject that mode with
`SIMULATION_NOT_EXECUTABLE` at the original execution boundary. This is not
the dependency-impact proof by itself. The what-if evaluator must run the same
read-only condition evaluator once against the original context and once
against the forked context, then return the changed predicate and causal
reason, for example:

```ts
{
  predicate: "total_exposure_cap",
  original: { status: "established", reason: "aave_user_reserve_available" },
  forked: { status: "unavailable", reason: "aave_evidence_unavailable" }
}
```

Only the affected dependency predicates become unavailable/blocked. The
simulation session remains non-authorizing, while the original live operator
session remains unchanged and is the only session that can request a
server-controlled paper action.

A direct-only plan is still affected because the total exposure cap depends on
the Aave evidence path. The overlay is never presented as a live incident, and
an EIP-712 signature may remain cryptographically valid while the cooperating
executor rejects it for current conditions.

## Shared budget and reservation lifecycle

Only `agent_a` and `agent_b` cooperate under one server-owned account and
policy. The shared resource ledger reserves total-cap increase, Aave-cap
increase and direct inventory spend independently. The read-only model/tool
path cannot mutate this ledger.

```ts
export type ExposureReservationState =
  | "proposed"
  | "accepted_reserved"
  | "executing"
  | "paper_executed"
  | "rejected"
  | "cancelled"
  | "expired"
  | "invalidated"
  | "requires_re_evaluation";

export type ExposureReservationV1 = {
  reservation_id: string;
  plan_hash: string;
  agent_id: ExposureAgentId;
  policy_version: string;
  evidence_ref: string;
  graph_hash: string;
  peak_total_increase_units: string;
  peak_aave_increase_units: string;
  required_preexisting_direct_units: string;
  required_preexisting_aave_units: string;
  internal_acquired_consumed_units: string;
  state: ExposureReservationState;
  runtime_generation: string;
  source_provenance: ExposureSourceProvenance;
  idempotency_key: string;
  created_at: string;
  expires_at: string;
  capacity_release_event_id: string | null;
};
```

Transitions are explicit and idempotent:

```text
proposed --accept--> accepted_reserved --begin--> executing
proposed --reject--> rejected
accepted_reserved --cancel--> cancelled
accepted_reserved --expiry--> expired
accepted_reserved --what-if/source change--> invalidated or requires_re_evaluation
executing --all paper steps pass--> paper_executed
executing --refresh/step failure--> rejected
```

Admission is one synchronous state mutation after validation. It computes
available capacity from the paper overlay plus active reservations and all
intermediate resource requirements, then either stores the reservation or
returns `SHARED_CAPACITY_INSUFFICIENT`. The shared-headroom fixture uses two
`acquire_up_to` plans of `.15` against `.20` total headroom: the first reserves
`.15` with `peak_aave_increase = 0`, and the second is rejected with only `.05`
remaining. Protocol-cap contention is a separate fixture: `supply_aave .15`
from Aave `.40` would make Aave `.55` and is rejected. Two withdrawals of the
same Aave inventory cannot both be reserved. A supply followed by withdrawal
keeps its peak Aave increase reservation even when its final Aave delta is
zero. An acquire followed by supply distinguishes internally acquired modeled
inventory from consumption of pre-existing direct inventory. The second agent
may receive a separately displayed bounded alternative, but that alternative
is not reserved until the operator accepts it.

Admission always revalidates the plan against the current effective state. The
plan's own reservation is excluded from its execution recheck by reservation
ID; all other active reservations and the paper overlay remain included. An
idempotency key reused with a different plan returns
`IDEMPOTENCY_KEY_CONFLICT`, never the first plan's result.

An idempotency receipt is lifecycle-aware. While its reservation is
`accepted_reserved` or `executing`, the receipt is retained even when the
configured retention interval is shorter than the reservation TTL. The
bounded retention interval starts when the reservation becomes terminal
(`cancelled`, `expired`, `invalidated`, `rejected` or `paper_executed`). A
terminal replay returns a non-authorizing historical result during that
interval; it never recreates or implicitly revalidates the reservation. If a
bounded idempotency store contains only protected active receipts, a new key
is rejected explicitly rather than evicting one of those receipts.

The source-update boundary preserves active reservations for an ordinary
same-session, same-mode, same-generation refresh. A context rotation changes
session, mode or runtime generation, explicitly transitions active records to
`invalidated` while retaining their historical records, and makes old
acceptance-shaped replays fail the current context checks.
Changing source provenance is also a reservation boundary: active records are
invalidated and a new operator session must explicitly accept the new
provenance. A block/hash change within the same provenance remains compatible
when all qualified quantities and context checks still pass.

Reservation identity binds:

- plan hash and exact ordered actions;
- goal and agent ID;
- server-owned subject/account and policy version;
- evidence reference and graph hash;
- reserved resource deltas;
- runtime generation, audience, expiry and idempotency key.

Capacity is released through one transition handler with a stored release
event ID. Cancellation, expiry, invalidation and failed execution release
exactly once. Successful paper execution releases the pending reservation only
after applying its net paper delta to the overlay; the overlay then accounts
for the resulting exposure and prevents double counting. An unexecuted
withdrawal never releases total-cap capacity.

The paper overlay has a session ID, base graph hash, a monotonically increasing
state revision and append-only in-memory events. The awaited provider refresh
does not hold the critical section. Instead, execution records the reservation
version and state revision before refresh; after refresh a synchronous commit
checks runtime generation, reservation version, current effective quantities,
relevant identities, policy predicates and the exclusion of its own
reservation. If any changed, execution returns
`STATE_CHANGED_REQUIRES_REEVALUATION` without consuming nonce, releasing
capacity or mutating the overlay. Otherwise one all-or-nothing commit applies
the complete plan, consumes the nonce, appends the paper event, transitions the
reservation and releases capacity in one state replacement.

A new block/hash alone does not invalidate a plan when relevant quantities,
identities and policy conditions remain acceptable. If live holdings or other
relevant quantities change while a paper overlay exists, the session is marked
`PAPER_SESSION_REBASE_REQUIRED`; live and simulated values are never blindly
merged. The operator must explicitly start a new paper session, which freezes
the old evidence and invalidates its outstanding plan authorizations.

On process restart, the runtime generation changes, maps and overlay are lost,
and all old plan reservations/permits fail with
`RUNTIME_RESTART_INVALIDATED`. The UI must show that this is process-local
state rather than durable authorization.

## Plan-bound authorization boundary

Keep the historical `sentinel-exposure-permit.v1` route for the existing demo.
Add a separate plan permit envelope for the extension so the new fields do not
silently change the baseline contract:

```ts
export type ExposurePlanPermitPayload = {
  schema_version: "sentinel-exposure-plan-permit.v1";
  plan_hash: string;
  agent_id: ExposureAgentId;
  account: string; // server-derived and hidden in public UI
  policy_version: string;
  evidence_ref: string;
  graph_hash: string;
  reservation_id: string;
  session_id: string;
  mode: "live" | "what_if";
  source_provenance: ExposureSourceProvenance;
  runtime_generation: string;
  issued_at: number;
  expires_at: number;
  nonce: string;
  audience: "sentinel-exposure-plan-paper-executor";
};
```

The plan permit is issued only after operator acceptance of the exact plan or
repair candidate. Verification is pure. Paper execution checks runtime
generation, reservation state, session ID, independent source provenance,
fresh source predicates and nonce before applying the plan. Provenance is
bound separately from execution mode: `live` is not a replacement for
`LIVE_SOURCE`, and a fixture/live transition requires a new explicit context.
No model tool can sign, choose the account, change policy, cancel a reservation
or invoke execution. A browser may request those server-controlled actions
only through the explicit local operator session.

The local operator boundary is not unrestricted founder authentication:
mutating routes require a server-issued ephemeral `HttpOnly`,
`SameSite=Strict` operator-session cookie, a matching same-origin `Origin` and
`Host`, a CSRF nonce bound to that session, and no CORS allowance. Session GET
is non-destructive: a first local bootstrap is allowed without CSRF, but a
missing/stale cookie cannot rotate an existing context, and foreign `Origin`
or cross-site Fetch Metadata is rejected before state mutation. Explicit
rotation uses the authorized reset route below. The server rejects
cross-origin mutation and never exposes the signer secret. This is a demo
interaction boundary, not production access control.

The exact operator routes are:

```text
GET  /api/exposure/operator/session
POST /api/exposure/operator/session/reset
POST /api/exposure/plan/accept
POST /api/exposure/reservation/execute
POST /api/exposure/reservation/cancel
POST /api/exposure/plan/permit
POST /api/exposure/plan/verify
```

Route bodies are server-bound and exact:

```text
POST /api/exposure/plan/accept
{"evaluation_ref":"exposure_<32 hex>","plan":<ExposurePlanV1>,"idempotency_key":"<opaque client key>","accept_partial":false}

POST /api/exposure/operator/session/reset
{}

POST /api/exposure/reservation/execute
{"reservation_id":"<server id>","permit":"<plan permit>","session_id":"<server session id>","mode":"live"}

POST /api/exposure/reservation/cancel
{"reservation_id":"<server id>","reason":"operator_cancel"}

POST /api/exposure/plan/permit
{"reservation_id":"<server id>","session_id":"<server session id>","mode":"live"}

POST /api/exposure/plan/verify
{"permit":"<plan permit>","session_id":"<server session id>","mode":"live"}
```

The routes reject caller-supplied account, policy, signer, provider, chain,
token and calldata fields. `GET /api/exposure/operator/session` returns only
the opaque session ID, CSRF nonce, runtime generation, policy version and
mode; it never returns a credential or account identifier. The exact
read-only planner tool is documented separately from these operator routes.

Execution uses a server-owned injectable clock and reads it again after every
awaited source refresh. At `now_ms >= expires_at_ms`, a reservation or
operator session is expired; a permit remains valid at its integer-second
`expires_at` boundary and is expired at the next second. The commit rechecks
permit, reservation, session, runtime version and provenance together. An
expiry rejection cannot append an overlay event or consume a nonce, and any
reservation release is performed by the single idempotent lifecycle
transition.

The read-only planner tool does not receive the operator cookie.

## Curated demo cases

All three cases use the same plan engine, runtime state and UI:

1. **Repair an over-limit plan — `FIXTURE`**: canonical `.4/.4` state,
   `.3` acquire plus `.3` supply, deterministic `.2/.1` repair.
2. **Coordinate two agents — `FIXTURE`/`PAPER`**: `.2` remaining headroom,
   agent A's `acquire_up_to .15` reserves with zero Aave increase, agent B's
   independent `acquire_up_to .15` is rejected; the rejected plan is not
   silently downsized or authorized. Protocol-cap contention is shown only as
   a separate negative fixture.
3. **Dependency what-if — `WHAT-IF`**: Aave evidence becomes unavailable,
   the original source snapshot stays visible, dependent predicates and
   reservations are marked, and the permit is rejected at the cooperating
   executor boundary.

The existing live shared-dependency graph and separate paper/replay evidence
remain labeled as `LIVE`, `RECORDED`, `PAPER`, `FIXTURE`, or `REPLAY`; none of
these cases is presented as one continuous live execution.

## Largest technical risk

The largest risk is not rendering the new panels; it is preserving atomic,
auditable capacity accounting when plan validation, reservation admission,
fresh source refresh, paper overlay application and process restart interact.
The implementation must keep these facts separate: a valid signature is not a
current authorization, a modeled withdrawal does not free capacity before it
executes, and a paper effect must not be counted twice. The smallest safe
hackathon choice is process-local transactional state with explicit runtime
generation invalidation, extensive transition/invariant tests, and no claim of
durable or on-chain coordination.

## Acceptance gate for implementation

Implementation may start only after founder review confirms this design's
action semantics, two-cap policy, greedy repair ordering, process-local
restart boundary, and three demo cases. A later implementation review must
show focused tests for every state transition before visual polish or any
external model/tool change is considered.
