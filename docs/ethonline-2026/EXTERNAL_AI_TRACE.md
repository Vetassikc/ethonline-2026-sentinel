# Recorded external AI/tool trace

Status: `RECORDED LIVE TRACE`. This is a sanitized record of the bounded
OpenRouter run already performed on September 8, 2026. Adding the deterministic
summary renderer did not trigger another provider request.

## Request and model call

Provider: `openrouter_responses_api`
Model: `openai/gpt-5`
Natural-language request:

> Check whether a bounded 0.5 wstETH exposure purchase is allowed. Report the
> source status, policy verdict and any visible gaps; do not sign or execute
> anything.

The provider returned the actual restricted function call:

```json
{
  "name": "sentinel_exposure_graph",
  "arguments": {
    "schema_version": "sentinel-exposure-buy.v1",
    "action": "BUY_EXPOSURE",
    "asset": "wstETH",
    "unit": "wstETH",
    "requested_units": "0.5"
  }
}
```

The local validator accepted the arguments and ran the existing read-only tool.
No signing or execution route was available to the model.

## Sanitized live tool result

```json
{
  "status_code": 200,
  "tool_name": "sentinel_exposure_graph",
  "mode": "live",
  "source_status": "ok",
  "block": 51033233,
  "path_kinds": ["direct_holding", "aave_supply"],
  "policy_verdict": "ALLOW",
  "requested_units": "0.500000000000000000",
  "allowed_units": "0.500000000000000000",
  "gross_exposure_units": "0.000012505725903091",
  "headroom_units": "0.999987494274096909",
  "binding_constraint": "none",
  "reason_codes": [],
  "gaps": ["usd_valuation_unavailable", "stale_oracle_price"]
}
```

## Application-generated summary

The following is the deterministic human-readable summary produced from the
validated sanitized tool result by `buildApplicationGeneratedSummary`. It is
not completed model prose:

> Application-generated summary (derived from validated tool output; not
> completed model prose).
> Source: ok; mode: live; block: 51033233.
> Policy: ALLOW; requested 0.500000000000000000 wstETH; allowed
> 0.500000000000000000 wstETH.
> Exposure: gross 0.000012505725903091 wstETH; headroom
> 0.999987494274096909 wstETH; binding constraint none; reason codes none.
> Paths: direct_holding, aave_supply.
> Visible gaps: usd_valuation_unavailable, stale_oracle_price.
> Authority: read-only; account, policy, provider, signing and execution
> remain outside model control.

The captured provider explanation ended at the bounded output limit. It is
retained as incomplete model output and must not be narrated as a finished
explanation. This record demonstrates the model/tool/source chain, not
provider-stable repeatability or production readiness.
