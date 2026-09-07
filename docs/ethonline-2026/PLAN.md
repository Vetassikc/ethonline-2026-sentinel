# Implementation plan

Design: [SPEC.md](SPEC.md). Dates use Europe/Zurich. This plan starts from verified existing code; unchecked items are not implemented.

## 0. Preparation — September 5

- [x] Clone public upstream into an isolated Code directory, preserving history.
- [x] Create local branch `ethonline-2026/position-evidence`.
- [x] Install locked dependencies without lifecycle scripts; run baseline tests (60 passed).
- [x] Inspect dashboard, project creation form, current Graph prize and event rules.
- [x] Record design, continuity baseline and AI attribution.
- [ ] Founder creates project draft on portal; this is not done by local setup.

## 1. Prove data access — September 5–6

Files: `scripts/graph-preflight.ts`, `api/app/graph-client.ts`, `api/tests/graph-client.test.ts`, `scripts/graph-position.ts`, and a sanitized source manifest under `docs/ethonline-2026/`.

1. [x] Follow DATA_ACCESS; inspect the configured deployment's actual account-level schema and record exact schema/field types.
2. [x] Write failing tests for missing configuration, timeout, GraphQL errors, indexing error, invalid subject, missing freshness, incomplete pagination and successful parsing.
3. [x] Implement a fixed-host adapter using server-side bearer auth; never print credentials or raw auth errors.
4. [x] Execute a real bounded query and record query template, variables, block provenance, retrieval time and sanitized output. Do not commit real user portfolio data.
5. [ ] Freeze the exposure formula and supported market in SPEC using a freshness-checked valuation source. A green fixture test alone does not complete this milestone.

Exit: reproducible live evidence for one policy, with known freshness and no invented fields. Current source passes position/block access but fails the USD-valuation qualification. A read-only evidence view may expose this gap, but no authorizing permit may be issued until the policy and valuation source are explicitly qualified.

## 2. Evidence and deterministic decisions — September 6–7

Files: `shared/schemas/position-evidence.ts`, `api/app/position-evidence.ts`, `api/app/evidence-policy.ts`, `api/tests/position-evidence.test.ts`, `api/tests/evidence-policy.test.ts`; sanitized test fixtures under `api/tests/fixtures/position-evidence/`.

1. [x] Write failing tests for canonical hash stability, mutation sensitivity, invalid numbers, stale/missing data and subject mismatch.
2. [x] Implement normalization, explicit gaps, canonical serialization and evidence hash.
3. [x] Write failing policy cases for DENY, ALLOW, DOWNSIZE and preservation of an existing policy DENY.
4. [x] Implement the evidence policy wrapper without weakening `api/app/policy.ts`.
5. [x] Run `npm test`; manually compare live evidence and policy reasons.

Exit for this slice: the live Graph result has a traceable, hashed envelope and an explicit quality gate. The wrapper never weakens the existing trade policy; current live evidence remains `DENY` until valuation/freshness gaps are resolved. USD valuation equation and evidence-bound permit remain gated work.

## 3. Evidence-bound authorization — September 7–8

Files: `api/app/evidence-permit.ts`, `api/tests/evidence-permit.test.ts`; CLI/route integration remains in milestone 4.

1. [x] Write tests for valid signature, wrong trusted signer, changed evidence/intent/amount/audience, expired permit and nonce reuse.
2. [x] Implement actual EIP-712 permit signing, independent verification and a local one-use nonce boundary.
3. [x] Use an isolated demo signer; document no production key management.
4. [x] Ensure old deterministic verdict signatures cannot pass the new verifier by accepting only the new permit schema/domain.
5. [x] Run all tests; preserve old judge behavior.

Exit: a tampered authorization fails independently. No real-money execution.

## 4. AI + single-screen demo — September 8–10

Files: `web/position-evidence.html`, `web/position-evidence.js`, `scripts/position-evidence.ts`, `scripts/position-evidence-tool.ts`, `api/app/position-evidence-tool.ts`, `api/app/server.ts`, `api/tests/position-evidence-routes.test.ts`, `api/tests/position-evidence-tool.test.ts` and the narrow public docs.

1. [x] Implement `GET /position-evidence` and `POST /api/position-evidence/evaluate` with input validation and read-only evidence access.
2. [x] Give an AI client a documented restricted CLI tool with an explicit schema and allowlisted scenarios. Capture one genuine natural-language request, validated tool arguments and resulting evidence before claiming external AI integration; a manually entered JSON request alone is not proof.
3. [x] Build one screen for intent, source/block/freshness, gaps, normalized evidence and the fail-closed policy decision. Permit/verifier presentation remains a follow-up slice.
4. [ ] Test malformed/oversized input and live failure behavior; route tests cover malformed intent, blocked configuration, provider errors and the existing `/judge` regression path remains green.
5. Rehearse fresh/stale/tampered cases with explicit mode labels.

Exit: partial. A judge can follow the live intent → Graph source → normalized evidence → policy decision slice without navigating a large dashboard. AI invocation, permit/verifier presentation, bounded-body tests and rehearsal remain.

## 5. Freeze and submission — September 11–13

1. Address the baseline dependency advisories through a bounded dependency review and full regression run before proposing a public deployment. Do not blindly force-upgrade.
2. Freeze features September 11. Update STATUS, CONTINUITY, AI_ATTRIBUTION and root README entry point to actual behavior.
3. Reproduce from a clean checkout with `npm ci --ignore-scripts`, `npm test`, documented local configuration and live query.
4. Founder reviews policy choices, validates outputs and records the demonstration in their own voice. Document actual human work, not presumed review.
5. Produce video, screenshots, architecture diagram and accurate partner integration text. Check secrets and links.
6. Founder approves any push/deployment and submits separately. Internal target: September 13, 15:00 Zurich; official cutoff 18:00 Zurich.

## Work ownership and change discipline

AI assistance: implementation drafts, tests, documentation and repeatable checks. Founder: product/policy decisions, review of live outputs, explanation of limitations, video and submission. Make small meaningful commits per working milestone; do not squash all event work into an opaque final dump. No fabricated work history or retroactive timestamps.

Recommended next command sequence after implementing each slice:

```sh
npm test
git diff --check
git diff --stat
```

Then inspect the actual diff before a local commit. Pushing remains separately approval-gated.
