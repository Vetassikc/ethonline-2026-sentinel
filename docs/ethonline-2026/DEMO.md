# Demo and acceptance

Target duration: approximately 3 minutes. The Position Evidence route now delivers the intent → live Graph source → normalized evidence → policy decision slice. Permit/verifier presentation and genuine AI invocation are still follow-up work.

## Storyboard

0:00–0:20 — Open `/position-evidence` and show one requested trade. Explain: “An agent can sound confident while its position data is stale. Sentinel requires evidence before authorization.”

0:20–0:55 — Use a clearly labeled stale-evidence replay for the same intent. Show indexed block time, the freshness gap and DENY. Do not disguise an injected test condition as a live network incident.

0:55–1:40 — Refresh through the real Graph provider. Show the fixed query's source, indexed block, freshness, normalized observations and explicit gaps. The current configured source is expected to display `DENY`; do not hard-code an ALLOW or disguise a fixture as live data.

1:40–2:20 — Show the bound intentHash/evidenceHash, permitted amount and expiry. Verify the permit independently. Change an amount or observation; verification must fail.

2:20–3:00 — Explain what existed before ETHOnline, what is new, how The Graph changes the decision, and the prototype boundary: paper execution, source limitations and no security guarantee.

## Release acceptance

- [ ] Genuine AI client invokes the restricted tool from a natural-language request.
- [ ] Genuine live Graph response with source identity, account/chain and freshness.
- [ ] Unknown/stale/partial evidence denies; no silent fixture fallback.
- [ ] Positive and downsize paths derive from documented source quantities.
- [ ] Existing policy DENY cannot be overridden.
- [ ] Real new permit signature, trusted signer and replay/expiry checks.
- [ ] Tampered intent, evidence, amount and signer all fail verification.
- [x] New evidence route works; old judge regression tests remain green.
- [ ] Clean-install reproduction and dependency review complete.
- [ ] README, continuity diff, AI attribution and video match actual behavior.
- [ ] No secrets, real private portfolio data or unsupported claims in artifacts.

Reputation assets after founder approval: one clear public repository entry point, a small reusable evidence-policy module, a readable limitations section and a short demonstration. Do not equate views, submissions or awards with revenue or adoption.
