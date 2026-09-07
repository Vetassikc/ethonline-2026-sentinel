import {
  EXPOSURE_REQUEST_SCHEMA_VERSION,
  type ExposureRequest,
} from "../../shared/schemas/exposure-graph.ts";
import { parseFixedUnits } from "./exposure-policy.ts";

export const MAX_EXPOSURE_REQUEST_UNITS = "10.000000000000000000";

export type ExposureRequestValidation =
  | { ok: true; request: ExposureRequest }
  | {
    ok: false;
    error: { code: "invalid_exposure_request"; details: string[] };
  };

function invalid(...details: string[]): ExposureRequestValidation {
  return {
    ok: false,
    error: { code: "invalid_exposure_request", details },
  };
}

export function validateExposureRequest(input: unknown): ExposureRequestValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid("Request must be a JSON object.");
  }
  const value = input as Record<string, unknown>;
  const expected = ["schema_version", "action", "asset", "unit", "requested_units"].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return invalid("Only schema_version, action, asset, unit and requested_units are accepted.");
  }
  if (value.schema_version !== EXPOSURE_REQUEST_SCHEMA_VERSION) {
    return invalid("schema_version must be sentinel-exposure-buy.v1.");
  }
  if (value.action !== "BUY_EXPOSURE") return invalid("action must be BUY_EXPOSURE.");
  if (value.asset !== "wstETH") return invalid("asset must be wstETH.");
  if (value.unit !== "wstETH") return invalid("unit must be wstETH.");
  if (typeof value.requested_units !== "string" || value.requested_units.length === 0) {
    return invalid("requested_units must be a non-empty fixed-point string.");
  }

  let requested: bigint;
  let maximum: bigint;
  try {
    requested = parseFixedUnits(value.requested_units);
    maximum = parseFixedUnits(MAX_EXPOSURE_REQUEST_UNITS);
  } catch {
    return invalid("requested_units must be a non-negative amount with at most 18 decimals.");
  }
  if (requested <= 0n) return invalid("requested_units must be greater than zero.");
  if (requested > maximum) return invalid("requested_units exceeds the bounded request maximum.");

  return {
    ok: true,
    request: {
      schema_version: EXPOSURE_REQUEST_SCHEMA_VERSION,
      action: "BUY_EXPOSURE",
      asset: "wstETH",
      unit: "wstETH",
      requested_units: value.requested_units,
    },
  };
}
