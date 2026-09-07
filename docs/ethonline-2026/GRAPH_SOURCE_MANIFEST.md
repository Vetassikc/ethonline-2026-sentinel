# Graph source manifest — ETHOnline 2026

Verification date: 2026-09-07. This is a public, source-selection record. It contains no API key, wallet secret or private portfolio data.

## Current candidate

| Field | Value |
| --- | --- |
| Provider | The Graph Gateway |
| Subgraph ID | `GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF` |
| Configured chain ID | `8453` (Base Mainnet) |
| Query mode | Fixed GraphQL `PositionEvidence` query |
| Account entity | `User` |
| Position entity | `UserReserve` |
| Ordering and pagination | `orderBy: id`, `orderDirection: asc`, `id_gt` cursor |

## Verified facts

- Gateway authentication and the `_meta` preflight returned `status: ok`.
- `_meta.block.number`, hash and timestamp were returned, with `hasIndexingErrors: false` during the live check.
- Schema introspection exposed `userReserves`, `UserReserve`, `Reserve`, `Supply` and `Borrow`.
- `UserReserve` exposes raw supplied balance, total debt, stable/variable debt, collateral-use flag, token decimals and reserve oracle metadata.
- The adapter completed a bounded account query with one page for the sampled public account used during local verification.

## Explicit gaps

- This deployment exposes `priceInEth`, not a verified USD valuation field. The adapter returns `usd_valuation_unavailable` and must not calculate a USD exposure from an assumed ETH or stablecoin price.
- The sampled reserve oracle timestamps were materially older than the fresh indexed block, so the adapter returns `stale_oracle_price` when the configured 300-second price-age bound is exceeded.
- No public demo account is frozen in this manifest. The founder must deliberately choose one and record it in a local ignored `GRAPH_DEMO_ACCOUNT` only.

## Milestone decision

**Conditionally viable for live position evidence; not yet qualified for a USD-based permit policy.** Keep the source for the read-only Graph demonstration while adding a separately attributed, freshness-checked valuation source or changing the policy to a documented non-USD signal. Do not hide these gaps behind a fixture.
