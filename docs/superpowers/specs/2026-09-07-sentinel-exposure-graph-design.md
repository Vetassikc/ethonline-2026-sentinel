# Sentinel Exposure Graph Design

Date: 2026-09-07
Status: source-qualified narrow design; implementation follows in the event branch.

## Goal

Extend Sentinel's Position Evidence slice into one reproducible, bounded
workflow in which an agent requests additional `wstETH` exposure, The Graph
identifies an Aave supply position, a read-only Base RPC validates the exact
same-block balances and Aave index, Sentinel exposes both holding paths in an
attributable graph, derives an admissible amount from an operator cap, signs a
demo permit, and a cooperating paper executor rechecks the relevant conditions.

This is a prototype decision boundary. It is not investment advice, an audit,
a USD portfolio model, on-chain revocation, or protection outside the
cooperating paper executor.

## Source qualification

The configured Graph source is the public Aave V3 Base subgraph with
subgraph ID `GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF`, configured chain
ID `8453`, and the Graph Explorer label/version `Aave V3 Base v0.0.5`. The
live provider returned a fresh `_meta` block with no indexing errors and a
complete seven-row `UserReserve` account query during this investigation.

The supported case is the Base bridged wstETH token documented by Lido at
`0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452`, with 18 decimals. The live
Graph row supplied the wstETH underlying and Aave aToken relations. At the
same indexed block, a read-only Base RPC confirmed:

- the Graph block hash and timestamp matched the RPC block;
- the account held a positive direct wstETH balance;
- the account held a positive Aave aToken claim;
- the aToken pointed to the same wstETH underlying and used the same decimals;
- the Graph `scaledATokenBalance` matched the contract's scaled balance.

The Graph `currentATokenBalance` did not match the contract balance. The
adapter therefore must not use that field as an exact current quantity. It
uses the Graph scaled balance and calls Aave's
`getReserveNormalizedIncome(underlying)` at the Graph block, then applies
Aave Ray multiplication:

```text
normalized_supply = floor((scaled_balance * normalized_income + 0.5e27) / 1e27)
```

The configured source still exposes `priceInEth` with a stale/zero price
timestamp for this case. USD valuation remains unavailable and is not part of
the supported policy. The resulting source decision is **NARROW**: proceed in
explicit `wstETH` units, keep oracle data visible as non-required context, and
deny any request that needs an unsupported asset, conversion, or source.

## Alternatives considered

1. **Keep Position Evidence only.** This preserves a strong fail-closed
   fallback but never produces a useful positive bounded decision.
2. **Build the narrow wstETH Exposure Graph.** This is the selected approach:
   Graph data changes the account exposure calculation, RPC validates the
   same-block contract quantities, and the paper executor demonstrates
   execution-time revalidation.
3. **Add a USD oracle pipeline first.** This would broaden the source surface
   without a currently qualified feed and would delay the complete scenario.

The selected approach does not generalize the arithmetic to swaps, leverage,
borrow/withdraw actions, or arbitrary bridges.

## Supported action contract

The new public request is versioned as `sentinel-exposure-buy.v1`:

```json
{
  "schema_version": "sentinel-exposure-buy.v1",
  "action": "BUY_EXPOSURE",
  "asset": "wstETH",
  "unit": "wstETH",
  "requested_units": "2.000000000000000000"
}
```

The account, chain, Graph deployment, RPC host and operator limit remain
server-owned. The request does not describe a venue, quote, funding asset or
on-chain transaction. It authorizes only a bounded paper exposure action.
Fees, slippage and output conversion are therefore outside this first action
policy rather than silently assumed.

The operator policy is `exposure-wsteth-v1` with a server-side dependency cap
of `1.000000000000000000 wstETH` by default. The cap is configurable only by
server configuration; a model or browser request cannot change it.

## Architecture and data flow

```text
validated exposure request
  -> fixed Graph UserReserve query (live source)
  -> same-block Base RPC reads (direct balance, aToken relation, normalized income)
  -> typed graph with two economic paths
  -> exact wstETH exposure arithmetic and operator cap
  -> server-held evaluation reference
  -> EIP-712 demo permit for the bounded action
  -> paper executor refreshes Graph + RPC and rechecks relevant conditions
```

### Source adapter

Extend `graph-client.ts` only with fields needed to identify the supported
case: `scaledATokenBalance`, `reserve.aToken`, and the Aave pool address. Keep
the fixed query, cursor pagination, common block detection, server-side Graph
bearer authentication, bounded timeouts, and sanitized errors.

Add a small fixed-host Base RPC adapter. It accepts only the server-selected
block, account, underlying, aToken and Aave pool returned by the validated
source. It must validate address shapes, chain identity, response shapes and
contract relationships. It must never accept a browser/model URL. Required
reads are `balanceOf`, `scaledBalanceOf`, `UNDERLYING_ASSET_ADDRESS`,
`decimals`, `getReserveNormalizedIncome`, `eth_getCode`, and the selected
block header.

### Attributable graph

Use deterministic IDs and typed nodes:

- `account` — the server-configured observation subject;
- `holding` — direct wstETH balance;
- `protocol_position` — the Aave wstETH supply claim;
- `asset` — the exact Base bridged wstETH contract;
- `protocol` — Aave V3 Base.

Use typed edges such as `holds`, `supplied_claim_on`, and `uses_pool`. Each
quantitative edge carries source kind, source field or contract read,
deployment/chain, observation block, transformation and explicit unit. The
two paths converge on one asset node. A receipt claim is not added as another
capital path. Debt, if present, is a separate observation and is never netted
against gross exposure.

The graph builder rejects missing required edges, unsupported assets, invalid
decimals, duplicate path IDs, inconsistent blocks, and failed aToken-to-
underlying validation. Unknown optional dependencies remain visible as gaps;
they do not become inferred risk or trust relationships.

### Exact policy

All quantities use non-negative integer raw units at 18 decimals. The policy
computes:

```text
gross_exposure = direct_wsteth_balance + normalized_aave_supply
headroom = max(operator_cap - gross_exposure, 0)
allowed = min(requested_units, headroom)
```

Missing/stale/inconsistent required inputs produce `DENY`. A zero headroom
produces `DENY`; a positive amount below the request produces
`ALLOW_WITH_DOWNSIZE`; otherwise the request is `ALLOW`. The response includes
requested, allowed, cap, gross exposure, headroom, binding constraint, policy
version, source snapshot and the graph paths responsible for the amount.

Relevant debt is displayed separately. The first action does not offset debt;
if a future action needs debt-aware netting, it must receive a new versioned
policy and explicit semantics.

### Condition-checked permit

Create a new unit-based permit schema rather than relabeling the existing
Kraken/BTC `TradeIntent`. The EIP-712 payload binds action, asset, unit,
chain/account, authorized units, operator cap, policy version, graph/evidence
hash, source snapshot, executor audience, expiry and nonce. The signer only
accepts a server-held evaluation reference whose policy is authorizing; it
never signs browser/model-supplied evidence or an asserted ALLOW.

The server owns an in-memory evaluation store, consumed nonce set and
per-account pending reservation set. Evaluation references expire. Paper
execution verifies the signature without consuming it, refreshes Graph and
RPC conditions, and consumes the nonce only after all current checks pass.
Restart loses this state and is explicitly labeled. One pending action per
account is allowed in the demo boundary.

Execution compares relevant conditions, especially account/action/asset,
policy version/cap, required source quality, and current available headroom.
An updated block or unrelated graph hash alone does not invalidate a permit;
current headroom below the authorized amount does. A valid old signature plus
failed current conditions must return a precise non-authorizing result.

## Public route surface

Keep all existing routes unchanged. Add:

- `GET /exposure-graph` — the single-screen demo;
- `GET /api/exposure/config` — server-owned supported action and operator cap;
- `POST /api/exposure/evaluate` — validated request to live graph/policy;
- `POST /api/exposure/permit` — evaluation reference to a demo permit;
- `POST /api/exposure/verify` — pure signature/binding inspection, no nonce use;
- `POST /api/exposure/paper-execute` — fresh live check and one-time consume;
- `POST /api/exposure/replay` — clearly labeled local fixture replay for the
  changed-headroom story, never presented as live evidence.

All bodies are bounded and strictly validated. Provider failures return a
non-authorizing result and clear stale UI state. No route accepts arbitrary
GraphQL, RPC URLs, account subjects, policy objects or evidence hashes from a
browser/model request.

## AI boundary

Replace the scenario-name tool input with a restricted request tool accepting
only the versioned purchase fields. It returns the validated request, fixed
query plan, source-derived graph and policy explanation. It cannot choose the
account, chain, policy, URL, signer or execution route.

This repository will document the tool as an integration boundary and will not
claim an external model/MCP invocation until an actual configured AI client
invokes it and the trace is recorded. A local CLI smoke is tool validation,
not evidence of a genuine natural-language model flow.

## UI

The new screen has three primary areas: request/operator cap, the two-path
graph with clickable evidence details, and requested versus allowed units with
the binding reason. Permit issuance, pure verification, live paper execution,
and a `REPLAY — synthetic headroom exhausted` state are secondary but visible.
Live and replay data are never rendered under the same label.

## Verification requirements

Tests must cover source pagination/common block, RPC shape and contract
relations, Ray normalization, exact decimal boundaries, two-path aggregation,
no receipt/underlying double count, debt non-netting, stale/missing source,
unsupported request arguments, permit bindings/expiry/audience, server-owned
evaluation references, pure verification versus nonce consumption, replay and
concurrent account reservation, changed relevant headroom, and unchanged
irrelevant metadata.

The full regression suite must keep historical judge/operator behavior green.
The live acceptance run must show one positive bounded wstETH case from the
configured public account without recording its address or portfolio values in
tracked fixtures. The external AI invocation remains a separately labeled
gate until a real client is configured.

