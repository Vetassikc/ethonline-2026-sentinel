# ETHOnline 2026 submission draft

Status: preparation only. This document is public-safe draft copy and founder
instructions; no project record, video upload or final submission is performed
by the repository.

Official requirements checked on September 8, 2026:

- [ETHOnline 2026 rules and submission details](https://ethglobal.com/events/ethonline2026/info/details)
- [The Graph prizes and Continuity qualification](https://ethglobal.com/events/ethonline2026/prizes/the-graph)

## Recommended submission identity

Use these values only after founder review against the current dashboard form:

| Field | Draft value |
| --- | --- |
| Project title | `Sentinel Exposure Graph` |
| Category | `Artificial Intelligence` |
| Emoji | `🛡️` |
| Track/pool | `Continuity` |
| Candidate partner prize | `The Graph — Best AI Tooling or AI Use Case with The Graph (Continuity)` |
| Repository | `https://github.com/Vetassikc/Vartovii-Sentinel-8004` |
| Demo route | `https://sentinel-8004-judge-demo.onrender.com/exposure-graph` |

The partner-prize choice is a founder decision. Select it only if the
dashboard still presents the same Continuity pool. Do not select the From
Scratch pool or attest that the project began during the event.

## Problem statement

Autonomous trading agents can treat a direct wallet balance and a protocol
supply position as unrelated rows even when both represent exposure to the
same underlying asset. A stale or incomplete source can also make a signed
decision unsafe to reuse. Operators need a bounded, inspectable decision before
an agent's request reaches an execution boundary.

## Short pitch

Sentinel Exposure Graph uses The Graph for a live account-position relation and
same-block Base reads to connect direct and Aave wstETH paths to one shared
dependency. It computes exact token-unit headroom under a server-owned cap,
binds a bounded permit to the observed evidence and current conditions, and
rejects reuse when the permit nonce has already been consumed. A restricted
external model can select only the read-only tool request; account, source,
policy, signing and execution authority remain outside model control.

## Architecture and meaningful Graph use

```text
natural-language request
        |
bounded external Responses client
        |
sentinel_exposure_graph + exact request validator
        |
The Graph UserReserve relation ---- same-block Base RPC validation/normalization
        |                                      |
        +---------- exposure graph ------------+
                         |
              exact wstETH cap/headroom policy
                         |
          evidence-bound permit verification
                         |
              local paper executor only
```

The Graph is load-bearing, not decorative. Its Aave `UserReserve` relation,
scaled supply and indexed-block metadata are required inputs. Removing the
relevant relation makes the exposure evaluation non-authorizing. Base RPC
validates contract identity and performs the same-block Aave Ray arithmetic;
it does not replace the Graph query.

The supported policy is intentionally narrow: Base Mainnet, wstETH, one
`BUY_EXPOSURE` action, exact 18-decimal arithmetic and a server-owned cap of
`1.000000000000000000 wstETH`. It is not a USD risk score, general portfolio
manager or on-chain trading executor.

## Continuity disclosure

This is a Continuity extension of the public MIT Sentinel-8004 repository.

### Pre-existing baseline

The continuity reference is the existing `main` line at commit `dbd9a77`.
That baseline contains the public judge mode, trade-intent policy, EIP-712
signing/verification, demo permits, proof artifacts, operator dry-run and
paper-compatible execution previews.

### ETHOnline work in this branch

The new event work begins after that baseline, with the position-evidence and
exposure-graph series beginning at `9c6fe81`. The delivered extension adds:

- live The Graph account-position evidence for the Base/wstETH case;
- same-block Base validation and exact Aave normalized-supply arithmetic;
- a shared-dependency exposure graph and exact cap/headroom policy;
- fresh-condition, evidence-bound demo permits and one-use paper execution;
- the read-only `sentinel_exposure_graph` contract and provider-selectable
  external model boundary; and
- public-safe demo, limitation and acceptance evidence.

Only the event extension should be presented as the new hackathon work. The
baseline is disclosed rather than relabeled as new.

## Demo and reproduction

Use [DEMO.md](./DEMO.md) and the exact narration in
[../../docs/DEMO_SCRIPT.md](../../docs/DEMO_SCRIPT.md). The intended recording
is 2:30–3:00 and keeps these evidence items separate:

1. `LIVE`: Graph/RPC shared-dependency view, cap and calculated headroom.
2. `EXTERNAL TRACE`: the sanitized record in
   [EXTERNAL_AI_TRACE.md](./EXTERNAL_AI_TRACE.md), showing the recorded
   OpenRouter `openai/gpt-5` request, actual tool call, validated arguments and
   live `ALLOW` result.
3. `LIVE`: separately recorded permit verification, `PAPER_EXECUTED` and
   same-permit `NONCE_ALREADY_USED` rejection.
4. `FIXTURE`: invalid input and changed-condition rejection.
5. `SYNTHETIC UI`/`REPLAY`: browser rehearsal, clearly not live account data.

Local checks:

```sh
npm test
printf '%s\n' '{"schema_version":"sentinel-exposure-buy.v1","action":"BUY_EXPOSURE","asset":"wstETH","unit":"wstETH","requested_units":"0.500000000000000000"}' | node --env-file=.env.local scripts/exposure-tool.ts
node --env-file=.env.local scripts/openai-exposure-client.ts \
  "Check whether a bounded 0.5 wstETH exposure purchase is allowed."
```

The last command requires founder-configured local credentials and explicit
approval for a paid request. Do not put credentials in chat or commit them.
The successful external trace is already recorded; no new paid run is needed
for submission preparation.

The external trace includes an
`application_generated_summary`. It is a deterministic summary derived from
validated tool output, explicitly labeled as not completed model prose. The
captured model explanation ended at the bounded output limit and must not be
silently completed by narration or documentation.

## Known limitations and acceptance gaps

- The historical Aave `+1` raw-unit mismatch remains visible and unexplained.
  The deployed arithmetic and rounding were inspected; no arbitrary tolerance
  or consistency bypass was added.
- A reproducible controlled fixture covers rejection of a valid old permit
  after current headroom changes (`CURRENT_HEADROOM_INSUFFICIENT`). This is
  fixture evidence, not a live Aave changed-condition replay.
- The live source exposes `usd_valuation_unavailable` and
  `stale_oracle_price`; the demo remains wstETH-unit based and does not invent
  USD values.
- The paper executor is local and in-memory. It is not on-chain revocation,
  durable authorization, production key management or a live trade.
- The external model/tool chain is demonstrated once through OpenRouter. The
  direct OpenAI `429` and Gemini no-tool attempts are separate diagnostics, not
  interchangeable success evidence. Provider-stable repeatability is not
  claimed.
- Local tests and a live source snapshot do not establish production readiness,
  security assurance or sponsor qualification.
- No public demo account, credential, account balance or raw provider response
  is committed.

## AI attribution draft

> OpenAI Codex/ChatGPT assisted with implementation, testing and documentation
> under founder direction. The founder selected the narrow scope, source
> relation, policy boundary, authority model and acceptance criteria, and
> reviewed the resulting evidence. The repository's external AI trace used
> OpenRouter `openai/gpt-5` once to select the restricted read-only
> `sentinel_exposure_graph` tool. The application validated the arguments and
> generated the displayed summary from tool output; the model did not receive
> signing or execution authority. The captured model explanation was truncated
> by the bounded response budget and is not presented as complete prose.

Public implementation and planning files relevant to the extension include
`api/app/exposure-tool.ts`, `api/app/openai-exposure-client.ts`,
`shared/schemas/exposure-graph.ts`, `docs/ethonline-2026/SPEC.md`,
`docs/ethonline-2026/STATUS.md` and the linked test files. Credentials and
private local configuration are excluded.

## Founder review before publication

Review the draft copy, current live route, source manifest, exact cap and all
limitation labels. Confirm the repository's intended public branch and commit
history. Record the final 2–4 minute video at 720p or higher with the founder's
own narration; do not use an AI voiceover, speed-up or mobile-phone capture.

Publication is a separate action: use the ETHGlobal Hacker Dashboard, attach
the public repository, paste the reviewed description, upload the reviewed
video and select partner prizes only after checking the live form. Nothing in
this draft submits the project.
