import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { handleJudgeModeRequest } from "../app/server.ts";

const HTML_URL = new URL("../../web/exposure-graph.html", import.meta.url);
const JS_URL = new URL("../../web/exposure-graph.js", import.meta.url);
const CSS_URL = new URL("../../web/styles.css", import.meta.url);

test("exposure graph screen exposes the complete judge-readable flow", async () => {
  const html = await readFile(HTML_URL, "utf8");

  assert.match(html, /<title>Sentinel Exposure Graph<\/title>/);
  for (const id of [
    "plan-intent-panel",
    "plan-graph-panel",
    "plan-decision-panel",
    "plan-repair-panel",
    "plan-budget-panel",
    "plan-timeline-panel",
    "plan-what-if-panel",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="exposure-request-panel"/);
  assert.match(html, /id="exposure-graph-panel"/);
  assert.match(html, /id="exposure-decision-panel"/);
  assert.match(html, /id="exposure-permit-panel"/);
  assert.match(html, /id="exposure-execution-panel"/);
  assert.match(html, /id="exposure-replay-panel"/);
  assert.match(html, /value="2\.000000000000000000"/);
  assert.match(html, /LIVE/);
  assert.match(html, /REPLAY/);
  assert.match(html, /Bind the result to a demo signer/);
  assert.match(html, /Paper execute after fresh checks/);
  assert.match(html, /Show a non-current exhausted-headroom replay/);
  assert.match(html, /Issue permit/);
  assert.match(html, /Paper execute/);
  for (const id of [
    "plan-edit-form",
    "plan-agent-select",
    "plan-goal-select",
    "plan-target-input",
    "plan-step-0-action",
    "plan-step-0-quantity",
    "plan-add-step",
    "plan-remove-step",
    "plan-evaluate",
    "plan-source-fixture",
    "plan-source-live",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /<svg[\s\S]*id="exposure-graph-svg"/);
  assert.match(html, /href="\/web\/styles\.css"/);
});

test("exposure graph browser code uses only server-owned bounded routes", async () => {
  const [script, styles] = await Promise.all([
    readFile(JS_URL, "utf8"),
    readFile(CSS_URL, "utf8"),
  ]);

  for (const route of [
    "/api/exposure/plan/config",
    "/api/exposure/plan/source/fixture",
    "/api/exposure/plan/validate",
    "/api/exposure/config",
    "/api/exposure/evaluate",
    "/api/exposure/permit",
    "/api/exposure/verify",
    "/api/exposure/paper-execute",
    "/api/exposure/replay",
  ]) {
    assert.match(script, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(script, /direct_holding/);
  assert.match(script, /aave_supply/);
  assert.match(script, /source_path/);
  assert.match(script, /transformation/);
  assert.match(script, /clearDecisionState/);
  assert.match(script, /clearPlanDecision/);
  assert.match(script, /planRequestSequence/);
  assert.match(script, /legacyControlState/);
  assert.match(script, /markPlanStale/);
  assert.match(script, /POST/);
  assert.match(script, /hypothetical/);
  assert.doesNotMatch(script, /GRAPH_API_KEY|GRAPH_SUBGRAPH_ID|\bapiKey\b|\bAuthorization\s*:/i);
  assert.doesNotMatch(script, /https?:\/\//i);
  assert.match(styles, /\.exposure-shell/);
  assert.match(styles, /@media \(max-width: 820px\)/);
});

test("exposure graph route serves the judge screen and its module", async () => {
  const page = await handleJudgeModeRequest("GET", "/exposure-graph", "");
  const script = await handleJudgeModeRequest("GET", "/web/exposure-graph.js", "");

  assert.equal(page.statusCode, 200);
  assert.equal(page.contentType, "text/html; charset=utf-8");
  assert.match(String(page.payload), /Sentinel Exposure Graph/);
  assert.match(String(page.payload), /source-attributed/);
  assert.equal(script.statusCode, 200);
  assert.equal(script.contentType, "text/javascript; charset=utf-8");
});
