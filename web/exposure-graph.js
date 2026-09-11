const REQUEST_SCHEMA_VERSION = "sentinel-exposure-buy.v1";
const DEFAULT_ACTION = "BUY_EXPOSURE";
const DEFAULT_ASSET = "wstETH";

const state = {
  config: null,
  planConfig: null,
  evaluation: null,
  evaluationRef: null,
  permit: null,
  verification: null,
  execution: null,
  replay: null,
  selectedPath: null,
  plan: null,
  planSource: null,
  whatIf: null,
  planStepCount: 2,
  planRequestSequence: 0,
};

export function createPlanRequestLifecycle() {
  let nextTokenId = 0;
  let generation = 0;
  const controlOwners = new Map();
  const currentGenerations = new Map();
  const isCurrent = (token) => Boolean(token)
    && token.generation === currentGenerations.get(token.kind)
    && token === controlOwners.get(token.kind);

  return {
    begin(kind) {
      const token = { id: ++nextTokenId, generation: ++generation, kind };
      controlOwners.set(kind, token);
      currentGenerations.set(kind, token.generation);
      return token;
    },
    invalidate(kind) {
      generation += 1;
      if (kind) {
        currentGenerations.set(kind, generation);
        controlOwners.delete(kind);
        return generation;
      }
      for (const knownKind of new Set([...currentGenerations.keys(), ...controlOwners.keys()])) {
        currentGenerations.set(knownKind, generation);
        controlOwners.delete(knownKind);
      }
      return generation;
    },
    isCurrent,
    finish(token) {
      if (!isCurrent(token)) return false;
      controlOwners.delete(token.kind);
      return true;
    },
  };
}

const planRequestLifecycle = createPlanRequestLifecycle();

const $ = (selector) => document.querySelector(selector);

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function setDisabled(selector, disabled) {
  const element = $(selector);
  if (element) element.disabled = disabled;
}

function setStatus(message, tone = "neutral") {
  const element = $("#exposure-status");
  if (!element) return;
  element.className = `exposure-status exposure-status-${tone}`;
  element.textContent = message;
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function humanize(value) {
  return String(value ?? "not resolved").replaceAll("_", " ");
}

function shortAddress(value) {
  if (typeof value !== "string" || value.length < 12) return "server-configured";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function shortHash(value) {
  if (typeof value !== "string" || value.length < 16) return "not resolved";
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function formatUnits(value) {
  return typeof value === "string" && value.length > 0 ? `${compactDecimal(value)} wstETH` : "—";
}

const EXACT_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;

function compactDecimal(value) {
  if (typeof value !== "string" || !EXACT_DECIMAL_PATTERN.test(value)) return "—";
  const [integer, fraction = ""] = value.split(".");
  const compactFraction = fraction.replace(/0+$/, "");
  return compactFraction.length > 0 ? `${integer}.${compactFraction}` : integer;
}

function exactDecimalToRaw(value) {
  if (typeof value !== "string" || !EXACT_DECIMAL_PATTERN.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  try {
    return BigInt(integer) * 1_000_000_000_000_000_000n
      + BigInt((fraction + "0".repeat(18)).slice(0, 18));
  } catch {
    return null;
  }
}

function formatRawUnits(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return "—";
  try {
    const raw = BigInt(value);
    const scale = 1_000_000_000_000_000_000n;
    const integer = raw / scale;
    const fraction = (raw % scale).toString().padStart(18, "0");
    return `${compactDecimal(`${integer}.${fraction}`)} wstETH`;
  } catch {
    return "—";
  }
}

function formatRawUnitsFull(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return "—";
  try {
    const raw = BigInt(value);
    const scale = 1_000_000_000_000_000_000n;
    const integer = raw / scale;
    const fraction = (raw % scale).toString().padStart(18, "0");
    return `${integer}.${fraction} wstETH`;
  } catch {
    return "—";
  }
}

function positiveUnits(value) {
  try {
    const raw = exactDecimalToRaw(value);
    return raw !== null && raw > 0n;
  } catch {
    return false;
  }
}

export function legacyControlState(result) {
  const issuePermitEnabled = result?.status === "ok"
    && typeof result?.evaluation_ref === "string"
    && result.evaluation_ref.length > 0
    && result?.policy?.verdict !== "DENY"
    && positiveUnits(result?.policy?.allowed_units);
  const replayEnabled = typeof result?.evaluation_ref === "string" && result.evaluation_ref.length > 0;
  return {
    issuePermitEnabled,
    replayEnabled,
    paperExecuteEnabled: false,
  };
}

function policyPillClass(verdict) {
  if (verdict === "ALLOW") return "status-pill status-pill-allow";
  if (verdict === "ALLOW_WITH_DOWNSIZE") return "status-pill status-pill-downsize";
  if (verdict === "DENY") return "status-pill status-pill-deny";
  return "status-pill status-pill-neutral";
}

function planPillClass(value) {
  if (["PASS", "FULL", "ELIGIBLE", "QUALIFIED"].includes(value)) return "status-pill status-pill-allow";
  if (["PARTIAL", "HYPOTHETICAL", "VIOLATION", "UNVERIFIED", "STOPPED_ON_VIOLATION"].includes(value)) return "status-pill status-pill-downsize";
  if (["BLOCKED", "INELIGIBLE", "UNSATISFIED", "NO_SUPPORTED_REPAIR", "INVALID"].includes(value)) return "status-pill status-pill-deny";
  return "status-pill status-pill-neutral";
}

function setPlanPill(selector, value) {
  const element = $(selector);
  if (!element) return;
  element.className = planPillClass(value);
  element.textContent = humanize(value ?? "PENDING").toUpperCase();
}

function planUnits(value) {
  return typeof value === "string" ? `${compactDecimal(value)} wstETH` : "—";
}

const PLAN_ACTION_LABELS = {
  acquire_wsteth: "Acquire wstETH",
  supply_aave: "Supply to Aave",
  withdraw_aave_to_wallet: "Withdraw Aave supply to wallet",
};

function planStepLabel(step) {
  return `${PLAN_ACTION_LABELS[step?.kind] ?? humanize(step?.kind)} · ${planUnits(step?.units)}`;
}

function appendList(selector, values, emptyText = "—") {
  const list = $(selector);
  if (!list) return;
  list.replaceChildren();
  if (!Array.isArray(values) || values.length === 0) {
    const item = document.createElement("li");
    item.textContent = emptyText;
    list.append(item);
    return;
  }
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  }
}

function uniqueViolationCodes(violations) {
  return [...new Set((violations ?? []).map((item) => item?.code).filter(Boolean))];
}

function renderPlanSteps(plan) {
  appendList("#plan-proposed-steps", (plan?.steps ?? []).map(planStepLabel), "No steps returned.");
  setText("#plan-agent", plan?.agent_id ?? "—");
  setText("#plan-goal", humanize(plan?.goal?.kind));
  setText("#plan-target", planUnits(plan?.goal?.target_units));
}

function provenancePillClass(provenance) {
  if (provenance === "LIVE_SOURCE") return "status-pill status-pill-allow";
  if (provenance === "FIXTURE") return "status-pill status-pill-neutral";
  if (provenance === "REPLAY") return "status-pill status-pill-downsize";
  return "status-pill status-pill-neutral";
}

function renderActiveProvenance(sourcePayload) {
  const source = sourcePayload?.source ?? sourcePayload;
  const mode = String(source?.mode ?? "unknown").toUpperCase();
  const provenance = String(source?.provenance ?? "UNKNOWN").toUpperCase();
  const active = $("#exposure-active-source");
  if (active) {
    active.className = provenancePillClass(provenance);
    active.textContent = mode === provenance || mode === "UNKNOWN"
      ? `ACTIVE PROVENANCE · ${provenance}`
      : `ACTIVE PROVENANCE · ${provenance} · ${mode}`;
  }
  const graphProvenance = $("#plan-graph-provenance");
  if (graphProvenance) {
    graphProvenance.className = provenancePillClass(provenance);
    graphProvenance.textContent = `ORIGINAL · ${provenance}`;
  }
}

function renderPlanSource(sourcePayload) {
  const source = sourcePayload?.source ?? sourcePayload;
  const mode = source?.mode ?? "unknown";
  const provenance = source?.provenance ?? "UNKNOWN";
  const qualification = source?.qualification ?? "BLOCKED";
  setText("#plan-source-reference", shortAddress(sourcePayload?.evaluation_ref));
  setText(
    "#plan-source-status",
    `${String(mode).toUpperCase()} · ${provenance} · ${qualification}`
      + (sourcePayload?.expires_at ? ` · expires ${sourcePayload.expires_at}` : ""),
  );
  renderActiveProvenance(source);
}

export function buildPlanComparisonRows(plan, repair) {
  const requested = Array.isArray(plan?.steps) ? plan.steps : [];
  const candidate = Array.isArray(repair?.candidate?.steps) ? repair.candidate.steps : null;
  const changesByStepIndex = new Map(
    (Array.isArray(repair?.changes) ? repair.changes : [])
      .filter((change) => Number.isInteger(change?.step_index))
      .map((change) => [change.step_index, change]),
  );
  let candidateIndex = 0;

  return requested.map((requestedStep, stepIndex) => {
    if (!candidate) {
      return {
        step_index: stepIndex,
        requested_kind: requestedStep?.kind,
        requested_units: requestedStep?.units ?? null,
        repaired_kind: null,
        repaired_units: null,
        status: "NO_CANDIDATE",
      };
    }

    const change = changesByStepIndex.get(stepIndex);
    const repairedUnits = change?.repaired_units ?? requestedStep?.units;
    const repairedRaw = exactDecimalToRaw(repairedUnits);
    if (repairedRaw === 0n) {
      return {
        step_index: stepIndex,
        requested_kind: requestedStep?.kind,
        requested_units: requestedStep?.units ?? null,
        repaired_kind: null,
        repaired_units: null,
        status: "REMOVED",
      };
    }

    const repairedStep = candidate[candidateIndex];
    candidateIndex += 1;
    if (!repairedStep) {
      return {
        step_index: stepIndex,
        requested_kind: requestedStep?.kind,
        requested_units: requestedStep?.units ?? null,
        repaired_kind: null,
        repaired_units: null,
        status: "NO_CANDIDATE",
      };
    }
    return {
      step_index: stepIndex,
      requested_kind: requestedStep?.kind,
      requested_units: requestedStep?.units ?? null,
      repaired_kind: repairedStep.kind,
      repaired_units: repairedStep.units,
      status: "REPAIRED",
    };
  });
}

function renderPlanComparison(plan, repair) {
  const body = $("#plan-comparison-rows");
  if (!body) return;
  body.replaceChildren();
  const rows = buildPlanComparisonRows(plan, repair);
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "No plan steps returned.";
    row.append(cell);
    body.append(row);
    return;
  }
  for (const comparison of rows) {
    const row = document.createElement("tr");
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = `${comparison.step_index + 1}. ${PLAN_ACTION_LABELS[comparison.requested_kind] ?? humanize(comparison.requested_kind)}`;
    const requestedCell = document.createElement("td");
    requestedCell.textContent = comparison.requested_units ? planUnits(comparison.requested_units) : "—";
    const repairedCell = document.createElement("td");
    repairedCell.textContent = comparison.status === "REMOVED"
      ? "Removed"
      : comparison.status === "NO_CANDIDATE"
        ? "No candidate"
        : planUnits(comparison.repaired_units);
    row.append(label, requestedCell, repairedCell);
    body.append(row);
  }
}

function setPlanSourceControlsDisabled(disabled) {
  for (const selector of [
    "#plan-case-repair",
    "#plan-case-restore",
    "#plan-case-total",
    "#plan-source-fixture",
    "#plan-source-live",
  ]) setDisabled(selector, disabled);
}

function beginPlanRequest(kind) {
  if (kind === "source") {
    planRequestLifecycle.invalidate("evaluate");
    planRequestLifecycle.invalidate("what-if");
    // A source switch deliberately invalidates any dependent evaluation. The
    // source request owns recovery of the now-unclaimed evaluation control;
    // a later evaluation can claim it again without a stale response being
    // able to unlock that newer request.
    setDisabled("#plan-evaluate", false);
    setDisabled("#plan-run-what-if", true);
  } else if (kind === "evaluate") {
    planRequestLifecycle.invalidate("what-if");
    setDisabled("#plan-run-what-if", true);
  }
  const token = planRequestLifecycle.begin(kind);
  state.planRequestSequence = token.generation;
  return token;
}

function markPlanStale(reason = "Inputs changed; evaluate the current plan.") {
  state.planRequestSequence = planRequestLifecycle.invalidate("evaluate");
  planRequestLifecycle.invalidate("what-if");
  clearPlanDecision();
  setDisabled("#plan-evaluate", false);
  setDisabled("#plan-run-what-if", true);
  setText("#plan-case-status", reason);
  setText("#plan-form-error", "");
  setPlanPill("#plan-policy-status", "PENDING");
  setPlanPill("#plan-repair-status", "PENDING");
}

function setPlanStepCount(count) {
  state.planStepCount = Math.max(1, Math.min(3, count));
  for (const row of document.querySelectorAll(".plan-step-row")) {
    const index = Number(row.dataset.stepIndex);
    row.hidden = index >= state.planStepCount;
  }
  setDisabled("#plan-add-step", state.planStepCount >= 3);
  setDisabled("#plan-remove-step", state.planStepCount <= 1);
}

function applyPlanTemplate(plan) {
  if (!plan) return;
  const goalKind = plan.goal?.kind;
  const target = plan.goal?.target_units;
  $("#plan-agent-select").value = plan.agent_id;
  $("#plan-goal-select").value = goalKind;
  $("#plan-target-input").value = target;
  setPlanStepCount(plan.steps.length);
  plan.steps.forEach((step, index) => {
    const action = $(`#plan-step-${index}-action`);
    const quantity = $(`#plan-step-${index}-quantity`);
    if (action) action.value = step.kind;
    if (quantity) quantity.value = step.units;
  });
}

function readPlanForm() {
  const errors = [];
  const agent = $("#plan-agent-select")?.value;
  const goalKind = $("#plan-goal-select")?.value;
  const target = $("#plan-target-input")?.value.trim() ?? "";
  if (!["agent_a", "agent_b"].includes(agent)) errors.push("agent_not_allowed");
  if (!["acquire_up_to", "supply_up_to", "reduce_aave_exposure", "reduce_total_exposure"].includes(goalKind)) {
    errors.push("goal_not_allowed");
  }
  if (exactDecimalToRaw(target) === null || exactDecimalToRaw(target) <= 0n) errors.push("target_exact_decimal_required");
  const steps = [];
  for (let index = 0; index < state.planStepCount; index += 1) {
    const kind = $(`#plan-step-${index}-action`)?.value;
    const units = $(`#plan-step-${index}-quantity`)?.value.trim() ?? "";
    if (!["acquire_wsteth", "supply_aave", "withdraw_aave_to_wallet"].includes(kind)) errors.push(`step_${index + 1}_action_not_allowed`);
    if (exactDecimalToRaw(units) === null || exactDecimalToRaw(units) <= 0n) errors.push(`step_${index + 1}_quantity_exact_decimal_required`);
    steps.push({ kind, units });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      schema_version: "exposure_plan.v1",
      agent_id: agent,
      goal: { kind: goalKind, target_units: target },
      steps,
    },
  };
}

function clearPlanDecision() {
  state.plan = null;
  setText("#plan-case-mode", state.planSource ? `${String(state.planSource.mode ?? "SOURCE").toUpperCase()} · STALE` : "SOURCE PENDING");
  setText("#plan-case-status", "Waiting for a server-owned read-only plan response…");
  renderPlanSteps(null);
  for (const selector of [
    "#plan-direct-quantity",
    "#plan-aave-quantity",
    "#plan-total-quantity",
    "#plan-policy-value",
    "#plan-goal-value",
    "#plan-paper-value",
    "#plan-real-tx-value",
    "#plan-decision-heading",
    "#plan-causal-summary",
    "#plan-diagnostic-status",
    "#plan-diagnostic-total",
    "#plan-diagnostic-aave",
    "#plan-diagnostic-violations",
    "#plan-diagnostic-total-visible",
    "#plan-diagnostic-aave-visible",
    "#plan-diagnostic-violations-visible",
    "#plan-replay-completeness",
    "#plan-replay-semantics",
    "#plan-unevaluated-steps",
    "#plan-replay-violations",
    "#plan-repair-direct",
    "#plan-repair-aave",
    "#plan-repair-total",
    "#plan-repair-policy",
    "#plan-repair-goal",
    "#plan-repair-projection-label",
    "#plan-total-cap",
    "#plan-aave-cap",
    "#plan-original-peak-total",
    "#plan-original-peak-aave",
    "#plan-repair-peak-total",
    "#plan-repair-peak-aave",
    "#plan-repair-raw",
    "#plan-source-mode",
    "#plan-source-qualification",
    "#plan-source-block",
    "#plan-source-hash",
    "#plan-source-gaps",
    "#plan-boundary-status",
  ]) setText(selector, "—");
  setText("#plan-decision-note", "The requested plan, policy result and execution boundary stay separate.");
  setText("#plan-repair-note", "The candidate is a projected review result, not an executed plan or reservation.");
  setPlanPill("#plan-diagnostic-status-pill", null);
  setPlanPill("#plan-repair-projection-label", null);
  const comparisonRows = $("#plan-comparison-rows");
  if (comparisonRows) {
    comparisonRows.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "Waiting for the service response.";
    row.append(cell);
    comparisonRows.append(row);
  }
  setText("#plan-budget-note", "Active reservation deltas are unavailable in this read-only review.");
  setText("#plan-what-if-note", "Run the allowlisted Aave evidence outage as a separate, non-authorizing analysis.");
  state.whatIf = null;
  setPlanPill("#plan-what-if-status", null);
  setText("#plan-what-if-error", "");
  setWhatIfResultVisible(false);
  for (const selector of [
    "#plan-what-if-original-label",
    "#plan-what-if-original-direct",
    "#plan-what-if-original-aave",
    "#plan-what-if-original-total",
    "#plan-what-if-original-cap",
    "#plan-what-if-original-predicate",
    "#plan-what-if-simulated-label",
    "#plan-what-if-simulated-direct",
    "#plan-what-if-simulated-aave",
    "#plan-what-if-simulated-total",
    "#plan-what-if-simulated-cap",
    "#plan-what-if-simulated-predicate",
    "#plan-what-if-explanation",
    "#plan-what-if-changed-predicate",
    "#plan-what-if-changed-original",
    "#plan-what-if-changed-simulated",
    "#plan-what-if-session",
    "#plan-what-if-evaluation-ref",
    "#plan-what-if-graph-hash",
    "#plan-what-if-reservations",
    "#plan-what-if-permits",
    "#plan-what-if-execution",
    "#plan-what-if-reservations-note",
  ]) setText(selector, "—");
  appendList("#plan-what-if-plans", [], "No impact has been evaluated.");
  appendList("#plan-what-if-path", [], "No causal path has been evaluated.");
  setDisabled("#plan-run-what-if", true);
  appendList("#plan-repair-steps", [], "Waiting for the service response.");
  appendList("#plan-timeline", ["Waiting for a server-owned source."]);
  setPlanPill("#plan-policy-status", null);
  setPlanPill("#plan-repair-status", null);
  renderPlanSource(state.planSource);
}

function renderPlan(result) {
  const evaluation = result?.evaluation;
  const diagnostic = evaluation?.diagnostic_projection;
  const repair = result?.repair;
  const repairEvaluation = repair?.evaluation;
  const initial = evaluation?.initial_state;
  const projected = diagnostic?.projected_final_state;
  const source = result?.source;
  const boundary = result?.boundary ?? {};
  state.plan = result;
  state.whatIf = null;
  setWhatIfResultVisible(false);
  setPlanPill("#plan-what-if-status", null);
  setText("#plan-what-if-error", "");
  setDisabled("#plan-run-what-if", false);
  if (source) {
    state.planSource = { ...(state.planSource ?? {}), ...source };
    renderPlanSource({ evaluation_ref: state.planSource.evaluation_ref, source });
  }

  setText("#plan-case-mode", String((source?.mode ?? "SOURCE") + " · " + (result?.case_name ?? "PLAN")).toUpperCase());
  setText("#plan-case-status", "Server response loaded. Values below are derived from the read-only service.");
  renderPlanSteps(result.plan);
  renderPlanComparison(result.plan, repair);

  setText("#plan-direct-quantity", formatRawUnits(initial?.direct_available_raw));
  setText("#plan-aave-quantity", formatRawUnits(initial?.aave_exposure_raw));
  setText("#plan-total-quantity", formatRawUnits(initial?.total_exposure_raw));

  setPlanPill("#plan-policy-status", evaluation?.policy_status);
  setText("#plan-policy-value", humanize(evaluation?.policy_status));
  setText("#plan-goal-value", humanize(evaluation?.goal_status));
  setText("#plan-paper-value", humanize(evaluation?.paper_eligibility));
  setText("#plan-real-tx-value", humanize(evaluation?.real_transaction_status));
  setText(
    "#plan-decision-heading",
    repair?.status === "PARTIAL" ? "Review the bounded partial repair" : "Review the requested plan",
  );
  setText(
    "#plan-decision-note",
    diagnostic?.status === "COMPLETE"
      ? "The complete projection is hypothetical and cannot authorize the original plan. Authorization replay stops at the first blocking predicate."
      : "The diagnostic projection is incomplete; unevaluated steps remain outside the displayed final state.",
  );
  const diagnosticTotal = formatRawUnits(projected?.total_exposure_raw);
  const diagnosticAave = formatRawUnits(projected?.aave_exposure_raw);
  const diagnosticViolations = uniqueViolationCodes(diagnostic?.violations).map(humanize).join(", ") || "none reported";
  setPlanPill("#plan-diagnostic-status-pill", diagnostic?.status);
  setText("#plan-diagnostic-total-visible", diagnosticTotal);
  setText("#plan-diagnostic-aave-visible", diagnosticAave);
  setText("#plan-diagnostic-violations-visible", diagnosticViolations);
  setText(
    "#plan-causal-summary",
    projected?.total_exposure_raw && projected?.aave_exposure_raw
      ? `The shared wstETH dependency makes the requested projection reach ${diagnosticTotal} total and ${diagnosticAave} Aave; the repair is review-only.`
      : "The shared dependency could not be projected completely; no repair is authorization.",
  );
  setText("#plan-diagnostic-status", humanize(diagnostic?.status));
  setText("#plan-diagnostic-total", formatRawUnitsFull(projected?.total_exposure_raw));
  setText("#plan-diagnostic-aave", formatRawUnitsFull(projected?.aave_exposure_raw));
  setText("#plan-diagnostic-violations", uniqueViolationCodes(diagnostic?.violations).map(humanize).join(", ") || "none reported");
  setText("#plan-replay-completeness", humanize(evaluation?.replay_completeness));
  setText("#plan-replay-semantics", humanize(evaluation?.final_state_semantics));
  setText("#plan-unevaluated-steps", evaluation?.unevaluated_step_indices?.length ? evaluation.unevaluated_step_indices.join(", ") : "none");
  setText("#plan-replay-violations", uniqueViolationCodes(evaluation?.violations).map(humanize).join(", ") || "none reported");

  setPlanPill("#plan-repair-status", repair?.status);
  setPlanPill("#plan-repair-projection-label", repair?.status);
  setText(
    "#plan-repair-note",
    repair?.status === "NO_SUPPORTED_REPAIR"
      ? "No supported bounded repair was returned for this goal. The original plan remains non-authorizing."
      : repair?.status === "PARTIAL"
        ? "Repair algorithm: " + humanize(repair?.repair_algorithm) + ". Partial result requires explicit acceptance later; no reservation exists."
        : "Repair algorithm: " + humanize(repair?.repair_algorithm) + ". Review only; no reservation exists.",
  );
  appendList("#plan-repair-steps", (repair?.candidate?.steps ?? []).map(planStepLabel), "No repair candidate returned.");
  setText("#plan-repair-direct", formatRawUnits(repairEvaluation?.final_state?.direct_available_raw));
  setText("#plan-repair-aave", formatRawUnits(repairEvaluation?.final_state?.aave_exposure_raw));
  setText("#plan-repair-total", formatRawUnits(repairEvaluation?.final_state?.total_exposure_raw));
  setText("#plan-repair-policy", humanize(repairEvaluation?.policy_status));
  setText("#plan-repair-goal", humanize(repairEvaluation?.goal_status) + " · " + planUnits(repairEvaluation?.fulfilled_units) + " / " + planUnits(repairEvaluation?.target_units));

  setText("#plan-total-cap", formatRawUnits(initial?.dependency_cap_raw));
  setText("#plan-aave-cap", formatRawUnits(initial?.aave_cap_raw));
  setText("#plan-original-peak-total", formatRawUnits(evaluation?.resource_requirements?.peak_total_increase_raw));
  setText("#plan-original-peak-aave", formatRawUnits(evaluation?.resource_requirements?.peak_aave_increase_raw));
  setText("#plan-repair-peak-total", formatRawUnits(repairEvaluation?.resource_requirements?.peak_total_increase_raw));
  setText("#plan-repair-peak-aave", formatRawUnits(repairEvaluation?.resource_requirements?.peak_aave_increase_raw));
  setText("#plan-repair-raw", [
    `direct_raw=${repairEvaluation?.final_state?.direct_available_raw ?? "—"}`,
    `aave_raw=${repairEvaluation?.final_state?.aave_exposure_raw ?? "—"}`,
    `total_raw=${repairEvaluation?.final_state?.total_exposure_raw ?? "—"}`,
  ].join(" · "));
  setText("#plan-budget-note", "Original replay peaks are labeled separately from the repaired candidate. No reservation admission was evaluated in this read-only review.");

  setText("#plan-source-mode", String(source?.mode ?? "—") + " · " + String(source?.provenance ?? "—"));
  setText("#plan-source-qualification", String(source?.qualification ?? "—") + " · " + String(source?.providers?.graph ?? "—") + " + " + String(source?.providers?.rpc ?? "—"));
  setText("#plan-source-block", source?.indexed_block ? String(source.indexed_block) + " · " + String(source.indexed_at ?? "timestamp unavailable") : "—");
  setText("#plan-source-hash", shortHash(source?.graph_hash));
  setText("#plan-source-gaps", source?.gaps?.length ? source.gaps.map(humanize).join(", ") : "none reported");
  setText("#plan-boundary-status", [boundary.reservations, boundary.signing, boundary.execution, boundary.runtime_what_if].map(humanize).join(" · "));
  appendList("#plan-timeline", [
    "Source: " + String(source?.mode ?? "unknown") + " · " + String(source?.qualification ?? "unknown"),
    "Original replay: " + humanize(evaluation?.replay_completeness) + " · " + humanize(evaluation?.final_state_semantics),
    "Diagnostic projection: " + humanize(diagnostic?.status) + " · hypothetical only",
    "Repair: " + humanize(repair?.status) + " · operator review only",
    "Plan gate: not issued · reservation, signing and execution unavailable",
  ]);
}

function setWhatIfResultVisible(visible) {
  const result = $("#plan-what-if-result");
  if (result) result.hidden = !visible;
}

function impactUnits(value) {
  return typeof value === "string" && value.length > 0
    ? `${compactDecimal(value)} wstETH`
    : "unavailable";
}

function impactPredicateLabel(value) {
  if (!value) return "—";
  return `${humanize(value.status)} · ${humanize(value.reason)}`;
}

function renderWhatIf(result) {
  state.whatIf = result;
  const original = result?.original ?? {};
  const simulated = result?.simulated ?? {};
  const originalSnapshot = original.snapshot ?? {};
  const simulatedSnapshot = simulated.snapshot ?? {};
  const changed = result?.changed_predicates?.[0];
  const session = result?.simulation_session ?? {};
  setWhatIfResultVisible(true);
  setPlanPill("#plan-what-if-status", "HYPOTHETICAL");
  setText("#plan-what-if-note", "This is a separate immutable analysis session. It does not invalidate or alter the original reservation, overlay, session or nonce.");
  setText("#plan-what-if-original-label", originalSnapshot.display_label ?? "—");
  setText("#plan-what-if-original-direct", impactUnits(originalSnapshot.direct_available_units));
  setText("#plan-what-if-original-aave", impactUnits(originalSnapshot.aave_exposure_units));
  setText("#plan-what-if-original-total", impactUnits(originalSnapshot.total_exposure_units));
  setText("#plan-what-if-original-cap", impactUnits(originalSnapshot.dependency_cap_units));
  setText("#plan-what-if-original-predicate", impactPredicateLabel(original.predicates?.total_exposure_cap));
  setText("#plan-what-if-simulated-label", simulatedSnapshot.display_label ?? "WHAT-IF / SIMULATION");
  setText("#plan-what-if-simulated-direct", impactUnits(simulatedSnapshot.direct_available_units));
  setText("#plan-what-if-simulated-aave", impactUnits(simulatedSnapshot.aave_exposure_units));
  setText("#plan-what-if-simulated-total", impactUnits(simulatedSnapshot.total_exposure_units));
  setText("#plan-what-if-simulated-cap", impactUnits(simulatedSnapshot.dependency_cap_units));
  setText("#plan-what-if-simulated-predicate", impactPredicateLabel(simulated.predicates?.total_exposure_cap));
  setText("#plan-what-if-explanation", result?.explanation ?? "—");
  setText("#plan-what-if-changed-predicate", changed?.predicate ?? "—");
  setText("#plan-what-if-changed-original", impactPredicateLabel(changed?.original));
  setText("#plan-what-if-changed-simulated", impactPredicateLabel(changed?.simulated));
  appendList(
    "#plan-what-if-plans",
    (result?.affected_plans ?? []).map((plan) => {
      const scope = plan.dependency_scope === "direct_only_shared_total"
        ? "direct-only plan relies on shared total cap"
        : "Aave + direct plan relies on shared total cap";
      return `${plan.agent_id} · ${scope} · ${humanize(plan.simulated?.reservation_status)}; actual state unchanged`;
    }),
    "No stored plan review or accepted plan is affected.",
  );
  appendList(
    "#plan-what-if-path",
    (result?.causal_path ?? []).map((edge) => `${edge.from} → ${edge.to} · ${humanize(edge.relation)} · ${edge.explanation}`),
    "No causal path returned.",
  );
  const affectedReservations = result?.affected_reservations ?? [];
  setText(
    "#plan-what-if-reservations-note",
    affectedReservations.length > 0
      ? `${affectedReservations.length} reservation copy marked for re-evaluation; actual reservation state is unchanged.`
      : "No actual reservation has been invalidated; any affected reservation is hypothetical review output.",
  );
  setText("#plan-what-if-session", session.session_id ?? "—");
  setText("#plan-what-if-evaluation-ref", session.base_evaluation_ref ?? "—");
  setText("#plan-what-if-graph-hash", shortHash(session.base_graph_hash));
  setText("#plan-what-if-reservations", session.reservations_copy?.length ? session.reservations_copy.join(", ") : "none recorded");
  setText(
    "#plan-what-if-permits",
    session.simulated_permits_copy?.length
      ? session.simulated_permits_copy.join(", ")
      : "No permit-check evidence recorded; issuance/check history unknown",
  );
  setText("#plan-what-if-execution", `${result?.execution_boundary?.code ?? "SIMULATION_NOT_EXECUTABLE"} · ${result?.execution_boundary?.explanation ?? "not executable"}`);
}

async function runPlanWhatIf() {
  const token = beginPlanRequest("what-if");
  if (!state.planSource?.evaluation_ref || !state.plan) {
    if (planRequestLifecycle.isCurrent(token)) {
      setText("#plan-what-if-error", "Evaluate the current plan before running the what-if.");
      setPlanPill("#plan-what-if-status", "BLOCKED");
    }
    if (planRequestLifecycle.finish(token)) setDisabled("#plan-run-what-if", true);
    return;
  }
  setDisabled("#plan-run-what-if", true);
  setPlanPill("#plan-what-if-status", "UNVERIFIED");
  setText("#plan-what-if-error", "POST /api/exposure/what-if in flight; original plan result remains separate.");
  try {
    const result = await postJson("/api/exposure/what-if", {
      evaluation_ref: state.planSource.evaluation_ref,
      scenario: "aave_evidence_unavailable",
    });
    if (!planRequestLifecycle.isCurrent(token)) return;
    if (result?.status !== "ok" || result?.mode !== "what_if") {
      const error = new Error("Dependency impact is unavailable.");
      error.payload = result;
      throw error;
    }
    renderWhatIf(result);
    setText("#plan-what-if-error", "");
    setStatus("Aave evidence what-if evaluated in a separate non-authorizing session.", "success");
  } catch (error) {
    if (!planRequestLifecycle.isCurrent(token)) return;
    state.whatIf = null;
    setWhatIfResultVisible(false);
    setPlanPill("#plan-what-if-status", "BLOCKED");
    setText("#plan-what-if-error", `What-if blocked: ${errorMessage(error)}`);
    setStatus(`What-if blocked: ${errorMessage(error)}`, "error");
  } finally {
    if (planRequestLifecycle.finish(token)) {
      setDisabled("#plan-run-what-if", !state.plan || !state.planSource?.evaluation_ref);
    }
  }
}

async function evaluateEditedPlan(options = {}) {
  const token = beginPlanRequest("evaluate");
  if (!options.keepResult) clearPlanDecision();
  setText("#plan-form-error", "");
  const form = readPlanForm();
  if (!form.ok) {
    if (planRequestLifecycle.isCurrent(token)) {
      setText("#plan-form-error", `Invalid plan input: ${form.errors.join(", ")}.`);
      setText("#plan-case-status", "Current plan is stale until valid exact inputs are evaluated.");
    }
    if (planRequestLifecycle.finish(token)) setDisabled("#plan-evaluate", false);
    return;
  }
  if (!state.planSource?.evaluation_ref) {
    if (planRequestLifecycle.isCurrent(token)) {
      setText("#plan-form-error", "Choose a server-resolved fixture reference or qualified live evidence first.");
      setText("#plan-case-status", "No source reference is available; no fixture fallback was used.");
    }
    if (planRequestLifecycle.finish(token)) setDisabled("#plan-evaluate", false);
    return;
  }
  setDisabled("#plan-evaluate", true);
  setText("#plan-case-status", "POST /api/exposure/plan/validate in flight; previous decision cleared.");
  try {
    const result = await postJson("/api/exposure/plan/validate", {
      evaluation_ref: state.planSource.evaluation_ref,
      plan: form.plan,
    });
    if (!planRequestLifecycle.isCurrent(token)) return;
    if (result?.status !== "ok") {
      const error = new Error("Plan validation is unavailable.");
      error.payload = result;
      throw error;
    }
    renderPlan(result);
    setStatus("Edited plan evaluated through the read-only service.", "success");
  } catch (error) {
    if (!planRequestLifecycle.isCurrent(token)) return;
    clearPlanDecision();
    setText("#plan-case-status", "Plan review blocked: " + errorMessage(error));
    setText("#plan-form-error", `No current result: ${errorMessage(error)}`);
    setStatus("Plan review blocked: " + errorMessage(error), "error");
  } finally {
    if (planRequestLifecycle.finish(token)) setDisabled("#plan-evaluate", false);
  }
}

async function loadFixtureSource(caseName = "repair_over_limit", templateCase = caseName) {
  const token = beginPlanRequest("source");
  state.planSource = null;
  clearPlanDecision();
  setPlanSourceControlsDisabled(true);
  setStatus("Requesting a server-issued fixture reference…", "loading");
  setText("#plan-source-status", "Fixture reference request in flight; no live fallback is used.");
  const sourcePath = caseName === "repair_over_limit"
    ? "/api/exposure/plan/source/fixture"
    : "/api/exposure/plan/source/fixture/" + caseName;
  try {
    const sourcePayload = await getJson(sourcePath);
    if (!planRequestLifecycle.isCurrent(token)) return;
    if (sourcePayload?.status !== "ok") {
      const error = new Error("Fixture source is unavailable.");
      error.payload = sourcePayload;
      throw error;
    }
    state.planSource = {
      evaluation_ref: sourcePayload.evaluation_ref,
      ...(sourcePayload.source ?? {}),
    };
    renderPlanSource(sourcePayload);
    applyPlanTemplate(sourcePayload.template);
    if (planRequestLifecycle.finish(token)) setPlanSourceControlsDisabled(false);
    await evaluateEditedPlan({ keepResult: true, templateCase });
  } catch (error) {
    if (!planRequestLifecycle.isCurrent(token)) return;
    clearPlanDecision();
    setText("#plan-source-status", "Fixture source blocked: " + errorMessage(error));
    setText("#plan-case-status", "No fixture was substituted after source failure.");
    setStatus("Plan source blocked: " + errorMessage(error), "error");
  } finally {
    if (planRequestLifecycle.finish(token)) {
      setPlanSourceControlsDisabled(false);
      setPlanStepCount(state.planStepCount);
    }
  }
}

async function loadLiveSource() {
  const token = beginPlanRequest("source");
  state.planSource = null;
  clearPlanDecision();
  setPlanSourceControlsDisabled(true);
  setStatus("Requesting qualified live evidence through the server…", "loading");
  setText("#plan-source-status", "Live source request in flight; a failed source will remain an error.");
  try {
    const result = await postJson("/api/exposure/evaluate", {
      schema_version: REQUEST_SCHEMA_VERSION,
      action: DEFAULT_ACTION,
      asset: DEFAULT_ASSET,
      unit: DEFAULT_ASSET,
      requested_units: "0.500000000000000000",
    });
    if (!planRequestLifecycle.isCurrent(token)) return;
    if (result?.status !== "ok" || result?.mode !== "live" || !result?.evaluation_ref) {
      const error = new Error("Qualified live evidence was not returned.");
      error.payload = result;
      throw error;
    }
    state.planSource = {
      evaluation_ref: result.evaluation_ref,
      mode: "live",
      provenance: "LIVE_SOURCE",
      qualification: "QUALIFIED",
    };
    renderPlanSource({ evaluation_ref: result.evaluation_ref, source: state.planSource });
    setText("#plan-source-status", "LIVE · LIVE_SOURCE · QUALIFIED. Review the plan inputs, then evaluate explicitly.");
    setText("#plan-case-status", "Qualified live reference loaded. No fixture substitution occurred.");
    setStatus("Qualified live evidence loaded for read-only plan review.", "success");
  } catch (error) {
    if (!planRequestLifecycle.isCurrent(token)) return;
    clearPlanDecision();
    setText("#plan-source-status", "Live source blocked: " + errorMessage(error));
    setText("#plan-case-status", "No fixture was substituted after live-source failure.");
    setStatus("Live source blocked: " + errorMessage(error), "error");
  } finally {
    if (planRequestLifecycle.finish(token)) setPlanSourceControlsDisabled(false);
  }
}

async function loadPlanCase(caseName) {
  await loadFixtureSource(caseName, caseName);
}

function clearPathDetail() {
  state.selectedPath = null;
  setText("#exposure-path-title", "No source path selected");
  setText("#exposure-path-summary", "Evaluate the bounded request, then select a highlighted path.");
  for (const selector of [
    "#exposure-path-quantity",
    "#exposure-path-source",
    "#exposure-path-contract",
    "#exposure-path-transformation",
    "#exposure-path-block",
    "#exposure-path-gaps",
  ]) {
    setText(selector, "not resolved");
  }
}

function clearGraph() {
  for (const selector of ["#graph-path-direct", "#graph-path-aave"]) {
    const group = $(selector);
    if (!group) continue;
    group.classList.remove("is-available", "is-selected");
    group.setAttribute("aria-disabled", "true");
  }
  setText("#exposure-graph-mode", "LIVE SOURCE PENDING");
  setText("#exposure-source-state", "not loaded");
  setText("#exposure-source-block", "not resolved");
  setText("#exposure-source-gaps", "not resolved");
  clearPathDetail();
}

function clearDecisionState() {
  state.evaluation = null;
  state.evaluationRef = null;
  state.permit = null;
  state.verification = null;
  state.execution = null;
  state.replay = null;
  clearGraph();
  setText("#exposure-verdict", "PENDING");
  $("#exposure-verdict")?.setAttribute("class", policyPillClass(null));
  setText("#exposure-decision-note", "No live evaluation has been returned.");
  for (const selector of [
    "#exposure-metric-requested",
    "#exposure-metric-gross",
    "#exposure-metric-cap",
    "#exposure-metric-headroom",
    "#exposure-metric-allowed",
    "#exposure-metric-binding",
  ]) {
    setText(selector, "—");
  }
  setText("#exposure-reason-codes", "not resolved");
  setText("#exposure-authorized-units", "not resolved");
  setText("#exposure-execution-request", "not authorized");
  setText("#exposure-verification-checks", "");
  setText("#exposure-permit-output", "No permit issued.");
  setText("#exposure-execution-output", "Waiting for a verified permit.");
  setText("#exposure-replay-output", "Replay is available after a live evaluation reference exists.");
  setText("#exposure-replay-verdict", "No replay requested.");
  setDisabled("#exposure-issue-permit", true);
  setDisabled("#exposure-verify-permit", true);
  setDisabled("#exposure-paper-execute", true);
  setDisabled("#exposure-run-replay", true);
}

function renderConfig(config) {
  const policy = config?.policy ?? {};
  const source = config?.source ?? {};
  setText("#exposure-cap", formatUnits(policy.dependency_cap_units));
  setText(
    "#exposure-config-source",
    source.account_configured
      ? "Server-selected Base account; no browser account input."
      : "Server account configuration is not available.",
  );
  setText(
    "#exposure-config-state",
    source.account_configured ? "Server configuration loaded." : "Configuration is blocked.",
  );
  setText(
    "#exposure-source-state",
    source.account_configured ? "Graph + Base RPC plan configured" : "server configuration blocked",
  );
}

function renderPathDetails(kind) {
  const graph = state.evaluation?.graph;
  const path = graph?.paths?.find((candidate) => candidate.kind === kind);
  if (!graph || !path) return;
  state.selectedPath = kind;
  for (const selector of ["#graph-path-direct", "#graph-path-aave"]) {
    $(selector)?.classList.toggle("is-selected", $(selector)?.dataset.pathKind === kind);
  }
  const edges = (path.edge_ids ?? [])
    .map((edgeId) => graph.edges.find((edge) => edge.id === edgeId))
    .filter(Boolean);
  const provenances = edges.map((edge) => edge.provenance).filter(Boolean);
  const first = provenances[0];
  setText("#exposure-path-title", kind === "direct_holding" ? "Direct wstETH holding" : "Aave V3 wstETH supply");
  setText(
    "#exposure-path-summary",
    kind === "direct_holding"
      ? "The configured account holds the underlying wstETH directly."
      : "The configured account holds an Aave supply claim that resolves back to the same wstETH asset.",
  );
  setText("#exposure-path-quantity", formatUnits(path.decimal_quantity));
  setText(
    "#exposure-path-source",
    provenances.map((provenance) => provenance.source_path).filter(Boolean).join(" → ") || "not resolved",
  );
  setText(
    "#exposure-path-contract",
    provenances
      .map((provenance) => `${shortAddress(provenance.contract)}${provenance.method ? ` · ${provenance.method}` : ""}`)
      .join(" → ") || "not resolved",
  );
  setText(
    "#exposure-path-transformation",
    [...new Set(provenances.map((provenance) => provenance.transformation).filter(Boolean))].join(" → ") || "not resolved",
  );
  setText(
    "#exposure-path-block",
    first ? `${first.block_number} · ${shortHash(first.block_hash)} · chain ${first.chain_id}` : "not resolved",
  );
  setText(
    "#exposure-path-gaps",
    graph.gaps?.length ? graph.gaps.map(humanize).join(", ") : "none reported",
  );
}

function renderGraph(graph) {
  if (!graph) {
    clearGraph();
    return;
  }
  const mode = graph.mode === "replay" ? "REPLAY" : graph.mode === "fixture" ? "FIXTURE" : "LIVE";
  if (!state.planSource) {
    renderActiveProvenance({
      mode: graph.mode ?? "live",
      provenance: mode === "FIXTURE" ? "FIXTURE" : mode === "REPLAY" ? "REPLAY" : "LIVE_SOURCE",
    });
  }
  setText("#exposure-graph-mode", `${mode} SOURCE VALIDATED`);
  setText("#exposure-source-state", `${mode} Graph + Base RPC same-block check`);
  setText(
    "#exposure-source-block",
    graph.source?.block ? `${graph.source.block.number} · ${shortHash(graph.source.block.hash)}` : "not resolved",
  );
  setText(
    "#exposure-source-gaps",
    graph.gaps?.length ? graph.gaps.map(humanize).join(", ") : "none reported",
  );
  setText("#graph-account-label", "configured account");

  for (const kind of ["direct_holding", "aave_supply"]) {
    const group = $(`#graph-path-${kind === "direct_holding" ? "direct" : "aave"}`);
    const available = graph.paths?.some((path) => path.kind === kind) === true;
    group?.classList.toggle("is-available", available);
    group?.classList.remove("is-selected");
    group?.setAttribute("aria-disabled", available ? "false" : "true");
  }
  clearPathDetail();
}

function renderDecision(result) {
  const policy = result?.policy;
  if (!policy) return;
  const verdict = policy.verdict ?? "DENY";
  const verdictElement = $("#exposure-verdict");
  if (verdictElement) {
    verdictElement.className = policyPillClass(verdict);
    verdictElement.textContent = verdict.replaceAll("_", " ");
  }
  setText("#exposure-metric-requested", formatUnits(policy.requested_units));
  setText("#exposure-metric-gross", formatUnits(policy.gross_exposure_units));
  setText("#exposure-metric-cap", formatUnits(policy.dependency_cap_units));
  setText("#exposure-metric-headroom", formatUnits(policy.headroom_units));
  setText("#exposure-metric-allowed", formatUnits(policy.allowed_units));
  setText("#exposure-metric-binding", humanize(policy.binding_constraint));
  setText("#exposure-reason-codes", policy.reason_codes?.map(humanize).join(", ") || "none reported");
  setText("#exposure-authorized-units", verdict === "DENY" ? "none" : formatUnits(policy.allowed_units));
  setText(
    "#exposure-decision-note",
    verdict === "ALLOW_WITH_DOWNSIZE"
      ? `The request exceeds current headroom; paper execution is bounded to ${formatUnits(policy.allowed_units)}.`
      : verdict === "ALLOW"
        ? "The requested amount fits the configured dependency cap."
        : "The current evidence or policy conditions do not authorize a paper purchase.",
  );
}

function renderEvaluation(result) {
  state.evaluation = result;
  state.evaluationRef = result?.evaluation_ref ?? null;
  state.permit = null;
  state.verification = null;
  state.execution = null;
  state.replay = null;
  renderGraph(result?.graph ?? null);
  renderDecision(result);
  const legacy = legacyControlState(result);
  setDisabled("#exposure-issue-permit", !legacy.issuePermitEnabled);
  setDisabled("#exposure-run-replay", !legacy.replayEnabled);
  setDisabled("#exposure-verify-permit", true);
  setDisabled("#exposure-paper-execute", true);
  setText(
    "#exposure-config-state",
    result?.status === "ok" ? `Evaluation stored as ${shortAddress(state.evaluationRef)}.` : "Evaluation is non-authorizing.",
  );
}

function renderPermit(permit) {
  const payload = permit?.payload ?? {};
  setText(
    "#exposure-permit-output",
    prettyJson({
      status: "issued",
      demo_only: permit?.demo_only === true,
      signer: shortAddress(permit?.signer),
      permit_hash: shortHash(permit?.permit_hash),
      payload: {
        authorized_units: payload.authorized_units,
        dependency_cap_units: payload.dependency_cap_units,
        policy_version: payload.policy_version,
        graph_hash: shortHash(payload.graph_hash),
        snapshot_block: payload.snapshot_block,
        nonce: payload.nonce,
        expires_at: payload.expires_at,
        account: "server-configured",
      },
    }),
  );
  setText("#exposure-execution-request", formatUnits(payload.authorized_units));
  setDisabled("#exposure-verify-permit", false);
}

function renderVerification(verification) {
  const container = $("#exposure-verification-checks");
  if (container) {
    container.replaceChildren();
    const list = document.createElement("ul");
    list.className = "exposure-check-list-items";
    for (const check of verification?.checks ?? []) {
      const item = document.createElement("li");
      item.className = check.ok ? "check-ok" : "check-failed";
      item.textContent = `${humanize(check.name)}: ${check.ok ? "pass" : "blocked"}`;
      list.append(item);
    }
    container.append(list);
  }
  setText(
    "#exposure-permit-output",
    prettyJson({
      verification: verification?.executable ? "executable" : "blocked",
      code: verification?.code ?? "not resolved",
      permit_hash: shortHash(verification?.permit_hash),
      graph_hash: shortHash(verification?.graph_hash),
    }),
  );
  setDisabled("#exposure-paper-execute", verification?.executable !== true);
}

function renderReplay(replay) {
  state.replay = replay;
  renderGraph(replay?.graph ?? null);
  setText("#exposure-replay-verdict", `${replay?.mode?.toUpperCase() ?? "REPLAY"}: ${replay?.policy?.verdict ?? "DENY"}`);
  setText(
    "#exposure-replay-output",
    prettyJson({
      mode: replay?.mode,
      verdict: replay?.policy?.verdict,
      reason_codes: replay?.policy?.reason_codes,
      block: replay?.graph?.source?.block?.number,
      graph_hash: shortHash(replay?.graph?.graph_hash),
    }),
  );
}

function errorMessage(error) {
  const payload = error?.payload;
  if (payload?.details?.length) return payload.details.join(" ");
  if (payload?.error) return humanize(payload.error);
  return error instanceof Error ? error.message : "The server request could not complete.";
}

async function getJson(path) {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}.`);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const responsePayload = await response.json();
  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}.`);
    error.payload = responsePayload;
    error.status = response.status;
    throw error;
  }
  return responsePayload;
}

function requestFromForm() {
  return {
    schema_version: REQUEST_SCHEMA_VERSION,
    action: DEFAULT_ACTION,
    asset: DEFAULT_ASSET,
    unit: DEFAULT_ASSET,
    requested_units: $("#exposure-requested-units")?.value.trim() ?? "",
  };
}

function authorizedRequest() {
  const request = state.evaluation?.request;
  const allowed = state.evaluation?.policy?.allowed_units;
  if (!request || !positiveUnits(allowed)) return null;
  return { ...request, requested_units: allowed };
}

async function evaluate(event) {
  event.preventDefault();
  clearDecisionState();
  const request = requestFromForm();
  setStatus("Refreshing Graph and same-block Base RPC evidence…", "loading");
  setDisabled("#exposure-evaluate", true);
  try {
    const result = await postJson("/api/exposure/evaluate", request);
    renderEvaluation(result);
    if (result.status === "ok") {
    setStatus(
      result.mode === "fixture"
        ? "Fixture evidence qualified for a local rehearsal; it is not current live evidence."
        : "Live evidence qualified; inspect the graph before issuing a permit.",
      "success",
    );
    } else {
      setStatus("Source or policy conditions are blocked; no authorization was issued.", "error");
    }
  } catch (error) {
    if (error?.payload?.policy) {
      renderEvaluation(error.payload);
    }
    setStatus(`Evaluation blocked: ${errorMessage(error)}`, "error");
  } finally {
    setDisabled("#exposure-evaluate", false);
  }
}

async function issuePermit() {
  if (!state.evaluationRef) return;
  setStatus("Issuing a permit bound to the stored evaluation…", "loading");
  setDisabled("#exposure-issue-permit", true);
  try {
    const result = await postJson("/api/exposure/permit", { evaluation_ref: state.evaluationRef });
    state.permit = result.permit;
    renderPermit(state.permit);
    setStatus("Demo permit issued; verify it against the downsized authorized request.", "success");
  } catch (error) {
    setStatus(`Permit blocked: ${errorMessage(error)}`, "error");
    setDisabled("#exposure-issue-permit", false);
  }
}

async function verifyPermit() {
  const request = authorizedRequest();
  if (!state.permit || !request) return;
  setStatus("Verifying signature, request binding and permit conditions…", "loading");
  setDisabled("#exposure-verify-permit", true);
  try {
    const result = await postJson("/api/exposure/verify", { request, permit: state.permit });
    state.verification = result;
    renderVerification(result);
    setStatus(
      result.executable ? "Permit is executable for the authorized amount." : `Permit blocked: ${humanize(result.code)}.`,
      result.executable ? "success" : "error",
    );
  } catch (error) {
    setStatus(`Permit verification failed: ${errorMessage(error)}`, "error");
    setDisabled("#exposure-verify-permit", false);
  }
}

async function paperExecute() {
  const request = authorizedRequest();
  if (!state.permit || !request || state.verification?.executable !== true) return;
  setStatus("Refreshing evidence before paper execution…", "loading");
  setDisabled("#exposure-paper-execute", true);
  try {
    const result = await postJson("/api/exposure/paper-execute", { request, permit: state.permit });
    state.execution = result;
    setText("#exposure-execution-output", prettyJson(result));
    setStatus(
      result.executable ? "Paper execution completed after fresh condition checks." : `Paper execution blocked: ${humanize(result.code)}.`,
      result.executable ? "success" : "error",
    );
  } catch (error) {
    setText("#exposure-execution-output", prettyJson(error?.payload ?? { error: errorMessage(error) }));
    setStatus(`Paper execution blocked: ${errorMessage(error)}`, "error");
  }
}

async function replay() {
  if (!state.evaluationRef) return;
  setStatus("Loading stored replay without calling the live provider…", "loading");
  setDisabled("#exposure-run-replay", true);
  try {
    const result = await postJson("/api/exposure/replay", { evaluation_ref: state.evaluationRef });
    renderReplay(result);
    setStatus("Replay loaded and labeled separately from current evidence.", "success");
  } catch (error) {
    setStatus(`Replay blocked: ${errorMessage(error)}`, "error");
    setDisabled("#exposure-run-replay", false);
  }
}

function bindPathInteractions() {
  for (const selector of ["#graph-path-direct", "#graph-path-aave"]) {
    const group = $(selector);
    if (!group) continue;
    const select = () => {
      if (group.getAttribute("aria-disabled") !== "false") return;
      renderPathDetails(group.dataset.pathKind);
    };
    group.addEventListener("click", select);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
  }
}

async function loadConfig() {
  try {
    state.config = await getJson("/api/exposure/config");
    state.planConfig = await getJson("/api/exposure/plan/config");
    renderConfig(state.config);
    if (!state.plan) setStatus("Server-owned configuration loaded. Submit the bounded request to begin.", "success");
  } catch (error) {
    clearDecisionState();
    setStatus(`Configuration blocked: ${errorMessage(error)}`, "error");
  }
}

if (typeof document !== "undefined") {
  $("#exposure-request-form")?.addEventListener("submit", evaluate);
  $("#exposure-issue-permit")?.addEventListener("click", issuePermit);
  $("#exposure-verify-permit")?.addEventListener("click", verifyPermit);
  $("#exposure-paper-execute")?.addEventListener("click", paperExecute);
  $("#exposure-run-replay")?.addEventListener("click", replay);
  $("#plan-case-repair")?.addEventListener("click", () => loadPlanCase("repair_over_limit"));
  $("#plan-case-restore")?.addEventListener("click", () => loadPlanCase("restore_aave_cap"));
  $("#plan-case-total")?.addEventListener("click", () => loadPlanCase("reduce_total_exposure"));
  $("#plan-source-fixture")?.addEventListener("click", () => loadFixtureSource("repair_over_limit"));
  $("#plan-source-live")?.addEventListener("click", loadLiveSource);
  $("#plan-run-what-if")?.addEventListener("click", () => {
    void runPlanWhatIf();
  });
  $("#plan-edit-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void evaluateEditedPlan();
  });
  for (const input of document.querySelectorAll("#plan-edit-form input, #plan-edit-form select")) {
    input.addEventListener("input", () => markPlanStale());
    input.addEventListener("change", () => markPlanStale());
  }
  $("#plan-add-step")?.addEventListener("click", () => {
    if (state.planStepCount >= 3) return;
    markPlanStale("Step order changed; evaluate the current plan.");
    setPlanStepCount(state.planStepCount + 1);
  });
  $("#plan-remove-step")?.addEventListener("click", () => {
    if (state.planStepCount <= 1) return;
    markPlanStale("Step order changed; evaluate the current plan.");
    setPlanStepCount(state.planStepCount - 1);
  });
  bindPathInteractions();

  async function boot() {
    await loadConfig();
    await loadPlanCase("repair_over_limit");
  }

  boot();
}
