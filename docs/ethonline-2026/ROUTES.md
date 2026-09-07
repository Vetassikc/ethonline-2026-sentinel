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
| `POST /api/demo/verify-permit` | Existing demo verdict verification, not the new evidence verifier |
| `POST /api/demo/verify-signed-intent` | Existing signed-intent verification |

Source: `api/app/server.ts` at continuity baseline. This table is not an exhaustive API inventory.

## Planned new routes — not implemented

| Route | Request | Response / boundary |
| --- | --- | --- |
| `GET /position-evidence` | none | One-screen feature UI |
| `POST /api/position-evidence/evaluate` | validated TradeIntent, allowlisted subject, mode | evidence envelope + policy result; DENY on unavailable required evidence |
| `POST /api/position-evidence/permit` | server-issued evaluation reference | demo-signed bounded permit only for still-valid allowed evaluation |
| `POST /api/position-evidence/verify` | permit, intent, evidence | independently validated result and stable reason codes |

HTTP 400: malformed request. HTTP 503: provider unavailable, with an explicit non-authorizing result. Policy DENY with valid inputs is a normal evaluation result. No response may contain an API key. A browser-supplied ALLOW or evidence hash is never sufficient to request signing.

Evaluation references refer to server-held payloads with expiry. Start with bounded in-memory storage for local demo; state is lost on restart and must be labeled. Reject unknown/expired references. Do not imply durable production authorization.

## Planned module boundaries

- `graph-client.ts`: typed fixed-template request -> validated source response; no policy or signing.
- `position-evidence.ts`: source response -> normalized envelope/hash (implemented).
- `evidence-policy.ts`: evidence quality gate -> `DENY` or unchanged existing trade-policy result (implemented); exposure equation remains pending valuation qualification.
- `evidence-permit.ts`: trusted server evaluation -> demo-only EIP-712 permit; independent verification recomputes intent/evidence bindings and enforces a one-use nonce boundary (implemented).
- `scripts/position-evidence.ts`: narrow JSON tool entry point for the live envelope (implemented); AI-client wiring remains pending. No arbitrary URLs or execution capability.
- `web/position-evidence.js`: render server results; never authorize or hold credentials.

Do not modify the existing TradeIntent to pretend a lending withdrawal is a supported trade. If action semantics must change, explicitly revise SPEC and add action validation before adding routes.
