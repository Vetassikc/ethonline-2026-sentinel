# ETHOnline 2026 continuity disclosure

## Pre-existing work

Upstream: https://github.com/Vetassikc/Vartovii-Sentinel-8004

License: MIT, preserved in LICENSE.

Baseline commit: `dbd9a779bdea5b4f1f93dc13f52ea309c76b7142`.

Local working branch: `ethonline-2026/position-evidence`.

The fresh clone retains upstream history. Existing policy, trade-intent schemas, EIP-712 intent signing, judge/operator interfaces, scenarios, tests, documentation and historical deployment references are pre-existing work. They must not be represented as ETHOnline implementation.

Baseline policy verdict signatures are deterministic demo artifacts; they are distinct from actual signed trade intents. Existing network addresses are historical references, not new event deployments or proof of current on-chain state.

## New work completed September 5

Local isolation, baseline verification and the planning/documentation package: START_HERE.md, CONTINUITY.md, AI_ATTRIBUTION.md and docs/ethonline-2026/*.md. No new application feature is claimed at this checkpoint.

## Planned new work, not yet delivered

Live Graph adapter, normalized position evidence with freshness/gaps, deterministic evidence-policy restriction, real evidence-bound permit/verifier, restricted AI tool and single-screen demo. Move items here into a completed ledger only with actual file paths, commits and verification evidence.

## Verify the boundary

```sh
git log --oneline dbd9a779bdea5b4f1f93dc13f52ea309c76b7142..HEAD
git diff --stat dbd9a779bdea5b4f1f93dc13f52ea309c76b7142
git status --short
```

Untracked preparation files do not appear in git diff; include git status while work is uncommitted. Before submission, commit reviewed work in meaningful increments and update this disclosure. No private Vartovii source is imported.
