# Status — September 5, 2026

## Verified now

- Isolated public upstream clone exists in the requested Code directory; original project directories were not changed.
- Baseline SHA: `dbd9a779bdea5b4f1f93dc13f52ea309c76b7142`.
- Local branch: `ethonline-2026/position-evidence`.
- `npm ci --ignore-scripts` completed using the lockfile.
- `npm test`: 60 baseline tests passed, zero failures/skips.
- Dashboard: attendance confirmed and Continuity already selected.
- Project form inspected, not submitted; creation needs name/category/emoji.
- Current Graph target and event deadline rechecked against official pages.
- `npm run graph:preflight` added with fail-closed missing-config handling and sanitized `_meta` output; it has not been run against a live deployment yet.

## Not done

No live Graph adapter, new permit signature, AI tool integration or evidence UI. No live source/deployment/account chosen or verified. The ETHGlobal project profile is now saved and linked to the public repository; final submission remains disabled. No hosting deployment, wallet transaction or outbound message.

Existing test success is baseline regression evidence only. It does not validate the proposed feature, live credentials, source correctness, current deployments or sponsor qualification.

## Known technical issue

`npm audit --json` reports two affected packages in the baseline dependency tree: ethers (moderate) and ws (high, including multiple advisories). This is not proof of an exploitable application path, but requires a scoped dependency review before public deployment. No forced update or dependency mutation was performed during preparation.

## Next development action

Complete PLAN milestone 1: select a real Graph source and prove account-level data plus block freshness. Required founder action: manage Graph account/key access locally if no usable key is available. Never paste secrets into chat.

## Authority boundary

Local setup and documentation are authorized. Public push, paid services, account changes, deployment, portal creation/submission and wallet actions remain separate founder decisions. Local plan files are drafts for implementation, not filed applications.
