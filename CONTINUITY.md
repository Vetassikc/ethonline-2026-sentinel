# ETHOnline 2026 continuity disclosure

## Pre-existing work

Upstream: https://github.com/Vetassikc/Vartovii-Sentinel-8004

License: MIT, preserved in `LICENSE`.

Baseline commit: `dbd9a779bdea5b4f1f93dc13f52ea309c76b7142`.

Local working branch: `ethonline-2026/position-evidence`.

The fresh clone retains upstream history. Existing policy, trade-intent
schemas, EIP-712 intent signing, judge/operator interfaces, scenarios, tests,
documentation and historical deployment references are pre-existing work.
They are not represented as ETHOnline Exposure Graph implementation.

## New work completed September 5–7

The event work began with the planning/specification package and a bounded
source qualification. The qualified case is deliberately narrow: a Base
mainnet wstETH direct holding and an Aave V3 wstETH supply claim converge on
one underlying asset. The Graph `UserReserve` observation is substantive: it
provides the account position, scaled supply, aToken/underlying relation and
pool relation. Same-block Base RPC reads validate contract identity, decimals,
the scaled balance and the normalized Aave supply. RPC is a validation and
normalization source, not a decorative replacement for the Graph.

The following event slices are implemented and locally committed:

- `api/app/graph-client.ts` and `api/app/base-rpc.ts` — fixed Graph query,
  same-block Base reads, relation checks, exact Ray multiplication and
  sanitized fail-closed provider errors.
- `shared/schemas/exposure-graph.ts`, `api/app/exposure-graph.ts` and
  `api/app/exposure-policy.ts` — versioned graph, provenance, path accounting,
  debt separation, fixed-point wstETH-unit cap and conservative amount bound.
- `api/app/exposure-request.ts` and `api/app/exposure-service.ts` — exact
  purchase request validation, server-owned evaluation references and
  bounded in-memory state.
- `api/app/exposure-permit.ts` and `api/app/condition-check.ts` — demo-only
  EIP-712 permit, independent verification, fresh-condition recheck,
  one-account pending boundary and one-use paper nonce.
- `api/app/server.ts`, `api/tests/exposure-routes.test.ts` and related tests —
  bounded evaluate, permit, verify, paper-execute and replay routes.
- `api/app/exposure-tool.ts` and `scripts/exposure-tool.ts` — exact,
  read-only `sentinel_exposure_graph` tool boundary. It is not an external
  model or MCP invocation.
- `web/exposure-graph.html`, `web/exposure-graph.js` and `web/styles.css` —
  judge-readable request, graph, decision, permit, execution and replay
  screen with explicit LIVE/REPLAY and demo labels.

Meaningful local commits for this slice are `74e86e4`, `47c17ec`, `f67ae0d`,
`9e4ba9f`, `eb3a850`, `7a42337`, `eb48221`, `a1b09ab`, `82137b5`, `9ee8e5d`
and `8099238`. The design and implementation plan commits are `3ce8438` and
`e4c9727`.

Verification evidence includes a live Graph preflight and bounded account
query with fresh indexed metadata, a same-block live Graph/RPC wstETH case,
the full local regression suite (`160` passing tests), and a browser smoke
through the complete flow using a clearly labeled synthetic fixture. The
synthetic browser run is rehearsal evidence, not current live portfolio
evidence. A later repeated live-browser probe encountered the public Base RPC
endpoint's `429` rate limit; the adapter stayed non-authorizing as designed.

## Still unknown or not delivered

- USD valuation and a USD-denominated exposure model are not qualified.
- No public demo account is frozen in the repository; local configuration is
  the operator's responsibility and must remain ignored.
- No genuine natural-language external AI/MCP trace is recorded. The exact
  CLI tool is a restricted local boundary only.
- Evaluation references, nonce state and pending-account state are in memory;
  restart durability is not claimed.
- No deployment, wallet transaction, portal submission, outbound message,
  user adoption, partnership, revenue, audit or prize result is claimed.
- Founder review of policy assumptions, live outputs and submission media is a
  separate human gate and is not inferred from AI-assisted commits.

## Verify the boundary

```sh
git log --oneline dbd9a779bdea5b4f1f93dc13f52ea309c76b7142..HEAD
git diff --stat dbd9a779bdea5b4f1f93dc13f52ea309c76b7142
git status --short
```

Do not commit `.env.local`, Graph keys, account identifiers, raw live balances
or private Vartovii source. Public protocol contract addresses and sanitized
schema fixtures are allowed. Pushing, deployment, submission and wallet
actions remain separate approval gates.
