# Strategy decision — Sentinel Exposure Graph

Date: September 7, 2026.

## Decision: narrow GO, not broad platform expansion

Continue Sentinel's public thesis as a signed trade-permit guardrail for
autonomous trading agents. The strongest bounded event surface is now
**Sentinel Exposure Graph**:

> Your agent sees separate positions. Sentinel shows their shared dependency
> and limits the next bounded purchase before a paper executor accepts it.

This is a qualitative product decision, not a claim of global novelty, prize
probability, adoption or revenue.

## What the source gate established

The Graph deployment is useful for one qualified case on Base Mainnet: a
wstETH direct holding and an Aave V3 wstETH supply claim converge on one
underlying asset. The Graph provides the substantive account relation and
scaled supply. Same-block Base RPC reads validate the public contract relation,
decimals, scaled balance and normalized Aave supply. The graph therefore
changes the derived wstETH-unit headroom; it is not a sponsor-branded query
beside an RPC-only product.

The result is a **NARROW GO** for token-unit exposure accounting. It is not a
GO for USD valuation: the sampled source exposes `priceInEth`, and the oracle
timestamp can be stale relative to the indexed block. The policy intentionally
uses explicit wstETH units and leaves those gaps visible.

Source details and public identifiers are in
[GRAPH_SOURCE_MANIFEST.md](GRAPH_SOURCE_MANIFEST.md). The Graph prize
requirements were checked against the [official ETHGlobal prize page](https://ethglobal.com/events/ethonline2026/prizes/the-graph);
award outcomes remain unknown.

## Why this is a stronger demo

The earlier Position Evidence slice ended at a normalized evidence decision
that could remain denied on valuation quality. The new slice makes the narrow
source relation affect a concrete amount: direct and Aave paths are counted
once, a fixed operator cap determines headroom, and a requested purchase is
allowed, downsized or denied in exact wstETH units. A demo permit binds the
graph hash and amount; a cooperating paper executor refreshes relevant
conditions before accepting it.

The differentiator is the inspectable path from source relation to bounded
authorization, not “AI plus sources,” a trust score or a new wallet.

## Scope discipline

Keep one chain, one underlying, one Aave relation, one action and one fixed
cap. Do not add a general portfolio dashboard, arbitrary swaps, leverage,
liquidation, autonomous rebalancing, a new chain, token issuance, EAS, World
ID, x402, hardware wallet flow, dedicated graph database or another sponsor
integration to the critical path.

The local demo uses a cooperating paper executor and an in-memory state store.
It does not submit trades or enforce rules on-chain. A valid signature proves
typed-data integrity under the demo signer; it does not prove source truth,
complete portfolio coverage or safety.

## AI boundary

`sentinel_exposure_graph` is a useful restricted local tool contract: the model
or caller may provide only the versioned purchase shape, while the server
chooses the account, chain, source, policy and signer. The CLI and schema do
not establish a genuine external AI/MCP integration. That claim requires a
separate recorded natural-language trace and remains an open gate.

## Remaining gates

1. Refresh one provider-available live browser run without exposing account or
   balance data. A later repeated probe hit the public Base RPC rate limit and
   correctly failed closed.
2. Decide whether the event value justifies configuring a real external AI/tool
   client. If so, record the exact request, selected tool call and explanation.
3. Have the founder review the token-unit policy, live outputs, limitations,
   dependency advisories and media before any push, deployment or submission.

Do not infer users, partnerships, security assurance, compliance, awards or
business traction from local tests, listings, profile state or synthetic
rehearsal.
