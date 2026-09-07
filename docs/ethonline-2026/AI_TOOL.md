# Restricted AI tool

## Primary exposure graph tool

`sentinel_exposure_graph` is the primary restricted boundary for the narrow
Sentinel Exposure Graph demo. It accepts exactly one versioned purchase object:

```json
{
  "schema_version": "sentinel-exposure-buy.v1",
  "action": "BUY_EXPOSURE",
  "asset": "wstETH",
  "unit": "wstETH",
  "requested_units": "2.000000000000000000"
}
```

Print its schema with:

```sh
npm run --silent exposure:tool -- --describe
```

Run the local restricted CLI with an explicitly loaded ignored environment
file (Node does not automatically load `.env.local`):

```sh
printf '%s\n' '{"schema_version":"sentinel-exposure-buy.v1","action":"BUY_EXPOSURE","asset":"wstETH","unit":"wstETH","requested_units":"2.000000000000000000"}' | node --env-file=.env.local scripts/exposure-tool.ts
```

The tool returns the validated request, fixed Graph/RPC query plan, source-
derived exposure graph, token-unit policy and opaque evaluation reference. It
is read-only and cannot choose an account, chain, policy, URL, signer or
execution route. A blocked Graph/RPC source is non-authorizing and exits with
status `2` in the CLI.

`BASE_RPC_URL` is an operator-only server configuration value, not a tool
argument. It may point to a chosen Base Mainnet HTTPS JSON-RPC endpoint; the
adapter verifies chain ID `8453` for a custom endpoint and publishes only a
safe origin label. Credential-bearing path/query details are never returned.
If the endpoint returns HTTP `429`, the tool reports the sanitized
`rpc_rate_limited` reason and remains non-authorizing.

The local CLI invocation is not evidence of a genuine external model/MCP
trace. This repository must not claim a natural-language AI interaction until
a configured client performs that request and the founder records the trace.

## Minimal external client — OpenAI Responses API

The repository now includes a bounded optional client at
`scripts/openai-exposure-client.ts`. It uses the OpenAI Responses API with one
function definition copied from the existing `sentinel_exposure_graph`
contract. The first request lets the model translate natural language into
the exact request shape; the local process validates and runs the existing
read-only tool; the second request gives the model only sanitized policy and
source fields for a short explanation. The client makes at most two external
AI requests, one local tool call and no retries. It never imports signing or
paper-execution routes.

The external call is not acceptance evidence until it is run with founder
approval for possible API usage charges. Setup is local only:

1. In the OpenAI Platform API keys page, create or select a key. Do not paste
   it into chat or commit it.
2. Add the key to the ignored local `.env.local` as `OPENAI_API_KEY=...` and,
   if needed, set `OPENAI_MODEL=...` to a tool-calling model enabled for the
   account. The client uses the fixed official Responses endpoint and does not
   accept a model-supplied URL.
3. Run one bounded request:

```sh
node --env-file=.env.local scripts/openai-exposure-client.ts \
  "Check whether a bounded 0.5 wstETH exposure purchase is allowed."
```

Expected successful output contains `status: "ok"`,
`model_tool_call.name: "sentinel_exposure_graph"`, a sanitized `tool_result`
with source/policy fields, and `model_response`. A missing key returns a
sanitized `missing_configuration` result; a live Graph/RPC failure remains a
non-authorizing tool result and must not be rewritten as success.

## Compatibility position-evidence tool

`sentinel_position_evidence` is the narrow tool contract for an existing AI
client. It lets the client request one canonical Sentinel position-evidence
evaluation without giving the model control over accounts, chains, GraphQL,
provider URLs, signing or execution.

## Contract

Print the machine-readable definition with:

```sh
npm run --silent graph:tool -- --describe
```

The only accepted input is one JSON object with one allowlisted `scenario`:

```json
{"scenario":"allow-btc-buy"}
```

The CLI reads that object from stdin and returns a JSON envelope containing the
validated request, a fixed query plan and the same evidence/policy result as
`POST /api/position-evidence/evaluate`:

```sh
printf '%s\n' '{"scenario":"allow-btc-buy"}' | node --env-file=.env.local scripts/position-evidence-tool.ts
```

The command reads `process.env`; the explicit `--env-file` flag supplies the
ignored local configuration. It never prints the API key. A blocked
configuration or provider failure is returned as a non-authorizing result and
exits with status `2`.

## Natural-language handoff

The AI client performs the natural-language step; the tool does not pretend to
be an LLM. For example:

```text
User: Check the configured Base position before the canonical BTC buy.
AI:  I will call sentinel_position_evidence with {"scenario":"allow-btc-buy"}.
Tool: returns source metadata, normalized observations, gaps and the policy verdict.
AI:  explains the verdict and every gap; it does not invent valuation or claim authorization.
```

The scenario mapping is deliberately small:

| User intent | Tool argument |
| --- | --- |
| approved BTC buy | `allow-btc-buy` |
| oversized ETH order | `deny-oversize-eth` |
| ETH order subject to downsizing | `downsize-eth-buy` |
| oracle/freshness fail-closed case | `fail-closed-oracle` |

The tool rejects unknown fields, custom subjects and arbitrary scenario names.
The account, chain, subgraph deployment, query template, page bound and bearer
credential remain server-side. The tool is read-only: it cannot sign a permit,
submit a transaction, place an order or call an arbitrary URL.

This compatibility contract demonstrates a restricted AI-client boundary. A
hosted model, external MCP registration or natural-language transcript is not
bundled in the public repository and must not be claimed until it is actually
exercised and recorded by the founder. The scenario tool is retained for
regression compatibility and is not the source of the new exposure-graph demo
claim.
