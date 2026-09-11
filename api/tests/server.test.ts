import test from "node:test";
import assert from "node:assert/strict";

import { buildKrakenCliPaperSmokeArtifact } from "../app/kraken-cli-compat.ts";
import { buildKrakenExecutionPreview } from "../app/execution-preview.ts";
import { buildSignedTradeIntentBundle, verifySignedTradeIntentBundle } from "../app/erc8004.ts";
import { handleJudgeModeRequest, resolveServerConfig } from "../app/server.ts";
import { evaluateTradeIntent, verifyTradePermit } from "../app/policy.ts";
import {
  buildAgentRegistryAnchorPlan,
  getSharedSepoliaContracts,
} from "../app/shared-sepolia.ts";
import {
  loadExpectedExecutionPreview,
  loadExpectedVerdict,
  loadScenarioIntent,
  loadSignedIntentBundle,
} from "../app/scenarios.ts";

test("resolveServerConfig defaults to localhost for local development", () => {
  assert.deepEqual(resolveServerConfig({}), {
    host: "127.0.0.1",
    port: 8787,
  });
});

test("resolveServerConfig respects deployment-style host and port overrides", () => {
  assert.deepEqual(resolveServerConfig({ PORT: "10000", HOST: "0.0.0.0" }), {
    host: "0.0.0.0",
    port: 10000,
  });
});

test("GET /healthz returns a deployment-friendly health payload", async () => {
  const response = await handleJudgeModeRequest("GET", "/healthz", "");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, {
    status: "ok",
    service: "vartovii-sentinel-8004",
    judge_mode: true,
  });
});

test("GET / returns the hosted submission hub HTML", async () => {
  const response = await handleJudgeModeRequest("GET", "/", "");
  const html = response.payload as string;

  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, "text/html; charset=utf-8");
  assert.match(html, /Sentinel-8004 public submission entrypoint/);
  assert.match(html, /Open Live Judge Demo/);
  assert.match(html, /href="\/exposure-graph"[^>]*>Open Sentinel Exposure Graph<\/a>/);
  assert.match(html, /Open Operator Test Flow/);
  assert.match(html, /og:title/);
  assert.match(html, /Open Shared Sepolia Config JSON/);
  assert.match(html, /View Minimal ABI Fragments/);
  assert.match(html, /Open Public Proof Index/);
  assert.match(
    html,
    /<(?:div|dl) class="metric-strip"[\s\S]*?<div class="cta-row">/,
    "Expected the judge-demo metric strip to appear before the CTA row.",
  );
});

test("GET /operator returns the operator test shell HTML", async () => {
  const response = await handleJudgeModeRequest("GET", "/operator", "");

  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, "text/html; charset=utf-8");
  assert.match(response.payload as string, /Compose a trade intent and run the public-safe pipeline/);
  assert.match(response.payload as string, /Run Sentinel Pipeline/);
});

test("GET /judge returns the judge demo shell HTML", async () => {
  const response = await handleJudgeModeRequest("GET", "/judge", "");

  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, "text/html; charset=utf-8");
  assert.match(response.payload as string, /Sentinel-8004 public proof walkthrough/);
  assert.match(response.payload as string, /Kraken Execution Preview/);
  assert.match(response.payload as string, /Status Notes/);
  assert.match(response.payload as string, /Back to Hosted Submission Hub/);
  assert.match(response.payload as string, /twitter:card/);
});

test("GET /judge/ also returns the judge demo shell HTML", async () => {
  const response = await handleJudgeModeRequest("GET", "/judge/", "");

  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, "text/html; charset=utf-8");
  assert.match(response.payload as string, /Sentinel-8004 public proof walkthrough/);
});

test("GET /assets/cover/sentinel-8004-cover.png returns a public asset from the hosted demo domain", async () => {
  const response = await handleJudgeModeRequest(
    "GET",
    "/assets/cover/sentinel-8004-cover.png",
    "",
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, "image/png");
  assert.equal(Buffer.isBuffer(response.payload), true);
});

test("GET /web/status-notes.js returns the shared status-notes helper module", async () => {
  const response = await handleJudgeModeRequest("GET", "/web/status-notes.js", "");

  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, "text/javascript; charset=utf-8");
  assert.match(response.payload as string, /buildStatusNotes/);
});

test("GET /api/demo/scenarios returns the canonical scenario names", async () => {
  const response = await handleJudgeModeRequest("GET", "/api/demo/scenarios", "");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, {
    scenarios: [
      "allow-btc-buy",
      "deny-oversize-eth",
      "downsize-eth-buy",
      "fail-closed-oracle",
    ],
  });
});

test("GET /api/demo/shared-sepolia returns the organizer shared contract config", async () => {
  const response = await handleJudgeModeRequest("GET", "/api/demo/shared-sepolia", "");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, {
    contracts: getSharedSepoliaContracts(),
  });
});

test("GET /api/demo/shared-sepolia/agent-registry-anchor/:agent returns a founder-run anchor plan", async () => {
  const response = await handleJudgeModeRequest(
    "GET",
    "/api/demo/shared-sepolia/agent-registry-anchor/strategy-agent-demo",
    "",
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, buildAgentRegistryAnchorPlan("strategy-agent-demo"));
});

test("GET /api/demo/scenarios/:name returns the scenario bundle for the web shell", async () => {
  const intent = await loadScenarioIntent("allow-btc-buy");
  const signedIntentBundle = buildSignedTradeIntentBundle(intent);
  const evaluation = evaluateTradeIntent(intent);
  const executionPreview = buildKrakenExecutionPreview(intent, evaluation);
  const krakenCliPaperArtifact = buildKrakenCliPaperSmokeArtifact(executionPreview);
  const response = await handleJudgeModeRequest(
    "GET",
    "/api/demo/scenarios/allow-btc-buy",
    "",
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, {
    scenario_name: "allow-btc-buy",
    bundle_label: "allow-btc-buy",
    intent,
    signed_intent_bundle: signedIntentBundle,
    signed_intent_verification: verifySignedTradeIntentBundle(signedIntentBundle),
    evaluation,
    permit_verification: verifyTradePermit({
      intent,
      signed_verdict: evaluation.signed_verdict,
    }),
    execution_preview: executionPreview,
    kraken_cli_paper_artifact: krakenCliPaperArtifact,
  });
});

test("POST /api/demo/run-pipeline returns the operator bundle for a submitted intent", async () => {
  const intent = await loadScenarioIntent("downsize-eth-buy");
  const signedIntentBundle = buildSignedTradeIntentBundle(intent);
  const evaluation = evaluateTradeIntent(intent);
  const executionPreview = buildKrakenExecutionPreview(intent, evaluation);
  const krakenCliPaperArtifact = buildKrakenCliPaperSmokeArtifact(executionPreview);
  const response = await handleJudgeModeRequest(
    "POST",
    "/api/demo/run-pipeline",
    JSON.stringify(intent),
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, {
    bundle_label: "intent-downsize-eth-buy-001",
    intent,
    signed_intent_bundle: signedIntentBundle,
    signed_intent_verification: verifySignedTradeIntentBundle(signedIntentBundle),
    evaluation,
    permit_verification: verifyTradePermit({
      intent,
      signed_verdict: evaluation.signed_verdict,
    }),
    execution_preview: executionPreview,
    kraken_cli_paper_artifact: krakenCliPaperArtifact,
  });
});

test("POST /api/demo/run-pipeline returns 400 for invalid payloads", async () => {
  const response = await handleJudgeModeRequest(
    "POST",
    "/api/demo/run-pipeline",
    JSON.stringify({ trace_id: "broken" }),
  );

  assert.equal(response.statusCode, 400);
  assert.equal((response.payload as { error: string }).error, "invalid_trade_intent");
});

test("GET /api/demo/execution-previews/:name returns the canonical execution preview", async () => {
  const expectedPreview = await loadExpectedExecutionPreview("downsize-eth-buy");
  const response = await handleJudgeModeRequest(
    "GET",
    "/api/demo/execution-previews/downsize-eth-buy",
    "",
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, expectedPreview);
});

test("GET /api/demo/signed-intents/:name returns the canonical signed intent bundle", async () => {
  const expectedBundle = await loadSignedIntentBundle("allow-btc-buy");
  const response = await handleJudgeModeRequest(
    "GET",
    "/api/demo/signed-intents/allow-btc-buy",
    "",
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, expectedBundle);
});

test("POST /api/demo/evaluate-intent route logic returns the canonical evaluation response", async () => {
  const intent = await loadScenarioIntent("downsize-eth-buy");
  const expectedVerdict = await loadExpectedVerdict("downsize-eth-buy");

  const response = await handleJudgeModeRequest(
    "POST",
    "/api/demo/evaluate-intent",
    JSON.stringify(intent),
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, expectedVerdict);
});

test("POST /api/demo/evaluate-intent route logic returns 400 for invalid payloads", async () => {
  const response = await handleJudgeModeRequest(
    "POST",
    "/api/demo/evaluate-intent",
    JSON.stringify({ trace_id: "broken" }),
  );

  assert.equal(response.statusCode, 400);
  assert.equal((response.payload as { error: string }).error, "invalid_trade_intent");
});

test("POST /api/demo/verify-permit route logic returns an executable gate result", async () => {
  const intent = await loadScenarioIntent("downsize-eth-buy");
  const evaluation = evaluateTradeIntent(intent);

  const response = await handleJudgeModeRequest(
    "POST",
    "/api/demo/verify-permit",
    JSON.stringify({
      intent,
      signed_verdict: evaluation.signed_verdict,
      requested_notional_usd: "2500.00",
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal((response.payload as { executable: boolean }).executable, true);
  assert.equal(
    (response.payload as { verification_code: string }).verification_code,
    "EXECUTION_PERMITTED",
  );
});

test("POST /api/demo/verify-permit route logic returns 400 for invalid payloads", async () => {
  const response = await handleJudgeModeRequest(
    "POST",
    "/api/demo/verify-permit",
    JSON.stringify({
      intent: { trace_id: "broken" },
      signed_verdict: { trace_id: "broken" },
    }),
  );

  assert.equal(response.statusCode, 400);
  assert.equal(
    (response.payload as { error: string }).error,
    "invalid_permit_verification_request",
  );
});

test("POST /api/demo/verify-signed-intent returns a verified ERC-8004-style proof bundle", async () => {
  const bundle = await loadSignedIntentBundle("allow-btc-buy");
  const response = await handleJudgeModeRequest(
    "POST",
    "/api/demo/verify-signed-intent",
    JSON.stringify(bundle),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(
    (response.payload as { verification_code: string }).verification_code,
    "SIGNED_INTENT_VERIFIED",
  );
});

test("POST /api/demo/verify-signed-intent returns 400 for invalid payloads", async () => {
  const response = await handleJudgeModeRequest(
    "POST",
    "/api/demo/verify-signed-intent",
    JSON.stringify({
      bundle_id: "broken",
      signer_wallet: "not-a-wallet",
    }),
  );

  assert.equal(response.statusCode, 400);
  assert.equal(
    (response.payload as { error: string }).error,
    "invalid_signed_trade_intent_bundle",
  );
});

test("unknown routes return 404", async () => {
  const response = await handleJudgeModeRequest("GET", "/api/demo/unknown", "");

  assert.equal(response.statusCode, 404);
  assert.equal((response.payload as { error: string }).error, "not_found");
});
