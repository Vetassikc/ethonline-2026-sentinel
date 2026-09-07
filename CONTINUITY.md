# ETHOnline 2026 continuity disclosure

## Pre-existing work

Upstream: https://github.com/Vetassikc/Vartovii-Sentinel-8004

License: MIT, preserved in LICENSE.

Baseline commit: `dbd9a779bdea5b4f1f93dc13f52ea309c76b7142`.

Local working branch: `ethonline-2026/position-evidence`.

The fresh clone retains upstream history. Existing policy, trade-intent schemas, EIP-712 intent signing, judge/operator interfaces, scenarios, tests, documentation and historical deployment references are pre-existing work. They must not be represented as ETHOnline implementation.

Baseline policy verdict signatures are deterministic demo artifacts; they are distinct from actual signed trade intents. Existing network addresses are historical references, not new event deployments or proof of current on-chain state.

## New work completed September 5–7

Local isolation, baseline verification and the planning/documentation package: START_HERE.md, CONTINUITY.md, AI_ATTRIBUTION.md and docs/ethonline-2026/*.md. The new read-only `scripts/graph-preflight.ts` command and `api/app/graph-client.ts` adapter verify sanitized Graph `_meta` metadata and bounded account-level `UserReserve` observations. `api/app/position-evidence.ts` now emits the normalized, hashed `position_evidence.v1` envelope; `api/app/evidence-policy.ts` applies its fail-closed quality gate; and `api/app/evidence-permit.ts` issues and independently verifies a demo-only EIP-712 permit with a one-use nonce boundary. The live sample still exposes an explicit USD-valuation gap and stale-oracle gap, so no live permit is issued and no production safety claim is made.

## Planned new work, not yet delivered

Qualified valuation mapping, exposure equation, restricted AI tool and single-screen demo remain. Move items here into a completed ledger only with actual file paths, commits and verification evidence.

## Verify the boundary

```sh
git log --oneline dbd9a779bdea5b4f1f93dc13f52ea309c76b7142..HEAD
git diff --stat dbd9a779bdea5b4f1f93dc13f52ea309c76b7142
git status --short
```

Untracked preparation files do not appear in git diff; include git status while work is uncommitted. Before submission, commit reviewed work in meaningful increments and update this disclosure. No private Vartovii source is imported.
