# ETHOnline 2026 AI attribution

## September 5–7 implementation

Tool: OpenAI Codex. Assistance included review of supplied prior research and
current official pages, source qualification, documentation drafting,
implementation drafts, test design, local browser checks and public-claim
review. The repository does not contain a bundled model runtime, external MCP
registration or a natural-language model transcript.

The earlier Position Evidence work was AI-assisted in the files already listed
by its commits and continuity records. The new September 7 Exposure Graph work
was AI-assisted in these exact paths:

- `api/app/graph-client.ts`
- `api/app/base-rpc.ts`
- `api/app/exposure-graph.ts`
- `api/app/exposure-policy.ts`
- `api/app/exposure-request.ts`
- `api/app/exposure-service.ts`
- `api/app/exposure-permit.ts`
- `api/app/condition-check.ts`
- `api/app/exposure-tool.ts`
- `api/app/server.ts`
- `shared/schemas/exposure-graph.ts`
- `scripts/exposure-tool.ts`
- `web/exposure-graph.html`
- `web/exposure-graph.js`
- `web/styles.css`
- `api/tests/base-rpc.test.ts`
- `api/tests/exposure-graph.test.ts`
- `api/tests/exposure-policy.test.ts`
- `api/tests/exposure-request.test.ts`
- `api/tests/exposure-service.test.ts`
- `api/tests/exposure-permit.test.ts`
- `api/tests/condition-check.test.ts`
- `api/tests/exposure-routes.test.ts`
- `api/tests/exposure-tool.test.ts`
- `api/tests/exposure-ui.test.ts`
- `docs/superpowers/specs/2026-09-07-sentinel-exposure-graph-design.md`
- `docs/superpowers/plans/2026-09-07-sentinel-exposure-graph.md`
- `START_HERE.md`
- `CONTINUITY.md`
- `AI_ATTRIBUTION.md`
- `README.md`
- `docs/ethonline-2026/STATUS.md`
- `docs/ethonline-2026/SPEC.md`
- `docs/ethonline-2026/PLAN.md`
- `docs/ethonline-2026/ROUTES.md`
- `docs/ethonline-2026/DEMO.md`
- `docs/ethonline-2026/STRATEGY.md`
- `docs/ethonline-2026/AI_TOOL.md`

The local browser rehearsal used a synthetic fixture server and fabricated
public-looking values. It did not capture the configured account, live
portfolio or credentials. The live Graph/RPC checks were read-only and their
results were summarized without committing account-specific output.

## What the code now does

The assisted implementation is deliberately bounded: a fixed Graph
`UserReserve` query, same-block Base validation for one wstETH/Aave case, an
attributable dependency graph, exact token-unit arithmetic, server-owned
condition-checked demo permits, a paper executor, a restricted read-only tool
and a single judge-readable screen. It does not establish source truth beyond
the observed fields, a USD risk model, production security or external AI
integration.

## Founder direction and human review

The founder supplied the project direction, public repository, source
identifiers and the request for a bounded implementation. That direction is
not evidence that the founder manually wrote, reviewed or accepted every line,
policy assumption or source interpretation.

Founder review remains required for the supported action, one-wstETH-unit cap,
live output, limitations, demo narration and any later publication. No founder
review, deployment, submission, adoption, partnership, revenue or prize result
is claimed by this file.

## Ongoing ledger rule

For each further milestone, record exact assisted files, tests, live checks,
source of generated assets and actual human decisions. Keep public-safe prompts
and specifications alongside implementation. Never add secrets, private
portfolio data or private Vartovii internals to attribution artifacts.
