import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_EXPOSURE_REQUEST_UNITS,
  validateExposureRequest,
} from "../app/exposure-request.ts";

const VALID = {
  schema_version: "sentinel-exposure-buy.v1",
  action: "BUY_EXPOSURE",
  asset: "wstETH",
  unit: "wstETH",
  requested_units: "2.000000000000000000",
};

test("validateExposureRequest accepts only the versioned fixed wstETH purchase shape", () => {
  const result = validateExposureRequest(VALID);

  assert.deepEqual(result, { ok: true, request: VALID });
});

test("validateExposureRequest rejects unknown fields and arbitrary account/chain/url input", () => {
  const unknown = validateExposureRequest({ ...VALID, account: "0xabc" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.error.code, "invalid_exposure_request");

  const policy = validateExposureRequest({ ...VALID, policy: { cap: "999" } });
  assert.equal(policy.ok, false);
});

test("validateExposureRequest rejects wrong action, asset, unit and schema version", () => {
  for (const field of [
    { action: "SELL_EXPOSURE" },
    { asset: "ETH" },
    { unit: "USD" },
    { schema_version: "sentinel-exposure-buy.v2" },
  ]) {
    assert.equal(validateExposureRequest({ ...VALID, ...field }).ok, false);
  }
});

test("validateExposureRequest rejects empty, negative, too-precise and oversized amounts", () => {
  for (const requested_units of [
    "",
    "0",
    "-1.000000000000000000",
    "1.0000000000000000001",
    `${MAX_EXPOSURE_REQUEST_UNITS}.000000000000000001`,
  ]) {
    assert.equal(validateExposureRequest({ ...VALID, requested_units }).ok, false);
  }
});

test("validateExposureRequest rejects non-object input", () => {
  assert.equal(validateExposureRequest(null).ok, false);
  assert.equal(validateExposureRequest([]).ok, false);
  assert.equal(validateExposureRequest("request").ok, false);
});
