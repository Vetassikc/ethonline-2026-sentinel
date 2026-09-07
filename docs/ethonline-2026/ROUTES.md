# Routes and module interfaces

## Existing baseline — available now

| Route | Purpose |
| --- | --- |
| `/` | Existing hub |
| `/judge` | Existing judge demo |
| `/operator` | Existing operator interface |
| `GET /healthz` | Server health |
| `GET /api/demo/scenarios` | Existing scenario list |
| `POST /api/demo/evaluate-intent` | Existing trade policy evaluation |
| `POST /api/demo/run-pipeline` | Existing demonstration pipeline |
| `POST /api/demo/verify-permit` | Existing demo verdict verification |
| `POST /api/demo/verify-signed-intent` | Existing signed-intent verification |

These routes are historical baseline surfaces and are kept regression-covered.

## Exposure Graph screen and read-only tool

| Surface | Boundary |
| --- | --- |
| `GET /exposure-graph` | Judge-readable request, graph, policy, permit, paper and replay screen |
| `GET /api/exposure/config` | Server-owned supported action, cap, TTL and source metadata; no credential |
| `sentinel_exposure_graph` | Local read-only exact-schema tool around the same evaluation service |
| `npm run --silent exposure:tool -- --describe` | Prints the restricted tool schema without contacting providers |

The browser cannot select an account, chain, cap, policy, provider URL or
signer. It submits only the validated request and opaque server references.
The local tool is not evidence of a natural-language external model or MCP
invocation.

## Exposure API — delivered

| Route | Accepted body | Response / boundary |
| --- | --- | --- |
| `POST /api/exposure/evaluate` | Exact `sentinel-exposure-buy.v1` request | Graph, provenance, unit policy and opaque evaluation reference; provider failure is `503` and `DENY` |
| `POST /api/exposure/permit` | `evaluation_ref`, optional bounded `nonce`/`audience` | Demo-only EIP-712 permit from a server-held non-denied evaluation |
| `POST /api/exposure/verify` | Exact request and signed permit | Pure signature/binding/expiry/amount verification; does not consume a nonce |
| `POST /api/exposure/paper-execute` | Exact request and signed permit | Fresh server-side evaluation, condition check and one-use paper execution |
| `POST /api/exposure/replay` | `evaluation_ref` only | Explicit `REPLAY` denial with changed block/hash/headroom; never calls a provider |

Request bodies are bounded and reject unknown fields, arbitrary subjects,
arbitrary URLs, policy overrides and unsupported assets. A browser-supplied
`ALLOW`, graph hash or permit is never enough to request signing. Evaluation
references, consumed nonces and pending-account locks are bounded in-memory
state for the local demo and are lost on restart.

HTTP `400` means malformed input or an unknown/expired reference. HTTP `503`
means provider/source unavailability and is non-authorizing. HTTP `409` means
paper execution was rejected by current conditions, signature/nonce state or
the pending-account boundary. A policy `DENY` with valid source input is a
normal evaluation result.

## Older event route — retained compatibility slice

| Route | Purpose |
| --- | --- |
| `GET /position-evidence` | Earlier read-only normalized evidence screen |
| `POST /api/position-evidence/evaluate` | Earlier baseline TradeIntent + Graph evidence policy |

The older route and `sentinel_position_evidence` tool remain available for
regression and continuity. They are not the Exposure Graph positive-value
workflow and must not be described as USD-qualified authorization.

## Module boundaries

- `api/app/graph-client.ts` — fixed The Graph query, pagination and source metadata.
- `api/app/base-rpc.ts` — fixed Base RPC block/contract/balance validation and Ray normalization.
- `api/app/exposure-graph.ts` — typed graph construction and provenance.
- `api/app/exposure-policy.ts` — exact wstETH-unit accounting and cap decision.
- `api/app/exposure-request.ts` — request schema and bounds.
- `api/app/exposure-service.ts` — server-owned evaluation and TTL references.
- `api/app/exposure-permit.ts` — demo EIP-712 signing and pure verification.
- `api/app/condition-check.ts` — fresh-condition paper executor boundary.
- `api/app/exposure-tool.ts` / `scripts/exposure-tool.ts` — restricted read-only tool.
- `web/exposure-graph.js` — server-route rendering only; no credentials or policy authority.

The Graph remains a required source for the qualified position relation. A
missing Graph row or provider failure produces no authorizing evaluation.
