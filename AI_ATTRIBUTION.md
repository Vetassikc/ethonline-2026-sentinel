# ETHOnline 2026 AI attribution

## September 5–7 implementation

Tool: OpenAI Codex. Assistance: review of supplied prior research, current official pages and existing public source; local project setup; documentation drafting; running existing checks.

AI-authored/assisted files at this checkpoint:

- START_HERE.md
- CONTINUITY.md
- AI_ATTRIBUTION.md
- docs/ethonline-2026/STRATEGY.md
- docs/ethonline-2026/SPEC.md
- docs/ethonline-2026/PLAN.md
- docs/ethonline-2026/ROUTES.md
- docs/ethonline-2026/DATA_ACCESS.md
- docs/ethonline-2026/GRAPH_SETUP_GUIDE.md
- docs/ethonline-2026/GRAPH_SOURCE_MANIFEST.md
- api/app/graph-client.ts
- scripts/graph-position.ts
- api/tests/graph-client.test.ts
- docs/ethonline-2026/PORTAL_GUIDE.md
- docs/ethonline-2026/DEMO.md
- docs/ethonline-2026/STATUS.md
- scripts/graph-preflight.ts
- api/tests/graph-preflight.test.ts
- package.json command registration and `.env.ethonline.example`
- shared/schemas/position-evidence.ts
- api/app/position-evidence.ts
- api/tests/position-evidence.test.ts
- api/app/evidence-policy.ts
- api/tests/evidence-policy.test.ts
- api/app/evidence-permit.ts
- api/tests/evidence-permit.test.ts
- scripts/position-evidence.ts
- api/app/server.ts (Position Evidence route)
- api/tests/position-evidence-routes.test.ts
- web/position-evidence.html
- web/position-evidence.js
- web/styles.css (Position Evidence layout)

The new code slices remain deliberately bounded: a read-only Graph `_meta` preflight, a fixed cursor-paginated `UserReserve` adapter, normalized evidence hashing, a fail-closed quality gate, a demo-only evidence-bound EIP-712 permit/verifier and a read-only evidence evaluation route/UI. They do not implement a live valuation equation, AI runtime or permit/verifier HTTP presentation. Running existing tests is not new test implementation. Existing repository files retain their prior provenance.

## Founder direction at preparation time

The founder supplied multiple prior research reports and explicitly requested a renewed strategy assessment, improvements, portal instructions and a dedicated local project with a work plan/specification. The founder's request authorized preparation; it is not evidence of line-by-line review or acceptance of every proposed policy rule.

Task prompt summary: “Reassess and improve the hackathon idea; inspect what I need and where to click; create a project directory under Code with the documentation, plan, routes and specification needed to begin work.”

## Required ongoing ledger

For each milestone, record exact AI-assisted files, tests run, source of generated assets, and actual human decisions/review. Preserve public-safe task prompts and specifications alongside implementation. Remove secrets and private product internals from public prompt artifacts. Do not claim the founder manually wrote, validated or reviewed code without evidence.

Meaningful founder work should include choosing policy assumptions, inspecting live outputs, testing the product as a user and explaining the implementation/limitations in the demo. Update this file with completed contributions rather than promises before submission.
