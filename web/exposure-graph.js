const REQUEST_SCHEMA_VERSION = "sentinel-exposure-buy.v1";
const DEFAULT_ACTION = "BUY_EXPOSURE";
const DEFAULT_ASSET = "wstETH";

const state = {
  config: null,
  evaluation: null,
  evaluationRef: null,
  permit: null,
  verification: null,
  execution: null,
  replay: null,
  selectedPath: null,
};

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
  return typeof value === "string" && value.length > 0 ? `${value} wstETH` : "—";
}

function positiveUnits(value) {
  try {
    return typeof value === "string" && BigInt(value.replace(".", "")) > 0n;
  } catch {
    return false;
  }
}

function policyPillClass(verdict) {
  if (verdict === "ALLOW") return "status-pill status-pill-allow";
  if (verdict === "ALLOW_WITH_DOWNSIZE") return "status-pill status-pill-downsize";
  if (verdict === "DENY") return "status-pill status-pill-deny";
  return "status-pill status-pill-neutral";
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
  const canIssue = result?.status === "ok"
    && Boolean(state.evaluationRef)
    && result?.policy?.verdict !== "DENY"
    && positiveUnits(result?.policy?.allowed_units);
  setDisabled("#exposure-issue-permit", !canIssue);
  setDisabled("#exposure-run-replay", !Boolean(state.evaluationRef));
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
    renderConfig(state.config);
    setStatus("Server-owned configuration loaded. Submit the bounded request to begin.", "success");
  } catch (error) {
    clearDecisionState();
    setStatus(`Configuration blocked: ${errorMessage(error)}`, "error");
  }
}

$("#exposure-request-form")?.addEventListener("submit", evaluate);
$("#exposure-issue-permit")?.addEventListener("click", issuePermit);
$("#exposure-verify-permit")?.addEventListener("click", verifyPermit);
$("#exposure-paper-execute")?.addEventListener("click", paperExecute);
$("#exposure-run-replay")?.addEventListener("click", replay);
bindPathInteractions();
loadConfig();
