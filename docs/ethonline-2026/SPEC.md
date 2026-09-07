# Position Evidence v1 — implementation specification

Status: normalization, hashing, evidence policy, demo permit and the read-only evaluation UI/route are implemented. AI invocation and permit/verifier HTTP presentation remain proposed. Read [DATA_ACCESS.md](DATA_ACCESS.md) before selecting protocol-specific fields.

## User story

As an agent operator, I want a requested trade checked against fresh, attributable position observations so that an unexplained or stale AI answer cannot produce an apparently valid authorization.

## Architecture

```text
Natural-language request in an AI client
  -> validated, allowlisted evidence request / visible query plan
  -> server-side Graph adapter + source freshness validation
  -> normalized evidence and explicit gaps
  -> deterministic evidence policy + existing trade policy
  -> bounded permit with evidenceHash and intentHash
  -> independent verification + paper execution preview
```

The model does not choose policy limits, invent missing values, sign arbitrary payloads, or execute trades. AI-generated arguments are untrusted. A fixed query template and validated variables are preferable to executing arbitrary generated GraphQL.

## Evidence envelope: position_evidence.v1

Required fields in this repository's public JSON contract: `schema_version`, `subject` (chain ID, account, protocol deployment), `query` (template ID/version, variables hash), `source` (provider, deployment ID, indexed block number/hash/timestamp, fetched-at time, indexing-error status), `observations`, `gaps`, `quality`, `mode` (`live` or `fixture`) and `evidence_hash`. Monetary quantities use decimal strings with explicit units; do not use floating-point arithmetic for authorization.

Each observation identifies its field, source response path, value, units and block provenance. Each gap has a stable reason code. Account, chain and deployment must match the request. A null response is not a zero balance. A missing page is not a complete portfolio. Reject partial, malformed or unbounded paginated data for required signals.

`evidence_hash` is computed over a defined canonical payload excluding the hash field itself. Pin serialization rules: recursively sorted object keys, preserved array order, UTF-8, no undefined/NaN/Infinity, amounts as strings. Use keccak256 for compatibility with EIP-712 bytes32. Hashes prove payload consistency, not source truth, completeness or safety.

Freshness uses the indexed block timestamp, not merely the time of HTTP retrieval. Verify timestamp/block correspondence using source metadata or a read-only RPC lookup of the same block. Unknown timestamp, excessive index lag, indexing errors or inconsistent block identity are gaps. Initial maximum evidence age: 300 seconds, configurable and versioned; validate this against the chosen deployment before freezing it. Clock in tests is injected; future source times outside a documented tolerance fail closed.

## Policy contract

Input: validated existing TradeIntent, normalized evidence, explicit policy version and current time. Output: `ALLOW`, `ALLOW_WITH_DOWNSIZE` or `DENY`, reason codes, requested amount, maximum permitted amount, evidenceHash and expiry. Retain all stricter constraints from the existing trade policy. The evidence layer can restrict authorization, never override an existing DENY.

Initial rule family: fresh known position exposure plus configured exposure ceiling determines remaining permitted notional. The source must provide the quantities and valuation provenance required to calculate that exposure. Otherwise DENY; do not invent a price or substitute protocol-wide TVL for account exposure. Exact protocol field mapping and valuation equation are frozen only after the source feasibility gate.

Negative cases include missing data, stale evidence, source errors, account/chain mismatch, unsupported market, negative/invalid amount, incomplete pagination and unknown valuation. All must deny. A successful refresh changes the evidence payload/hash; it does not guarantee ALLOW if exposure still exceeds policy.

## Implemented evidence slice

`api/app/position-evidence.ts` converts the live Graph adapter result into a deterministic `position_evidence.v1` envelope. It preserves raw integer amounts, adds fixed-scale decimal strings without floating-point arithmetic, records query/source provenance and response paths, carries explicit gaps, and computes a `keccak256` `evidence_hash` over the canonical payload without the hash field. A stale indexed block, missing block metadata, indexing error, incomplete pagination, empty observations, subject mismatch, malformed amount or unavailable USD valuation produces a `DENY` quality verdict. Missing amounts remain `null`; they are never converted to zero.

The current live source is expected to remain `DENY` until a separately attributed, freshness-checked valuation source is qualified. This is an intentional fail-closed result, not a claim that the account is unsafe.

`api/app/evidence-policy.ts` is the implemented quality gate. It rejects malformed or internally inconsistent envelopes, converts any `DENY` quality result into a `DENY` policy decision, and otherwise preserves the existing deterministic trade-policy result without changing its limits. It does not yet calculate account exposure; that equation remains blocked on a qualified valuation source.

## Permit and verifier

Baseline warning: `policy.ts` uses a deterministic demo verdict signature. Real EIP-712 trade-intent signing in `erc8004.ts` does not make that verdict cryptographically signed.

New permit must bind: schema/policy version, intentHash, evidenceHash, subject chain/account, authorized notional, issued-at, expiry, nonce and intended paper executor/audience. Use real EIP-712 signing with an isolated local demo signer, identified visibly as a demo trust root. Never use the user's funded wallet key. Document the EIP-712 domain and replay boundary.

Verifier independently recomputes hashes, validates signature against the configured signer, checks expiry and bindings, checks amount is within authorization, and enforces one-use nonce in the demo executor. A signer carried inside an attacker-controlled payload is not a trusted signer. Do not silently fall back to baseline demo-signature verification.

No on-chain enforcement is claimed. “Denied” means denied by this prototype's policy/executor boundary, not prevented everywhere on a blockchain. Observed mainnet data and local/testnet authorization must be explicitly labeled; never relabel one chain's evidence as another chain's position.

## Non-functional requirements

Keep the existing Node/TypeScript + ethers stack and plain web interface. No new infrastructure is required for local development. Keys stay server-side in ignored local configuration. Fixed provider host, bounded requests, timeouts, payload limits and redacted errors. Read-only AI tooling cannot accept arbitrary network URLs or transactions.

Fixtures remain useful for tests and clearly labeled outage rehearsal; they are never silently substituted for live data. A live failure must remain visible.
