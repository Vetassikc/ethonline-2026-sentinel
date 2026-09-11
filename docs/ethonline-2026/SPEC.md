# Sentinel Exposure Graph v1 — implementation specification

Status: the narrow Base/wstETH source case, graph accounting, bounded request,
demo permit, fresh-condition paper executor, tool boundary, routes and
judge-readable screen are implemented. The policy is denominated in wstETH
units, not USD. One bounded external model/tool invocation is recorded
separately; MCP invocation, durable state, deployment and a public demo-account
selection remain outside the verified slice.

## User story

As an operator, I want a purchase checked against fresh, attributable
positions so that separate holdings sharing one underlying dependency do not
silently increase concentration beyond my configured cap.

## Supported scope

The first version supports exactly one read-only observation context and one
paper action:

| Item | Supported value |
| --- | --- |
| Chain | Base Mainnet, chain ID `8453` |
| Underlying | wstETH, 18 decimals |
| Action | `BUY_EXPOSURE` |
| Request unit | wstETH |
| Graph relation | Aave V3 `UserReserve` wstETH supply claim |
| Default cap | `1.000000000000000000 wstETH` |
| Request maximum | `10.000000000000000000 wstETH` |
| Execution | Local paper executor only |

This is not a general portfolio model, arbitrary swap policy, lending
execution path, liquidation engine or USD risk score.

## Source contract and qualification

The Graph is the substantive position source. Its fixed, cursor-paginated
`UserReserve` query provides the account, wstETH reserve, raw and scaled
supply, aToken relation, underlying relation, pool relation, debt and indexed
block metadata. The committed source manifest records the deployment and
public protocol identifiers without an account or balance.

At the same indexed block, the server-selected Base RPC adapter validates:

- the block number, hash and timestamp;
- wstETH contract existence and direct `balanceOf(account)`;
- aToken `balanceOf(account)`, `scaledBalanceOf(account)`, underlying address
  and decimals; and
- Aave Pool `getReserveNormalizedIncome(wstETH)`.

The normalized Aave supply is exact integer Ray multiplication of the Graph
`scaledATokenBalance` and the same-block pool index. The adapter requires the
Graph scaled value to match RPC and the normalized value to match the aToken
balance. The indexed `currentATokenBalance` is retained as source context but
is not treated as the normalized exposure amount.

This makes Graph load-bearing: removing the relevant `UserReserve` row removes
the required relation and no exposure evaluation or permit can be created.
RPC validates and normalizes the Graph-derived path; it does not replace the
Graph with a decorative query.

The source is not qualified for USD valuation. `usd_valuation_unavailable` and
`stale_oracle_price` remain visible source gaps. They are explicitly
non-blocking only for this wstETH-unit policy. Any other source, identity,
pagination, contract, block or quantity gap is non-authorizing.

## Attributable graph

The versioned `exposure_graph.v1` contract contains typed nodes, edges, paths,
debt observations, source status, a common block and a canonical graph hash.
The qualified graph has these capital paths:

```text
configured account -> direct wstETH holding -> wstETH asset
configured account -> Aave V3 wstETH supply claim -> wstETH asset
                                      \-> Aave V3 pool dependency
```

Both paths point to one asset node. A receipt/supply representation is not
counted again as a separate underlying asset. Every quantitative edge records
source kind, source field or contract method, chain/deployment, block and
transformation. Debt is displayed separately and is never silently netted
against gross exposure.

## Exposure policy

The policy uses fixed-point integer arithmetic at 18 decimals:

```text
gross = direct_wstETH + normalized_aave_supply
headroom = max(dependency_cap - gross, 0)
allowed = min(requested, headroom)
```

It returns `ALLOW`, `ALLOW_WITH_DOWNSIZE` or `DENY`, the requested and allowed
amounts, cap, gross exposure, headroom, separate debt, binding constraint and
stable reason codes. Missing required paths, malformed quantities, provider
failure or changed source identity return `DENY`. Existing stricter baseline
policy constraints are not weakened by this extension.

The request schema is `sentinel-exposure-buy.v1` and rejects unknown fields,
custom accounts, chains, URLs, policies, assets and excessive precision. The
server owns the account, source configuration and cap.

## Permit and condition-checked paper execution

The server issues `sentinel-exposure-permit.v1` only from a stored non-denied
evaluation. The demo-only EIP-712 payload binds the action, asset/unit,
account, chain, authorized amount, dependency cap, policy version, graph hash,
snapshot block, validity interval, nonce and paper-executor audience.

Pure verification checks signature, typed-data bindings, expiry and amount
without consuming state. Paper execution obtains a fresh server-side
evaluation, checks relevant subject/policy/source/headroom conditions, then
consumes the nonce once. One pending action per account prevents concurrent
headroom spending in the local process. A valid old signature can therefore
remain cryptographically valid while current execution is rejected.

This is a cooperating local paper-executor boundary, not on-chain revocation,
atomic protection against future chain changes or production key management.
Evaluation and nonce state are in memory and lost on restart.

## Tool and UI boundary

`sentinel_exposure_graph` is a read-only, exact-schema tool around the same
server-owned evaluation service. The repository's local CLI proves validation
and source wiring. The separate recorded OpenRouter trace demonstrates an
external model selecting the tool; its application-generated summary is derived
from validated output because the captured model prose was truncated. The
browser sends only bounded requests to server routes and never receives Graph
credentials or arbitrary provider URLs.

`/exposure-graph` presents the request/operator limit, editable plan/repair
review, two graph paths, clickable provenance, decision arithmetic, the
read-only `aave_evidence_unavailable` dependency-impact comparison, demo
permit, signature checks, paper execution and explicitly labeled replay.
`LIVE`, `FIXTURE`, `REPLAY` and `WHAT-IF / SIMULATION` are separate states. The
what-if side is a non-authorizing analysis fork: it preserves the original
provenance and state, reports the causal Aave-evidence dependency, and does not
invalidate or execute the original context. Browser captures use synthetic
fixture data and are not presented as current live evidence.

When the runtime has not retained a permit-check receipt, the analysis reports
`original.permit_status: "not_recorded"`, `permit_check_id: null` and no
copied checks.
It explains that no permit-check evidence is recorded in the analysis and that
issuance/check history is not established; missing history is not treated as
proof that issuance or checking never occurred.

## Non-functional requirements

Keep the Node/TypeScript, ethers and plain HTML/CSS/JavaScript stack. Use
server-selected provider endpoints, bounded requests, server-side credentials,
sanitized errors, exact integer arithmetic and explicit source gaps. The Base
RPC override is optional, HTTPS-only and chain-checked; it is never supplied by
the browser or tool input, and only its safe origin may appear in public
metadata. Never fall back from a live provider failure to a fixture or old
successful decision. Never claim legal, compliance, investment, audit,
security or production guarantees.
