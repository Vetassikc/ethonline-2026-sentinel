# The Graph setup — beginner guide

This guide explains the three values in `.env.local` and how to find a suitable Lending/CDP source. It does not create a key, connect a wallet, or choose a provider on the founder's behalf.

## The three values in plain language

| Value | Meaning | Where it comes from | What it is not |
| --- | --- | --- | --- |
| `GRAPH_API_KEY` | A credential that lets our server query The Graph Gateway | Subgraph Studio → API Keys | Not a wallet private key; never commit or paste it |
| `GRAPH_SUBGRAPH_ID` | The identifier of the dataset/application schema we want to query | Graph Explorer → a Subgraph detail page | Not a contract address, chain ID or Deployment ID |
| `GRAPH_CHAIN_ID` | The numeric EVM network identifier for the data source | The Subgraph detail page's Network, cross-checked with the chain's docs | Not a wallet balance, RPC URL or subgraph identifier |

The gateway uses the Subgraph ID to resolve a current deployment. A Deployment ID is a version-specific IPFS identifier; it is useful when pinning an exact schema version, but is not the value requested by our first preflight. The Graph documents both identifiers and the trade-off between “latest” and pinned versions in [Subgraph ID vs Deployment ID](https://thegraph.com/docs/en/subgraphs/querying/subgraph-id-vs-deployment-id/).

## What Lending / CDP means

**Lending** protocols track deposits and borrows. A standardized lending schema models an account's `Position` per market, with lender and borrower sides. **CDP** means a collateralized debt position: collateral is locked while debt is outstanding. Aave and Compound are lending markets; Maker/Sky is a classic CDP system. For this project, the label is less important than having account-level positions, units and reliable indexed-block metadata.

The Graph's standardized Lending / CDP schema is designed to expose `Market`, `Position`, `InterestRate` and lending events. That shared shape is why it is a useful first candidate for a reusable evidence adapter. It does not mean every deployment has complete or fresh data; the selected deployment must still pass our checks. See [Standardized Subgraphs](https://thegraph.com/docs/en/subgraphs/existing-subgraphs/standard-subgraphs/).

## How to find the source in Graph Explorer

1. Open [Graph Explorer](https://thegraph.com/explorer). No wallet is needed for read-only browsing; a wallet may be requested for curation or other account actions.
2. Search one protocol plus one network, for example `Aave V3 Base` or `Compound V3 Base`. Do not search only “lending”; that returns unrelated or incomplete results.
3. Open a result whose details show the intended **Network**, a visible **Query** button, an index status and entity types. Use the network filter in Explorer, not only the title.
4. In the detail panel copy the **full Subgraph ID**. Explorer may visually shorten it with an ellipsis. The ID is the long mixed-case string in the page URL and the details panel.
5. Record the page's network and the full ID in a private note. Use the corresponding numeric chain ID below only when it matches that page.
6. Open **Query** and inspect the schema/playground. Confirm that an account-level `Position` query is available and that filters/fields needed for the demo exist. Do not invent fields from another protocol's schema.
7. Check index status and run our preflight. A deployment page's “Updated” date is not the indexed block timestamp; `_meta` is the deciding freshness signal.

The official Explorer guide confirms that a Subgraph detail page exposes the Subgraph ID, current Deployment ID, Query URL, entity types and indexer status, and that the Query button opens the playground. See [Using Graph Explorer](https://thegraph.com/docs/en/subgraphs/existing-subgraphs/explorer/) and [How to query a Subgraph](https://thegraph.com/docs/en/subgraphs/querying/introduction/).

## Chain ID examples

These are examples, not a command to use blindly:

| Explorer network | Chain ID | Use when |
| --- | ---: | --- |
| Base Mainnet | `8453` | The selected Graph source says `base` and the demo reads Base mainnet data |
| Base Sepolia | `84532` | The selected source actually indexes Base Sepolia testnet data |
| Ethereum Mainnet | `1` | The selected source says `mainnet` |
| Arbitrum One | `42161` | The selected source says `arbitrum-one` |

Base's official RPC reference lists `8453` for Mainnet and `84532` for Sepolia. [Base chain IDs](https://docs.base.org/base-chain/api-reference/rpc-overview). A Graph subgraph on Base Mainnet is not interchangeable with a Base Sepolia source: account positions and block evidence belong to different chains.

## A concrete candidate, with an explicit caveat

[Aave V3 Base on Graph Explorer](https://thegraph.com/explorer/subgraphs/D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9?chain=arbitrum-one&view=About) was visible in the current public Explorer search. Its full Subgraph ID is `D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9` and its listed network is `base`, so the corresponding chain ID is `8453`. The page showed a fully indexed status and recent query activity when checked, but its deployment metadata says it was updated about two years ago. Treat this as a candidate for preflight, not as a final source or a claim that the position query is currently suitable.

If it fails the preflight or does not expose the exact account-position fields we need, return to Explorer and choose another current result. Do not switch to an arbitrary RPC, DeFi analytics website or local fixture while still claiming a Graph integration.

## Put the values into the project

From the project directory:

```sh
cp .env.ethonline.example .env.local
```

Edit `.env.local` with the key from Studio, the full ID from Explorer and the matching chain number:

```env
GRAPH_API_KEY=keep-this-only-on-your-machine
GRAPH_SUBGRAPH_ID=D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9
GRAPH_CHAIN_ID=8453
```

The example ID above is intentionally only a candidate. Replace it if Explorer or the preflight says another deployment is better. Then run:

```sh
set -a
source .env.local
set +a
npm run graph:preflight
```

The output should show `status: "ok"`, the configured ID, an indexed block number/hash/timestamp and no provider indexing-error warning. The API key is sent as a bearer header and is excluded from printed output. If the result is `graphql_error`, `http_error`, `timeout` or `network_error`, keep the source unqualified and report that exact status.

## What we need after preflight

The preflight only checks `_meta`; it does not prove account positions. The next query must identify:

- a public demonstration account and exact chain;
- the account/position entity and filter syntax;
- token amount fields, decimals and any USD valuation source;
- pagination completeness and null semantics;
- indexed block identity and timestamp for the returned position data.

Only after those fields are verified do we freeze the `position_evidence.v1` mapping and policy equation. A protocol-wide TVL number, a dashboard screenshot or a mocked response cannot substitute for an account position.
