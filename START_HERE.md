# Sentinel Position Evidence — ETHOnline 2026

Prepared 2026-09-05 and updated 2026-09-07. This is the working directory for a Continuity extension of the public MIT Sentinel-8004 repository. The read-only Graph position adapter is implemented; the evidence policy and UI remain gated on a qualified valuation source.

## The product in one sentence

An AI trading assistant must obtain fresh, traceable position evidence before Sentinel issues a narrowly bounded trade permit; missing evidence blocks authorization.

The demo must show a decision changing, not merely a better report. The Graph supplies live evidence; deterministic policy decides; a separate verifier checks the evidence-bound permit. This is a prototype, not investment advice, an audit, or production protection.

## Start here

1. Create the portal project using [PORTAL_GUIDE.md](docs/ethonline-2026/PORTAL_GUIDE.md).
2. Read [GRAPH_SETUP_GUIDE.md](docs/ethonline-2026/GRAPH_SETUP_GUIDE.md), fill the local Graph values and choose a public `GRAPH_DEMO_ACCOUNT`.
3. Run `npm run graph:preflight`, `npm run graph:position` and then `npm run graph:evidence`. Review the returned gaps before any policy work.
4. The normalized evidence contract is implemented in `api/app/position-evidence.ts`; run `npm test` and inspect its `position_evidence.v1` tests before extending policy.
5. Continue milestone 2 of [PLAN.md](docs/ethonline-2026/PLAN.md). Do not build the presentation layer before the data path is qualified.

## Run the existing baseline

Node 22.18.0 was used for verification. Dependencies are already installed locally.

```sh
npm test
npm start
```

Use the local address printed by the server. Existing `/judge` is the old demonstration, not the ETHOnline evidence feature. [ROUTES.md](docs/ethonline-2026/ROUTES.md) separates existing and proposed routes.

## Working documents

- [Strategy and scope](docs/ethonline-2026/STRATEGY.md)
- [Product and technical specification](docs/ethonline-2026/SPEC.md)
- [Implementation plan](docs/ethonline-2026/PLAN.md)
- [Routes and interfaces](docs/ethonline-2026/ROUTES.md)
- [Data access and feasibility gate](docs/ethonline-2026/DATA_ACCESS.md)
- [Graph setup for beginners](docs/ethonline-2026/GRAPH_SETUP_GUIDE.md)
- [Verified Graph source manifest](docs/ethonline-2026/GRAPH_SOURCE_MANIFEST.md)
- [Portal instructions and submission drafts](docs/ethonline-2026/PORTAL_GUIDE.md)
- [Demo and acceptance checklist](docs/ethonline-2026/DEMO.md)
- [Current status and blockers](docs/ethonline-2026/STATUS.md)
- [Continuity disclosure](CONTINUITY.md)
- [AI attribution](AI_ATTRIBUTION.md)

Historical submission copy elsewhere in this repository describes earlier work. It must not be reused as an ETHOnline completion claim. These documents govern the new feature; root AGENTS.md remains the repository instruction source.
