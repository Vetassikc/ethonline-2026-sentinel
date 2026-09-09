import test from "node:test";
import assert from "node:assert/strict";

import { legacyControlState } from "../../web/exposure-graph.js";

test("eligible legacy evaluation enables permit and stored replay controls", () => {
  const controls = legacyControlState({
    status: "ok",
    evaluation_ref: "exposure_abcdabcdabcdabcdabcdabcdabcdabcd",
    policy: { verdict: "ALLOW", allowed_units: "0.500000000000000000" },
  });
  assert.deepEqual(controls, {
    issuePermitEnabled: true,
    replayEnabled: true,
    paperExecuteEnabled: false,
  });
});

test("denial and source failure leave legacy authorization disabled", () => {
  assert.deepEqual(legacyControlState({
    status: "blocked",
    evaluation_ref: null,
    policy: { verdict: "DENY", allowed_units: "0.000000000000000000" },
  }), {
    issuePermitEnabled: false,
    replayEnabled: false,
    paperExecuteEnabled: false,
  });

  assert.deepEqual(legacyControlState({ status: "blocked", evaluation_ref: null }), {
    issuePermitEnabled: false,
    replayEnabled: false,
    paperExecuteEnabled: false,
  });
});

test("planner results cannot enable legacy signing or execution", () => {
  assert.deepEqual(legacyControlState({
    status: "ok",
    evaluation_ref: null,
    evaluation: { policy_status: "PASS", paper_eligibility: "ELIGIBLE" },
  }), {
    issuePermitEnabled: false,
    replayEnabled: false,
    paperExecuteEnabled: false,
  });
});
