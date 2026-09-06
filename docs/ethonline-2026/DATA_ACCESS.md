# Live data feasibility gate

Status: no live deployment, account, schema or authenticated response verified for the new feature. Do not invent a subgraph ID. No new API key has been created by this preparation.

## Credentials

Open [Subgraph Studio](https://thegraph.com/studio/). Under API Keys, choose Create API Key, provide a project-specific name and inspect the spending controls before creation. Keep any key in ignored local `.env.local`, never chat, browser code, committed URLs or screenshots. Founder manages account authorization and any billing decisions.

Use a fixed gateway host and server-side Authorization bearer header. The supported URL shape is `https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>`. Instructions checked against [Graph API-key documentation](https://thegraph.com/docs/en/subgraphs/providers/subgraph-studio/managing-api-keys/) on September 5. No free quota or zero-cost live operation is promised.

The preflight CLI now consumes `GRAPH_API_KEY`, `GRAPH_SUBGRAPH_ID` and optional `GRAPH_CHAIN_ID`; see [.env.ethonline.example](../../.env.ethonline.example). Copy names into a local ignored `.env.local` or export them in the shell. Add only public protocol/account identifiers to a sanitized source manifest. Do not use a funded wallet key as an application signing secret.

From the project directory, run the first check after exporting values:

```sh
GRAPH_API_KEY="$GRAPH_API_KEY" GRAPH_SUBGRAPH_ID="$GRAPH_SUBGRAPH_ID" GRAPH_CHAIN_ID="8453" npm run graph:preflight
```

The command performs a bounded read-only `_meta` query and prints only provider status, subgraph ID, indexed block metadata, age and warnings. It never prints the API key. A missing configuration exits with status 2 without making a network request.

## Select the smallest viable source

1. Locate a current Graph deployment for one lending/account-position schema. Record provider, deployment ID, protocol, chain and documentation URL.
2. Inspect its actual schema. Identify account positions, amounts/decimals, valuations if required, pagination semantics and block metadata. Do not infer field names from another deployment.
3. Select a public demonstration account with the needed position; do not mine the founder's private wallet history.
4. Run a bounded read query with explicit pagination and `_meta` if supported. If block timestamp is absent, use a read-only RPC lookup for that same indexed block and check chain/block identity.
5. Confirm live values are sufficient for the proposed exposure policy. Record units and price timestamps; protocol-wide statistics cannot stand in for account data.
6. Save a sanitized response as a labeled test fixture and separately record the genuine live run. Check a deliberately missing account, provider failure and stale evidence.

## Source manifest required before milestone 1 closes

Record: verified-at UTC, public source URL, subgraph/deployment ID, chain ID, protocol version, public demo subject, exact query template/version, field mappings/units, pagination completeness, indexed block and timestamp, valuation provenance, configured freshness threshold and a sanitized reproduction command. Credentials and authorization headers are excluded.

If the selected indexer cannot satisfy the freshness bound, make that visible. Decide whether a documented less strict threshold suits the demonstration or select a different source; do not silently use retrieved-at as chain freshness.

## AI path

Use one existing AI client with a restricted project CLI/tool. The model proposes an allowlisted query plan, the adapter validates arguments, and the policy uses actual results. Log model/tool steps without secrets. [The Graph MCP introduction](https://thegraph.com/docs/en/subgraphs/tooling/subgraph-mcp/introduction/) is an alternative integration path, not an extra mandatory component.

The current preparation has neither an active AI-to-Graph runtime nor a working live adapter. These are explicit implementation milestones.
