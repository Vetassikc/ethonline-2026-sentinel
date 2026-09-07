# Graph source manifest — ETHOnline 2026

Verification date: 2026-09-07. This is a public, source-selection record. It contains no API key, wallet secret or private portfolio data.

## Current candidate

| Field | Value |
| --- | --- |
| Provider | The Graph Gateway |
| Explorer source | [Aave V3 Base on Graph Explorer](https://thegraph.com/explorer/subgraphs/GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF) |
| Explorer label/version | `Aave V3 Base`, `v0.0.5` |
| Protocol/network | Aave V3 / Base Mainnet |
| Subgraph ID | `GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF` |
| Configured chain ID | `8453` (Base Mainnet) |
| Query mode | Fixed, paginated GraphQL `PositionEvidence` query with exposure relations |
| Account entity | `User` |
| Position entity | `UserReserve` |
| Ordering and pagination | `orderBy: id`, `orderDirection: asc`, `id_gt` cursor |

## Qualified narrow case

The live source is qualified for one token-unit exposure path: a Base account's
wstETH underlying balance plus its Aave V3 wstETH supply claim. The public
protocol identifiers used by the adapter are:

| Identifier | Address |
| --- | --- |
| wstETH underlying | `0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452` |
| Aave wstETH aToken | `0x99cbc45ea5bb7ef3a5bc08fb1b7e56bb2442ef0d` |
| Aave V3 Base pool | `0xa238dd80c259a72e81d7e4664a9801593f98d1c5` |

The Graph field paths used by the exposure adapter are:

| Meaning | Graph path | Unit/handling |
| --- | --- | --- |
| Account | `userReserves[].user.id` | Lowercase EVM address |
| Underlying asset | `userReserves[].reserve.underlyingAsset` | Fixed wstETH address |
| Scaled Aave supply | `userReserves[].scaledATokenBalance` | Integer in aToken scale; normalized with same-block Base RPC Ray math |
| aToken relation | `userReserves[].reserve.aToken.id` | Public contract address |
| aToken underlying | `userReserves[].reserve.aToken.underlyingAssetAddress` | Must equal the wstETH underlying |
| aToken decimals | `userReserves[].reserve.aToken.underlyingAssetDecimals` | Must equal the underlying decimals |
| Aave pool | `userReserves[].reserve.pool.pool` | Fixed Base pool address |
| Graph supply index | `userReserves[].reserve.liquidityIndex` | Preserved as provenance; RPC normalized income is the exact same-block input |

## Verified facts

- Gateway authentication and the `_meta` preflight returned `status: ok`.
- `_meta.block.number`, hash and timestamp were returned, with `hasIndexingErrors: false` during the live check.
- Schema introspection exposed `userReserves`, `UserReserve`, `Reserve`, `Supply` and `Borrow`.
- `UserReserve` exposes raw and scaled supplied balances, total debt, stable/variable debt, collateral-use flag, token decimals and reserve oracle metadata.
- `Reserve` exposes the aToken relation, pool relation and `liquidityIndex` required by the narrow exposure graph.
- A bounded live account query returned seven rows in one complete page. The result included the wstETH candidate; no account identifier or balance is stored in this manifest.
- At the Graph indexed block, the wstETH aToken relation matched the underlying and the Graph scaled supply matched the same-block Base RPC `scaledBalanceOf` read. The RPC adapter then applies Aave Ray multiplication to obtain the normalized supply claim.

## Explicit gaps

- This deployment exposes `priceInEth`, not a verified USD valuation field. The adapter returns `usd_valuation_unavailable` and must not calculate a USD exposure from an assumed ETH or stablecoin price.
- The sampled wstETH reserve oracle timestamp was materially older than the fresh indexed block, so the adapter returns `stale_oracle_price` when the configured 300-second price-age bound is exceeded. The narrow policy therefore uses explicit wstETH units and does not depend on that oracle.
- `currentATokenBalance` is an indexed snapshot and is not treated as the exact normalized supply. The exposure path uses `scaledATokenBalance` plus same-block `getReserveNormalizedIncome` from the fixed Base RPC host.
- The public Base RPC endpoint has a shared request budget. A later repeated
  probe returned HTTP `429`; the adapter reports this as non-authorizing
  provider failure and never falls back to an old result or fixture.
- No public demo account is frozen in this manifest. The founder must deliberately choose one and record it in a local ignored `GRAPH_DEMO_ACCOUNT` only.

## Milestone decision

**Qualified for the narrow live token-unit exposure graph; not qualified for USD valuation.** Keep the wstETH policy explicit, bounded and fail closed on Graph/RPC identity or freshness failures. Do not hide the USD or oracle gaps behind a fixture.
