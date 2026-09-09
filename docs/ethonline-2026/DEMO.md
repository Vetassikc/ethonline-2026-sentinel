# Demo and acceptance — Sentinel Exposure Graph

Target duration: 2:30–3:00. The primary screen is `/exposure-graph`; the
external model trace and paper-execution evidence are supporting, separately
recorded surfaces. Do not edit separate runs together as if they were one
continuous live execution.

## Coherent recording sequence

### 0:00–0:20 — Problem and boundary

Say:

> An agent can see a direct wstETH holding and an Aave supply position as two
> rows, while both are claims on the same wstETH dependency. Sentinel turns
> that shared dependency into a bounded, source-attributed policy decision
> before a paper permit is accepted. This demo is denominated in wstETH, not
> USD, and does not submit a wallet transaction.

### 0:20–0:55 — Live shared-dependency graph

Open `/exposure-graph` with the configured live source and show the `LIVE`
label. Point to the direct holding path and the Aave `UserReserve`/supply path
converging on one wstETH asset. Show the server-owned cap of
`1.000000000000000000 wstETH`, then read the displayed gross exposure,
headroom and allowed amount from that same evaluation. Do not hardcode a new
number if the live snapshot has changed.

Explain that The Graph supplies the account-position relation and indexed
block, while the same-block Base read validates and normalizes the Aave path.
Keep `usd_valuation_unavailable` and `stale_oracle_price` visible.

For the implemented local planner rehearsal, the same route starts with an
explicit `FIXTURE` template. It is editable: change the exact target or any
ordered step, then press `Evaluate plan` and show the resulting
`POST /api/exposure/plan/validate` result. The source selector offers a separate
qualified-live path; if that source is unavailable, keep the error visible and
do not substitute the fixture.

### 0:55–1:25 — Genuine model tool trace, separate live run

Show the sanitized output from the recorded OpenRouter `openai/gpt-5` run in
[EXTERNAL_AI_TRACE.md](./EXTERNAL_AI_TRACE.md). The important evidence is:

1. natural-language request;
2. actual model-selected `sentinel_exposure_graph` call;
3. validated `sentinel-exposure-buy.v1` arguments for `0.5 wstETH`;
4. live tool result: source `ok`, block `51033233`, policy `ALLOW`.

Show `application_generated_summary` and say explicitly:

> This is an application-generated summary derived from validated tool output,
> not completed model prose. The captured model explanation stopped at the
> bounded output limit; the tool/source chain is demonstrated, while prose
> completeness is not.

Keep the account, cap, provider URL, signing and execution authority outside
the model boundary. Do not show the API key or raw provider response.

### 1:25–2:15 — Permit and paper execution, another separate live run

Switch to the separately recorded live paper-executor evidence. Show a fresh
`0.500000000000000000 wstETH` evaluation, permit verification with the
executable checks, `PAPER_EXECUTED`, and then the second use of the same permit
returning `NONCE_ALREADY_USED` with HTTP `409`.

Narrate that this is paper-only evidence from a separate run; it is not the
same request or continuous execution as the external model trace.

### 2:15–2:45 — Negatives and limitations

Show the boundary rejection for
`10.000000000000000001 wstETH` as a separate invalid-input case. If showing
changed-condition rejection, label it `FIXTURE`: a valid old permit is
rejected as `CURRENT_HEADROOM_INSUFFICIENT` when the refreshed fixture has no
headroom. The fixture proves the authorization-drift branch; it is not live
Aave evidence.

Close with the unresolved one-raw-unit Aave mismatch, explicit USD/oracle
gaps, in-memory paper state and the absence of production/on-chain execution.

The browser rehearsal is `FIXTURE`/`REPLAY` synthetic UI evidence. The live
Graph/RPC snapshot, external model trace and paper-executor run are separate
recorded evidence items and must retain those labels in the video and notes.

## Reproduction surfaces

From the repository root:

```sh
npm test
printf '%s\n' '{"schema_version":"sentinel-exposure-buy.v1","action":"BUY_EXPOSURE","asset":"wstETH","unit":"wstETH","requested_units":"0.500000000000000000"}' | node --env-file=.env.local scripts/exposure-tool.ts
node --env-file=.env.local scripts/openai-exposure-client.ts \
  "Check whether a bounded 0.5 wstETH exposure purchase is allowed."
```

The external command requires a founder-configured provider key and explicit
approval for any paid request. The recorded run used OpenRouter with
`openai/gpt-5`; do not retry it automatically. The command output must include
the actual model tool call, validated `tool_result` and the deterministic
`application_generated_summary`. A partial `model_response` must not be
rewritten or presented as complete prose.

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
- [x] One bounded live HTTP paper-executor run returned `PAPER_EXECUTED`; a
  second execution of the same permit returned `NONCE_ALREADY_USED` with
  `409`. This is paper-only evidence, not a wallet transaction or a claim of
  provider-stable repeatability.
- [x] One bounded external natural-language AI/tool invocation completed
  through OpenRouter `openai/gpt-5`: the model called
  `sentinel_exposure_graph`, the local validator/tool ran, and the live result
  returned `ALLOW` for `0.500000000000000000 wstETH` with source status `ok`.
  No signing or execution occurred. The earlier direct OpenAI `429` and
  OpenRouter Gemini `model_did_not_call_tool` results remain separate failed
  variants; the final model prose ended at the bounded output limit.
- [ ] Founder review, dependency review, clean-install reproduction, media,
  deployment and submission remain separate gates.

## Public wording boundary

Say “source-attributed signal,” “policy-based decision,” “bounded paper
permit” and “based on configured inputs.” Do not say guaranteed, compliant by
default, safe investment, audited, production-ready, on-chain enforced or
verified truth. USD valuation and broad portfolio coverage are not part of
this version.
