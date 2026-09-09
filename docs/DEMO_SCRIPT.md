# Sentinel Exposure Graph — 2–3 minute demo script

This is the primary ETHOnline 2026 recording outline. Keep the recording
between two and four minutes, target about 2:45, use the founder's own spoken
narration and label every evidence source. The live model trace and live paper
execution were recorded separately; the video must not imply one continuous
transactional run.

## 0:00–0:20 — Thesis

Show the title card or `/exposure-graph`.

Say:

> Autonomous agents can hold the same underlying asset through different
> paths. Sentinel Exposure Graph finds that shared dependency and bounds the
> next purchase before a paper permit is accepted. It is a source-attributed
> wstETH policy demo, not a wallet or trading execution product.

## 0:20–0:55 — Shared dependency and cap

Show the live evaluation on `/exposure-graph`.

Say:

> The Graph provides the account-position relation and indexed block. One path
> is a direct wstETH holding; the other is an Aave V3 wstETH supply claim.
> Both converge on one wstETH asset, so the policy counts the dependency once
> per capital path and keeps debt separate. The server-owned cap is exactly
> 1.000000000000000000 wstETH. The displayed gross exposure leaves the shown
> headroom, and the allowed amount is calculated with exact integer arithmetic.

Point to the source status, common block and visible
`usd_valuation_unavailable` / `stale_oracle_price` gaps. Do not invent USD
values.

## 0:55–1:25 — External model/tool evidence

Show the sanitized output of the recorded OpenRouter `openai/gpt-5` run.

Say:

> This is a separate genuine external model invocation. The user asked in
> natural language whether a bounded 0.5 wstETH purchase was allowed. The
> model selected the restricted `sentinel_exposure_graph` function. The local
> validator accepted only the exact versioned request, then the tool returned a
> live source-backed `ALLOW` result at block 51033233.

Highlight the tool name, validated arguments, source status and policy fields.
Then show the `application_generated_summary` field and say:

> The next paragraph is generated deterministically by the application from
> validated tool output. It is explicitly not completed model prose. The
> captured model explanation ended at the bounded output limit, so I preserve
> that limitation instead of filling it in.

Do not show keys, account identifiers or provider URLs. Say that account,
policy, provider configuration, signing and execution remain server-owned or
outside model control.

## 1:25–2:10 — Permit, paper execution and replay

Switch to the separately recorded live paper-execution evidence.

Say:

> This is a different recorded run. A fresh bounded request produced a new
> permit. Independent verification passed its signature, bindings, expiry,
> amount, audience and current-condition checks. The paper executor returned
> `PAPER_EXECUTED`. Reusing that same permit then returned
> `NONCE_ALREADY_USED` with HTTP 409. No wallet transaction was sent.

Show only sanitized permit metadata and the result codes. Do not imply that
the external model signed or executed anything.

## 2:10–2:40 — Negative evidence and limitations

Show a separate validation result for
`10.000000000000000001 wstETH` and say:

> Invalid input is rejected at the bounded request boundary. Separately, the
> changed-condition branch is covered by a controlled fixture: a valid old
> permit is rejected as `CURRENT_HEADROOM_INSUFFICIENT` after fixture
> headroom changes. That is fixture evidence, not a live Aave replay.

Close:

> The one-raw-unit Aave mismatch remains visible and unexplained; no tolerance
> was added. USD/oracle coverage is intentionally limited, paper state is
> in-memory, and this demo does not claim production readiness or sponsor
> qualification.

## Evidence labels to keep on screen

- `LIVE`: current Graph/RPC source-backed evaluation or the separately recorded
  live paper-executor run.
- `EXTERNAL TRACE`: the recorded OpenRouter model/tool round trip.
- `FIXTURE`: controlled changed-condition or invalid-input regression evidence.
- `SYNTHETIC UI` / `REPLAY`: browser rehearsal state, not live account evidence.

For a local planner rehearsal, use the server-issued fixture reference, edit
an exact decimal-string target or ordered step, and press `Evaluate plan`.
Show the response as read-only diagnostic/repair output. Keep the new planner
separate from the restored legacy permit, paper-execution and replay controls;
the planner never enables or reuses those controls.

## Recording rules

- Use at least 720p, clear spoken narration and no AI voiceover.
- Do not speed up the recording or use a mobile phone capture.
- Remove waiting time by editing cuts, but do not merge independent runs into a
  false continuous sequence.
- Keep the repository, source manifest and limitations visible in the written
  submission; the video is a concise proof walkthrough, not a production claim.
