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

The local CLI invocation is not evidence of a genuine external model/MCP
trace. This repository must not claim a natural-language AI interaction until
a configured client performs that request and the founder records the trace.

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
