const scenarioSelect = document.querySelector("#scenario-select");
const runButton = document.querySelector("#run-button");
const sourceStatus = document.querySelector("#source-status");
const runSummary = document.querySelector("#run-summary");
const decisionReadout = document.querySelector("#decision-readout");
const evidenceMetrics = document.querySelector("#evidence-metrics");
const gapList = document.querySelector("#gap-list");
const freshnessNote = document.querySelector("#freshness-note");
const intentPanel = document.querySelector("#intent-panel");
const evidencePanel = document.querySelector("#evidence-panel");
const policyPanel = document.querySelector("#policy-panel");

function renderJson(element, value) {
  element.textContent = JSON.stringify(value, null, 2);
}

function displayLabel(value) {
  return String(value).replaceAll("_", " ").replaceAll("-", " ");
}

function statusClass(decision) {
  if (decision === "ACCEPT" || decision === "ALLOW") return "allow";
  if (decision === "ALLOW_WITH_DOWNSIZE") return "downsize";
  if (decision === "DENY") return "deny";
  return "neutral";
}

function setStatus(label, variant = "neutral") {
  sourceStatus.textContent = label;
  sourceStatus.className = `status-pill status-pill-${variant}`;
}

function renderMetrics(evidence) {
  const source = evidence.source;
  const block = source.indexed_block;
  const values = [
    ["Source", source.provider],
    ["Indexed block", block.number > 0 ? String(block.number) : "not reported"],
    ["Observations", String(evidence.observations.length)],
  ];
  evidenceMetrics.replaceChildren();
  for (const [label, value] of values) {
    const item = document.createElement("div");
    item.className = "metric-item";
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    item.append(term, description);
    evidenceMetrics.append(item);
  }
}

function renderGaps(evidence) {
  gapList.replaceChildren();
  if (evidence.gaps.length === 0) {
    const item = document.createElement("li");
    item.className = "status-note-item";
    item.textContent = "No gaps reported by the normalized envelope.";
    gapList.append(item);
  } else {
    for (const gap of evidence.gaps) {
      const item = document.createElement("li");
      item.className = "status-note-item";
      item.textContent = displayLabel(gap);
      gapList.append(item);
    }
  }
  const age = evidence.source.index_age_seconds;
  freshnessNote.textContent = age === null
    ? "Indexed block age: not reported."
    : `Indexed block age: ${age} second${age === 1 ? "" : "s"}.`;
}

function renderDecision(evidence, policy) {
  const variant = statusClass(policy.verdict);
  decisionReadout.replaceChildren();
  const badge = document.createElement("span");
  badge.className = `status-pill status-pill-${variant}`;
  badge.textContent = displayLabel(policy.verdict);
  const detail = document.createElement("strong");
  detail.textContent = policy.reason_code;
  decisionReadout.append(badge, detail);
  setStatus(displayLabel(evidence.quality.decision), statusClass(evidence.quality.decision));
}

async function loadScenarioIntent(name) {
  const response = await fetch(`/api/demo/scenarios/${name}`);
  if (!response.ok) throw new Error(`Could not load scenario ${name}.`);
  const bundle = await response.json();
  return bundle.intent;
}

async function populateScenarios() {
  const response = await fetch("/api/demo/scenarios");
  if (!response.ok) throw new Error("Could not load canonical scenarios.");
  const payload = await response.json();
  for (const name of payload.scenarios) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = displayLabel(name);
    scenarioSelect.append(option);
  }
  scenarioSelect.value = "allow-btc-buy";
}

async function runEvidence() {
  runButton.disabled = true;
  setStatus("Refreshing", "neutral");
  runSummary.textContent = "Fetching the bounded Graph position query…";
  evidencePanel.textContent = "Loading…";
  policyPanel.textContent = "Loading…";
  try {
    const intent = await loadScenarioIntent(scenarioSelect.value);
    renderJson(intentPanel, intent);
    const response = await fetch("/api/position-evidence/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(displayLabel(payload.status ?? "provider error"), "deny");
      runSummary.textContent = "The source did not produce an authorizing result.";
      evidencePanel.textContent = JSON.stringify(payload, null, 2);
      policyPanel.textContent = "No policy decision emitted because the source request was not available.";
      return;
    }
    renderDecision(payload.evidence, payload.policy);
    renderMetrics(payload.evidence);
    renderGaps(payload.evidence);
    renderJson(evidencePanel, payload.evidence);
    renderJson(policyPanel, payload.policy);
    runSummary.textContent = `Provider ${payload.evidence.source.provider} returned ${payload.evidence.observations.length} observation${payload.evidence.observations.length === 1 ? "" : "s"}; quality is ${payload.evidence.quality.decision}.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not run evidence refresh.";
    setStatus("Load failed", "deny");
    runSummary.textContent = message;
    evidencePanel.textContent = message;
    policyPanel.textContent = "No policy decision emitted.";
  } finally {
    runButton.disabled = false;
  }
}

runButton.addEventListener("click", runEvidence);
scenarioSelect.addEventListener("change", runEvidence);

try {
  await populateScenarios();
  await runEvidence();
} catch (error) {
  const message = error instanceof Error ? error.message : "Could not initialize the evidence screen.";
  setStatus("Load failed", "deny");
  runSummary.textContent = message;
  intentPanel.textContent = message;
  evidencePanel.textContent = message;
  policyPanel.textContent = "No policy decision emitted.";
}
