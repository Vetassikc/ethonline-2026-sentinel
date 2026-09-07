# Status — September 7, 2026

## Verified now

- Isolated public upstream clone exists in the requested Code directory; original project directories were not changed.
- Baseline SHA: `dbd9a779bdea5b4f1f93dc13f52ea309c76b7142`.
- Local branch: `ethonline-2026/position-evidence`.
- `npm ci --ignore-scripts` completed using the lockfile.
- `npm test`: 83 tests passed, zero failures/skips.
- Dashboard: attendance confirmed and Continuity already selected.
- ETHGlobal project profile is saved and linked to the public repository; final submission remains disabled.
- Current Graph target and event deadline rechecked against official pages.
- `npm run graph:preflight` returned live `status: ok` for the configured source, with a fresh indexed block and no provider indexing errors.
- Schema introspection returned `userReserves`, `UserReserve`, `Reserve`, `Supply` and `Borrow`.
- `api/app/graph-client.ts` and `npm run graph:position` now perform a fixed, bounded, cursor-paginated read-only account query with sanitized errors, raw units, block provenance and explicit gaps.
- A live smoke query returned seven positions and completed one page without indexing errors; the count is observational and not committed portfolio data.
- `api/app/position-evidence.ts` and `shared/schemas/position-evidence.ts` now normalize the Graph result into `position_evidence.v1`, preserve exact raw/decimal amounts, record provenance and gaps, and compute a canonical `keccak256` evidence hash.
- Missing Graph amounts remain `null` instead of being represented as an invented zero; the regression suite covers this fail-closed boundary.
- `npm run graph:evidence` renders the live adapter response as the public-safe normalized envelope without printing the Graph API key.

## Not done

No evidence policy, new permit signature, AI tool integration or evidence UI. The configured source is conditionally viable for position observations and deterministic evidence packaging, but not yet qualified for a USD-based permit policy: it exposes `priceInEth` and the sampled oracle timestamps were stale. No public demo account is frozen in the repository. No hosting deployment, wallet transaction or outbound message.

Existing test success is baseline regression evidence only. It does not validate the proposed feature, live credentials, source correctness, current deployments or sponsor qualification.

## Known technical issue

`npm audit --json` reports two affected packages in the baseline dependency tree: ethers (moderate) and ws (high, including multiple advisories). This is not proof of an exploitable application path, but requires a scoped dependency review before public deployment. No forced update or dependency mutation was performed during preparation.

## Next development action

Complete PLAN milestone 2: choose a separately attributed, freshness-checked valuation source (or explicitly choose a non-USD policy signal), then wrap the normalized evidence in a deterministic policy without weakening the existing trade policy. Required founder action: review the live envelope and its `DENY` gaps. Never paste secrets into chat.

## Authority boundary

Local setup and documentation are authorized. Public push, paid services, account changes, deployment, portal creation/submission and wallet actions remain separate founder decisions. Local plan files are drafts for implementation, not filed applications.
