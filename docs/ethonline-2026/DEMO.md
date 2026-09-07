# Demo and acceptance — Sentinel Exposure Graph

Target duration: approximately three minutes. The primary screen is
`/exposure-graph`; the local tool and API routes are supporting inspection
surfaces. Use a configured live source only when its provider is available.
Never hide a live failure behind a fixture.

## Storyboard

1. Open `/exposure-graph`. Show the exact request
   `2.000000000000000000 wstETH`, the server-owned cap and the
   `LIVE`/`REPLAY`/`DEMO SIGNER`/`PAPER EXECUTOR` labels.
2. Evaluate the request. In a live run, show The Graph indexed block and the
   same-block Base validation. The two paths converge on one wstETH asset;
   the policy derives gross exposure, headroom and an allowed amount in
   wstETH units. If the public RPC returns `429`, show the non-authorizing
   error and stop; do not refresh into a fixture silently.
3. Click the direct and Aave paths. Show each source field or contract method,
   block, units, transformation and explicit gap state. Explain that the
   Graph `UserReserve` relation is required and RPC validates/normalizes it.
4. Issue the demo-only permit for the server-selected bounded amount. Show
   its graph hash, policy version, snapshot block, expiry and audience without
   exposing an account or signature in a public capture. Pure verification
   does not consume the nonce.
5. Run paper execution. The executor obtains a fresh server-owned evaluation,
   checks the relevant conditions and consumes the nonce once.
6. Run the labeled replay. It changes the snapshot/headroom and returns
   `REPLAY: DENY`. Local tests separately demonstrate that a valid old
   signature can remain verifiable while current paper execution rejects the
   changed condition.

The browser rehearsal completed this sequence against synthetic fixture data.
That result is a UI rehearsal, not a live account or sponsor-qualification
claim. The live source manifest and CLI acceptance must be reported separately.

## Acceptance ledger

- [x] The Graph and Base RPC qualify one narrow, attributable wstETH shared
  dependency case at a common block when the provider is available.
- [x] Graph removal/provider failure is non-authorizing; no old decision or
  fixture is silently reused.
- [x] Direct and Aave paths converge on one asset without receipt/underlying
  double counting; debt is displayed separately.
- [x] Fixed-point boundary tests cover cap equality, downsizing, zero headroom,
  malformed quantities and missing paths.
- [x] Exact request validation rejects custom accounts, chains, URLs, policy
  overrides, unsupported assets and excessive precision.
- [x] Permit tests cover signature/binding/expiry/amount/audience checks,
  one-use nonce, concurrency and fresh-condition denial.
- [x] The full narrow synthetic browser flow and responsive layout were
  exercised without configured account data in the capture.
- [x] A provider-available live browser evaluation and permit verification were
  refreshed with a server-configured HTTPS Base RPC; direct and Aave paths
  were inspected against the same live block.
- [ ] A provider-stable successful fresh paper-executor run remains
  unrecorded. The observed live refreshes returned non-authorizing `409`
  outcomes (`CURRENT_HEADROOM_INSUFFICIENT` or `CURRENT_SOURCE_UNAVAILABLE`).
- [ ] A genuine external natural-language AI/MCP invocation is not recorded.
- [ ] Founder review, dependency review, clean-install reproduction, media,
  deployment and submission remain separate gates.

## Public wording boundary

Say “source-attributed signal,” “policy-based decision,” “bounded paper
permit” and “based on configured inputs.” Do not say guaranteed, compliant by
default, safe investment, audited, production-ready, on-chain enforced or
verified truth. USD valuation and broad portfolio coverage are not part of
this version.
