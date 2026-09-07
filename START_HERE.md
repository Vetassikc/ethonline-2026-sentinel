# Sentinel Exposure Graph — ETHOnline 2026

Prepared September 7, 2026. This is the working directory for the Continuity
extension of the public MIT Sentinel-8004 repository. The delivered narrow
slice reads a configured Base account through The Graph, validates the
same-block wstETH/Aave relation with fixed-host Base RPC reads, builds an
attributable dependency graph, derives a wstETH-unit purchase bound, and
enforces a demo permit at a paper executor.

The live source case is qualified for this narrow token-unit workflow. USD
valuation, a public demo-account selection, genuine external AI/MCP
invocation, durable state, deployment and submission remain separate gates.

## The product in one sentence

Your agent may see separate positions; Sentinel shows their shared wstETH
dependency and limits the next bounded purchase before a cooperating paper
executor accepts it.

This is a prototype based on configured inputs. It is not investment advice,
an audit, a security guarantee or production execution protection.

## Start here

1. Read [GRAPH_SOURCE_MANIFEST.md](docs/ethonline-2026/GRAPH_SOURCE_MANIFEST.md)
   for the qualified Base/Aave/wstETH case and its explicit gaps.
2. Keep `GRAPH_API_KEY`, `GRAPH_SUBGRAPH_ID`, `GRAPH_CHAIN_ID` and a deliberately
   selected public `GRAPH_DEMO_ACCOUNT` in ignored local configuration only.
3. Run the sanitized source checks and the exact bounded exposure request:

   ```sh
   node --env-file=.env.local scripts/graph-preflight.ts
   node --env-file=.env.local scripts/exposure-tool.ts <<'JSON'
   {"schema_version":"sentinel-exposure-buy.v1","action":"BUY_EXPOSURE","asset":"wstETH","unit":"wstETH","requested_units":"2.000000000000000000"}
   JSON
   ```

   Summarize status, block metadata and reason codes; do not paste the live
   account, balances or credentials into chat or committed artifacts.
4. Run `npm test`, then start the local server with the explicit env file:
   `node --env-file=.env.local api/app/server.ts`.
5. Open `http://127.0.0.1:8787/exposure-graph` for the new judge-readable
   screen. `/position-evidence` remains the older evidence-only route.

## Working documents

- [Strategy and scope](docs/ethonline-2026/STRATEGY.md)
- [Product and technical specification](docs/ethonline-2026/SPEC.md)
- [Implementation plan](docs/ethonline-2026/PLAN.md)
- [Routes and interfaces](docs/ethonline-2026/ROUTES.md)
- [Data access and feasibility gate](docs/ethonline-2026/DATA_ACCESS.md)
- [Verified Graph source manifest](docs/ethonline-2026/GRAPH_SOURCE_MANIFEST.md)
- [Graph setup for beginners](docs/ethonline-2026/GRAPH_SETUP_GUIDE.md)
- [Restricted AI tool contract](docs/ethonline-2026/AI_TOOL.md)
- [Demo and acceptance checklist](docs/ethonline-2026/DEMO.md)
- [Current status and blockers](docs/ethonline-2026/STATUS.md)
- [Continuity disclosure](CONTINUITY.md)
- [AI attribution](AI_ATTRIBUTION.md)

Historical submission copy elsewhere in this repository describes earlier
work. It must not be reused as an Exposure Graph completion claim. Root
`AGENTS.md` remains the repository instruction source.
