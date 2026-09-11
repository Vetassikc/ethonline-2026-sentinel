import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { handleJudgeModeRequest } from "../app/server.ts";
import { buildPlanComparisonRows } from "../../web/exposure-graph.js";

const HTML_URL = new URL("../../web/exposure-graph.html", import.meta.url);
const JS_URL = new URL("../../web/exposure-graph.js", import.meta.url);
const CSS_URL = new URL("../../web/styles.css", import.meta.url);
const PROPOSALS_URL = new URL("../../docs/superpowers/mockups/sentinel-exposure-graph-visual-proposals.html", import.meta.url);

test("exposure graph screen exposes the complete judge-readable flow", async () => {
  const html = await readFile(HTML_URL, "utf8");

  assert.match(html, /<title>Sentinel Exposure Graph<\/title>/);
  assert.doesNotMatch(html, /Task 3 · read-only plan review/);
  assert.doesNotMatch(html, /Task 5 · dependency impact/);
  for (const id of [
    "exposure-active-source",
    "legacy-demo-section",
    "plan-causal-summary",
    "plan-comparison-rows",
    "plan-diagnostic-card",
    "plan-repair-projection",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
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
  assert.match(html, /CAPABILITY · LIVE SOURCE/);
  assert.match(html, /CAPABILITY · REPLAY/);
  assert.match(html, /aria-label="Available demo capabilities"/);
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
    "plan-run-what-if",
    "plan-what-if-original",
    "plan-what-if-simulated",
    "plan-what-if-path",
    "plan-what-if-plans",
    "plan-what-if-reservations-note",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Recorded permit-check evidence/);
  assert.match(html, /authorization boundary/);
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
    "/api/exposure/what-if",
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
  assert.match(script, /runPlanWhatIf/);
  assert.match(script, /renderPlanComparison/);
  assert.match(script, /exposure-active-source/);
  assert.match(script, /WHAT-IF \/ SIMULATION/);
  assert.match(script, /SIMULATION_NOT_EXECUTABLE/);
  assert.match(script, new RegExp("No permit-check evidence recorded; issuance/check history unknown"));
  assert.match(script, /POST/);
  assert.match(script, /hypothetical/);
  assert.doesNotMatch(script, /GRAPH_API_KEY|GRAPH_SUBGRAPH_ID|\bapiKey\b|\bAuthorization\s*:/i);
  assert.doesNotMatch(script, /https?:\/\//i);
  assert.match(styles, /\.exposure-shell/);
  assert.match(styles, /\.plan-comparison-table/);
  assert.match(styles, /\.legacy-demo-section/);
  assert.match(styles, /@media \(max-width: 820px\)/);
});

test("static CSS guard keeps the hidden what-if result out of layout", async () => {
  const styles = await readFile(CSS_URL, "utf8");
  const gridRuleIndex = styles.indexOf(".plan-what-if-result {");
  const hiddenRuleIndex = styles.indexOf(".plan-what-if-result[hidden]");

  assert.ok(gridRuleIndex >= 0, "the visible what-if result rule must remain present");
  assert.ok(hiddenRuleIndex > gridRuleIndex, "the hidden override must follow the grid rule");
  const hiddenRule = styles.slice(hiddenRuleIndex, styles.indexOf("}", hiddenRuleIndex) + 1);
  assert.match(hiddenRule, /display:\s*none\s*!important/);
});

test("recommended visual proposal keeps states and boundaries explicit across widths", async () => {
  const proposals = await readFile(PROPOSALS_URL, "utf8");

  assert.match(proposals, /class="proposal-card proposal-a-card" id="proposal-a"/);
  assert.match(proposals, /\.proposal-a-card\s*\{\s*grid-column:\s*1\s*\/\s*-1/);
  assert.match(proposals, /Projected after repair — not executed/);
  assert.match(proposals, /What-if baseline remains original FIXTURE/);
  assert.match(proposals, /Aave evidence → total-exposure predicate → plan → reservation → permit/);
  assert.match(proposals, /Execution authority:<\/strong> none/);
  assert.match(proposals, /@media \(max-width: 1160px\)/);
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

function comparisonPlan(steps) {
  return {
    schema_version: "exposure_plan.v1",
    agent_id: "agent_a",
    goal: { kind: "supply_up_to", target_units: "0.300000000000000000" },
    steps,
  };
}

function comparisonRepair(candidate, changes) {
  return {
    status: candidate ? "PARTIAL" : "NO_SUPPORTED_REPAIR",
    repair_algorithm: "left_to_right_max_feasible_v1",
    candidate: candidate ? comparisonPlan(candidate) : null,
    evaluation: null,
    changes,
  };
}

test("plan comparison marks a removed first step and keeps the surviving row", () => {
  const rows = buildPlanComparisonRows(comparisonPlan([
    { kind: "supply_aave", units: "0.100000000000000000" },
    { kind: "withdraw_aave_to_wallet", units: "0.200000000000000000" },
  ]), comparisonRepair([
    { kind: "withdraw_aave_to_wallet", units: "0.200000000000000000" },
  ], [
    { step_index: 0, requested_units: "0.100000000000000000", repaired_units: "0.000000000000000000" },
  ]));

  assert.deepEqual(rows.map(({ step_index, status, repaired_units }) => ({ step_index, status, repaired_units })), [
    { step_index: 0, status: "REMOVED", repaired_units: null },
    { step_index: 1, status: "REPAIRED", repaired_units: "0.200000000000000000" },
  ]);
});

test("plan comparison marks a removed middle step without shifting later rows", () => {
  const rows = buildPlanComparisonRows(comparisonPlan([
    { kind: "acquire_wsteth", units: "0.100000000000000000" },
    { kind: "supply_aave", units: "0.100000000000000000" },
    { kind: "withdraw_aave_to_wallet", units: "0.200000000000000000" },
  ]), comparisonRepair([
    { kind: "acquire_wsteth", units: "0.100000000000000000" },
    { kind: "withdraw_aave_to_wallet", units: "0.200000000000000000" },
  ], [
    { step_index: 1, requested_units: "0.100000000000000000", repaired_units: "0.000000000000000000" },
  ]));

  assert.deepEqual(rows.map(({ step_index, status, repaired_kind }) => ({ step_index, status, repaired_kind })), [
    { step_index: 0, status: "REPAIRED", repaired_kind: "acquire_wsteth" },
    { step_index: 1, status: "REMOVED", repaired_kind: null },
    { step_index: 2, status: "REPAIRED", repaired_kind: "withdraw_aave_to_wallet" },
  ]);
});

test("plan comparison uses step indexes when action kinds repeat", () => {
  const rows = buildPlanComparisonRows(comparisonPlan([
    { kind: "acquire_wsteth", units: "0.300000000000000000" },
    { kind: "acquire_wsteth", units: "0.200000000000000000" },
    { kind: "supply_aave", units: "0.100000000000000000" },
  ]), comparisonRepair([
    { kind: "acquire_wsteth", units: "0.200000000000000000" },
    { kind: "acquire_wsteth", units: "0.200000000000000000" },
    { kind: "supply_aave", units: "0.050000000000000000" },
  ], [
    { step_index: 0, requested_units: "0.300000000000000000", repaired_units: "0.200000000000000000" },
    { step_index: 2, requested_units: "0.100000000000000000", repaired_units: "0.050000000000000000" },
  ]));

  assert.deepEqual(rows.map(({ step_index, repaired_kind, repaired_units }) => ({ step_index, repaired_kind, repaired_units })), [
    { step_index: 0, repaired_kind: "acquire_wsteth", repaired_units: "0.200000000000000000" },
    { step_index: 1, repaired_kind: "acquire_wsteth", repaired_units: "0.200000000000000000" },
    { step_index: 2, repaired_kind: "supply_aave", repaired_units: "0.050000000000000000" },
  ]);
});

test("plan comparison preserves the canonical acquire and supply correspondence", () => {
  const rows = buildPlanComparisonRows(comparisonPlan([
    { kind: "acquire_wsteth", units: "0.300000000000000000" },
    { kind: "supply_aave", units: "0.300000000000000000" },
  ]), comparisonRepair([
    { kind: "acquire_wsteth", units: "0.200000000000000000" },
    { kind: "supply_aave", units: "0.100000000000000000" },
  ], [
    { step_index: 0, requested_units: "0.300000000000000000", repaired_units: "0.200000000000000000" },
    { step_index: 1, requested_units: "0.300000000000000000", repaired_units: "0.100000000000000000" },
  ]));

  assert.deepEqual(rows.map(({ step_index, repaired_units }) => ({ step_index, repaired_units })), [
    { step_index: 0, repaired_units: "0.200000000000000000" },
    { step_index: 1, repaired_units: "0.100000000000000000" },
  ]);
});

test("plan comparison reserves No candidate for a missing repair, not a removal", () => {
  const rows = buildPlanComparisonRows(comparisonPlan([
    { kind: "withdraw_aave_to_wallet", units: "0.100000000000000000" },
    { kind: "supply_aave", units: "0.100000000000000000" },
  ]), comparisonRepair(null, [
    { step_index: 0, requested_units: "0.100000000000000000", repaired_units: "0.000000000000000000" },
    { step_index: 1, requested_units: "0.100000000000000000", repaired_units: "0.000000000000000000" },
  ]));

  assert.deepEqual(rows.map(({ status, repaired_units }) => ({ status, repaired_units })), [
    { status: "NO_CANDIDATE", repaired_units: null },
    { status: "NO_CANDIDATE", repaired_units: null },
  ]);
});
