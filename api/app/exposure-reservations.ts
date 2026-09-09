import { createHash, randomUUID } from "node:crypto";

import type { ExposureAgentId, ExposurePlanV1 } from "../../shared/schemas/exposure-plan.ts";
import { validateExposurePlan } from "./exposure-plan-request.ts";
import {
  evaluateExposurePlan,
  type ExposureAccountingState,
  type ExposurePlanEvaluation,
  type ExposurePlanPolicy,
  type ExposurePlanResourceRequirements,
  type ExposureReservationDelta,
  type ExposureSourceProvenance,
} from "./exposure-plan-engine.ts";
import { formatFixedUnits, parseFixedUnits } from "./exposure-policy.ts";

export type ExposureReservationSessionMode = "live" | "fixture" | "replay";

export type ExposureReservationSource = {
  evaluation_ref: string;
  graph_hash: string;
  provenance: ExposureSourceProvenance;
  qualified: boolean;
  account?: string;
  chain_id?: number;
};

export type ExposureReservationSourceSnapshot = {
  state: ExposureAccountingState;
  source: ExposureReservationSource;
  session_id: string;
  mode: ExposureReservationSessionMode;
  runtime_generation: string;
  state_revision?: number;
};

export type ExposureReservationRuntimeOptions = {
  account_scope: string;
  base_state: ExposureAccountingState;
  policy: ExposurePlanPolicy;
  source: ExposureReservationSource;
  session_id: string;
  mode: ExposureReservationSessionMode;
  runtime_generation: string;
  now?: Date;
  reservation_ttl_ms?: number;
  idempotency_retention_ms?: number;
  max_reservations?: number;
  max_idempotency_entries?: number;
  paper_session_eligible?: boolean;
};

export type ExposureReservationRuntime = {
  account_scope: string;
  base_state: ExposureAccountingState;
  policy: ExposurePlanPolicy;
  source: ExposureReservationSource;
  session_id: string;
  mode: ExposureReservationSessionMode;
  runtime_generation: string;
  paper_session_eligible: boolean;
  state_revision: number;
  source_revision: number;
  reservation_revision: number;
  reservation_ttl_ms: number;
  idempotency_retention_ms: number;
  max_reservations: number;
  max_idempotency_entries: number;
  reservations: Map<string, ExposureReservationRecord>;
  idempotency: Map<string, ExposureIdempotencyRecord>;
};

export type ExposureReservationHost = ExposureReservationRuntime | {
  reservation_runtime: ExposureReservationRuntime;
};

export type ExposureReservationState =
  | "proposed"
  | "accepted_reserved"
  | "executing"
  | "paper_executed"
  | "rejected"
  | "cancelled"
  | "expired"
  | "invalidated"
  | "requires_re_evaluation";

export type ExposureReservationV1 = {
  reservation_id: string;
  plan_hash: string;
  plan: ExposurePlanV1;
  agent_id: ExposureAgentId;
  policy_version: string;
  evidence_ref: string;
  graph_hash: string;
  peak_total_increase_units: string;
  peak_aave_increase_units: string;
  required_preexisting_direct_units: string;
  required_preexisting_aave_units: string;
  internal_acquired_consumed_units: string;
  state: ExposureReservationState;
  session_id: string;
  mode: ExposureReservationSessionMode;
  source_provenance: ExposureSourceProvenance;
  runtime_generation: string;
  idempotency_key: string;
  created_at: string;
  expires_at: string;
  capacity_release_event_id: string | null;
};

export type ExposureReservationRequest = {
  evaluation_ref: string;
  graph_hash: string;
  idempotency_key: string;
  accept_partial?: boolean;
  session_id?: string;
  mode?: ExposureReservationSessionMode;
  runtime_generation?: string;
  now?: Date;
};

export type ExposureReservationRejectionCode =
  | "INVALID_PLAN"
  | "INVALID_REQUEST"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_REFERENCE_MISMATCH"
  | "SESSION_CONTEXT_MISMATCH"
  | "RUNTIME_RESTART_INVALIDATED"
  | "POLICY_VIOLATION"
  | "GOAL_UNSATISFIED"
  | "PARTIAL_ACCEPTANCE_REQUIRED"
  | "PAPER_SESSION_INELIGIBLE"
  | "SHARED_CAPACITY_INSUFFICIENT"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "IDEMPOTENCY_KEY_TERMINAL"
  | "IDEMPOTENCY_STORE_FULL"
  | "RESERVATION_STORAGE_FULL"
  | "RESERVATION_NOT_FOUND"
  | "RESERVATION_EXPIRED"
  | "INVALID_RESERVATION_STATE"
  | "STATE_CHANGED_REQUIRES_REEVALUATION";

export type ExposureReservationAdmission =
  | {
      status: "accepted_reserved";
      reservation: ExposureReservationV1;
      evaluation: ExposurePlanEvaluation;
      idempotent?: boolean;
    }
  | {
      status: "rejected";
      code: ExposureReservationRejectionCode;
      details: string[];
      evaluation?: ExposurePlanEvaluation;
    };

export type ExposureReservationLifecycleResult =
  | { status: "cancelled"; reservation: ExposureReservationV1 }
  | { status: "expired"; reservation: ExposureReservationV1 }
  | { status: "rejected"; code: ExposureReservationRejectionCode; details: string[] };

export type ExposureReservationCapacity = {
  base_total_headroom_raw: bigint;
  remaining_total_headroom_raw: bigint;
  base_aave_headroom_raw: bigint;
  remaining_aave_headroom_raw: bigint;
  remaining_direct_inventory_raw: bigint;
  remaining_aave_inventory_raw: bigint;
  active_reservation_count: number;
};

export type ExposureReservationRefreshResult =
  | { status: "ok"; snapshot: ExposureReservationSourceSnapshot }
  | { status: "blocked"; code: "SOURCE_UNAVAILABLE" };

export type ExposureReservationRefresh = () => Promise<ExposureReservationRefreshResult>;

type ExposureReservationRecord = {
  reservation: ExposureReservationV1;
  plan: ExposurePlanV1;
  evaluation: ExposurePlanEvaluation;
  resources: ExposurePlanResourceRequirements;
  fingerprint: string;
  version: number;
};

export type ExposureReservationExecutionView = {
  reservation: ExposureReservationV1;
  plan: ExposurePlanV1;
  evaluation: ExposurePlanEvaluation;
  resources: ExposurePlanResourceRequirements;
  version: number;
};

export type ExposureReservationPaperCommitResult =
  | { status: "paper_executed"; reservation: ExposureReservationV1 }
  | { status: "rejected"; code: ExposureReservationRejectionCode; details: string[] };

type ExposureIdempotencyRecord = {
  fingerprint: string;
  reservation: ExposureReservationV1;
  evaluation: ExposurePlanEvaluation;
  created_at_ms: number;
  expires_at_ms: number;
};

const DEFAULT_RESERVATION_TTL_MS = 60_000;
const DEFAULT_IDEMPOTENCY_RETENTION_MS = 10 * 60_000;
const DEFAULT_MAX_RESERVATIONS = 128;
const DEFAULT_MAX_IDEMPOTENCY_ENTRIES = 512;

const DEFAULT_POLICY: ExposurePlanPolicy = {
  policy_version: "exposure-plan-wsteth-v1",
  dependency_cap_units: "1.000000000000000000",
  aave_cap_units: "0.500000000000000000",
  unit: "wstETH",
};

function defaultState(): ExposureAccountingState {
  return {
    direct_available_raw: 0n,
    aave_exposure_raw: 0n,
    total_exposure_raw: 0n,
    debt_raw: 0n,
    dependency_cap_raw: parseFixedUnits(DEFAULT_POLICY.dependency_cap_units),
    aave_cap_raw: parseFixedUnits(DEFAULT_POLICY.aave_cap_units),
  };
}

function defaultSource(): ExposureReservationSource {
  return {
    evaluation_ref: "unqualified",
    graph_hash: "unqualified",
    provenance: "FIXTURE",
    qualified: false,
  };
}

function cloneState(state: ExposureAccountingState): ExposureAccountingState {
  return { ...state };
}

function clonePlan(plan: ExposurePlanV1): ExposurePlanV1 {
  return {
    schema_version: plan.schema_version,
    agent_id: plan.agent_id,
    goal: { ...plan.goal },
    steps: plan.steps.map((step) => ({ ...step })),
  };
}

function cloneValue<T>(value: T): T {
  if (typeof value === "bigint") return value.toString() as T;
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = cloneValue(item);
    }
    return result as T;
  }
  return value;
}

function restoreBigInts<T>(value: T, bigintKeys = new Set([
  "direct_available_raw",
  "aave_exposure_raw",
  "total_exposure_raw",
  "debt_raw",
  "dependency_cap_raw",
  "aave_cap_raw",
  "peak_total_increase_raw",
  "peak_aave_increase_raw",
  "required_preexisting_direct_raw",
  "required_preexisting_aave_raw",
  "internal_acquired_consumed_raw",
])): T {
  if (typeof value === "string") return value as T;
  if (Array.isArray(value)) return value.map((item) => restoreBigInts(item, bigintKeys)) as T;
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = bigintKeys.has(key) && typeof item === "string" ? BigInt(item) : restoreBigInts(item, bigintKeys);
    }
    return result as T;
  }
  return value;
}

function cloneEvaluation(evaluation: ExposurePlanEvaluation): ExposurePlanEvaluation {
  return restoreBigInts(cloneValue(evaluation));
}

function runtimeOf(host: ExposureReservationHost): ExposureReservationRuntime {
  if ("reservation_runtime" in host) return host.reservation_runtime;
  return host;
}

function safePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
}

export function createExposureReservationRuntime(
  options: Partial<ExposureReservationRuntimeOptions> = {},
): ExposureReservationRuntime {
  const policy = options.policy ?? DEFAULT_POLICY;
  const baseState = options.base_state ? cloneState(options.base_state) : defaultState();
  const now = options.now ?? new Date();
  const source = options.source ?? defaultSource();
  return {
    account_scope: options.account_scope ?? "server-owned",
    base_state: baseState,
    policy,
    source: { ...source },
    session_id: options.session_id ?? `session_${randomUUID().replaceAll("-", "")}`,
    mode: options.mode ?? "fixture",
    runtime_generation: options.runtime_generation ?? `generation_${randomUUID().replaceAll("-", "")}`,
    paper_session_eligible: options.paper_session_eligible !== false,
    state_revision: 0,
    source_revision: 0,
    reservation_revision: 0,
    reservation_ttl_ms: safePositiveInteger(options.reservation_ttl_ms, DEFAULT_RESERVATION_TTL_MS),
    idempotency_retention_ms: safePositiveInteger(options.idempotency_retention_ms, DEFAULT_IDEMPOTENCY_RETENTION_MS),
    max_reservations: safePositiveInteger(options.max_reservations, DEFAULT_MAX_RESERVATIONS),
    max_idempotency_entries: safePositiveInteger(options.max_idempotency_entries, DEFAULT_MAX_IDEMPOTENCY_ENTRIES),
    reservations: new Map(),
    idempotency: new Map(),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function planHash(plan: ExposurePlanV1): string {
  return createHash("sha256").update(canonicalJson(plan)).digest("hex");
}

function cloneReservation(reservation: ExposureReservationV1): ExposureReservationV1 {
  return {
    ...reservation,
    plan: clonePlan(reservation.plan),
  };
}

function activeRecord(record: ExposureReservationRecord): boolean {
  return record.reservation.state === "accepted_reserved" || record.reservation.state === "executing";
}

function activeRecords(runtime: ExposureReservationRuntime): ExposureReservationRecord[] {
  return [...runtime.reservations.values()].filter(activeRecord);
}

function reservationDelta(record: ExposureReservationRecord): ExposureReservationDelta {
  return {
    reservation_id: record.reservation.reservation_id,
    agent_id: record.reservation.agent_id,
    peak_total_increase_raw: record.resources.peak_total_increase_raw,
    peak_aave_increase_raw: record.resources.peak_aave_increase_raw,
    required_preexisting_direct_raw: record.resources.required_preexisting_direct_raw,
    required_preexisting_aave_raw: record.resources.required_preexisting_aave_raw,
    status: record.reservation.state === "executing" ? "executing" : "accepted_reserved",
  };
}

function activeDeltas(runtime: ExposureReservationRuntime): ExposureReservationDelta[] {
  return activeRecords(runtime).map(reservationDelta);
}

export function getActiveExposureReservationDeltas(
  host: ExposureReservationHost,
  options: { exclude_reservation_id?: string } = {},
): ExposureReservationDelta[] {
  const runtime = runtimeOf(host);
  return activeRecords(runtime)
    .filter((record) => record.reservation.reservation_id !== options.exclude_reservation_id)
    .map(reservationDelta)
    .map((delta) => ({ ...delta }));
}

export function getExposureReservationExecutionView(
  host: ExposureReservationHost,
  reservationId: string,
): ExposureReservationExecutionView | null {
  const runtime = runtimeOf(host);
  const record = runtime.reservations.get(reservationId);
  if (!record) return null;
  return {
    reservation: cloneReservation(record.reservation),
    plan: clonePlan(record.plan),
    evaluation: cloneEvaluation(record.evaluation),
    resources: { ...record.resources },
    version: record.version,
  };
}

export function commitExposureReservationPaperExecution(
  host: ExposureReservationHost,
  reservationId: string,
  expectedVersion: number,
  commit: (view: ExposureReservationExecutionView) => void,
  options: { now?: Date } = {},
): ExposureReservationPaperCommitResult {
  const runtime = runtimeOf(host);
  const nowMs = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(nowMs)) return { status: "rejected", code: "INVALID_REQUEST", details: ["now"] };
  pruneRuntime(runtime, nowMs);
  const record = runtime.reservations.get(reservationId);
  if (!record) return { status: "rejected", code: "RESERVATION_NOT_FOUND", details: ["reservation_unknown"] };
  if (record.reservation.state !== "accepted_reserved") {
    return { status: "rejected", code: "INVALID_RESERVATION_STATE", details: [record.reservation.state] };
  }
  if (record.version !== expectedVersion) {
    return { status: "rejected", code: "STATE_CHANGED_REQUIRES_REEVALUATION", details: ["reservation_version_changed"] };
  }
  const view: ExposureReservationExecutionView = {
    reservation: cloneReservation(record.reservation),
    plan: clonePlan(record.plan),
    evaluation: cloneEvaluation(record.evaluation),
    resources: { ...record.resources },
    version: record.version,
  };
  try {
    commit(view);
  } catch {
    return { status: "rejected", code: "INVALID_RESERVATION_STATE", details: ["paper_commit_failed"] };
  }
  transitionRelease(runtime, record, "paper_executed", nowMs);
  return { status: "paper_executed", reservation: cloneReservation(record.reservation) };
}

function sumResource(
  records: ExposureReservationRecord[],
  field: keyof ExposurePlanResourceRequirements,
): bigint {
  return records.reduce((sum, record) => sum + record.resources[field], 0n);
}

function nonNegative(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function sourceBaselineAave(runtime: ExposureReservationRuntime): bigint {
  const cap = runtime.base_state.aave_cap_raw;
  return runtime.base_state.aave_exposure_raw < cap ? runtime.base_state.aave_exposure_raw : cap;
}

export function getExposureReservationCapacity(host: ExposureReservationHost): ExposureReservationCapacity {
  const runtime = runtimeOf(host);
  const active = activeRecords(runtime);
  const totalReserved = sumResource(active, "peak_total_increase_raw");
  const aaveReserved = sumResource(active, "peak_aave_increase_raw");
  return {
    base_total_headroom_raw: nonNegative(runtime.base_state.dependency_cap_raw - runtime.base_state.total_exposure_raw),
    remaining_total_headroom_raw: nonNegative(
      runtime.base_state.dependency_cap_raw - runtime.base_state.total_exposure_raw - totalReserved,
    ),
    base_aave_headroom_raw: nonNegative(runtime.base_state.aave_cap_raw - sourceBaselineAave(runtime)),
    remaining_aave_headroom_raw: nonNegative(
      runtime.base_state.aave_cap_raw - sourceBaselineAave(runtime) - aaveReserved,
    ),
    remaining_direct_inventory_raw: nonNegative(
      runtime.base_state.direct_available_raw - sumResource(active, "required_preexisting_direct_raw"),
    ),
    remaining_aave_inventory_raw: nonNegative(
      runtime.base_state.aave_exposure_raw - sumResource(active, "required_preexisting_aave_raw"),
    ),
    active_reservation_count: active.length,
  };
}

function pruneIdempotency(runtime: ExposureReservationRuntime, nowMs: number): void {
  for (const [key, record] of runtime.idempotency) {
    const liveReservation = runtime.reservations.get(record.reservation.reservation_id);
    const reservationIsActive = liveReservation
      ? activeRecord(liveReservation)
      : record.reservation.state === "accepted_reserved" || record.reservation.state === "executing";
    // An active reservation keeps its idempotency receipt indefinitely. The
    // retention window starts when the reservation becomes terminal below.
    if (reservationIsActive) continue;
    if (record.expires_at_ms <= nowMs) runtime.idempotency.delete(key);
  }
}

function pruneTerminalReservations(runtime: ExposureReservationRuntime): void {
  if (runtime.reservations.size < runtime.max_reservations) return;
  for (const [id, record] of runtime.reservations) {
    if (!activeRecord(record) && runtime.reservations.size >= runtime.max_reservations) {
      runtime.reservations.delete(id);
    }
    if (runtime.reservations.size < runtime.max_reservations) return;
  }
}

function expireInternal(runtime: ExposureReservationRuntime, nowMs: number): ExposureReservationV1[] {
  const expired: ExposureReservationV1[] = [];
  for (const record of runtime.reservations.values()) {
    if (record.reservation.state !== "accepted_reserved") continue;
    if (Date.parse(record.reservation.expires_at) > nowMs) continue;
    transitionRelease(runtime, record, "expired", nowMs);
    expired.push(cloneReservation(record.reservation));
  }
  return expired;
}

function pruneRuntime(runtime: ExposureReservationRuntime, nowMs: number): void {
  expireInternal(runtime, nowMs);
  pruneIdempotency(runtime, nowMs);
  pruneTerminalReservations(runtime);
}

function invalid(details: string[]): ExposureReservationAdmission {
  return { status: "rejected", code: "INVALID_REQUEST", details };
}

function requestContext(runtime: ExposureReservationRuntime, request: ExposureReservationRequest) {
  return {
    session_id: request.session_id ?? runtime.session_id,
    mode: request.mode ?? runtime.mode,
    runtime_generation: request.runtime_generation ?? runtime.runtime_generation,
  };
}

function validateContext(
  runtime: ExposureReservationRuntime,
  request: ExposureReservationRequest,
): ExposureReservationAdmission | null {
  const context = requestContext(runtime, request);
  if (context.runtime_generation !== runtime.runtime_generation) {
    return { status: "rejected", code: "RUNTIME_RESTART_INVALIDATED", details: ["runtime_generation_mismatch"] };
  }
  if (context.session_id !== runtime.session_id || context.mode !== runtime.mode) {
    return { status: "rejected", code: "SESSION_CONTEXT_MISMATCH", details: ["session_or_mode_mismatch"] };
  }
  if (request.evaluation_ref !== runtime.source.evaluation_ref || request.graph_hash !== runtime.source.graph_hash) {
    return { status: "rejected", code: "SOURCE_REFERENCE_MISMATCH", details: ["source_identity_mismatch"] };
  }
  if (!runtime.source.qualified) {
    return { status: "rejected", code: "SOURCE_UNAVAILABLE", details: ["source_not_qualified"] };
  }
  return null;
}

function requestFingerprint(plan: ExposurePlanV1, request: ExposureReservationRequest, runtime: ExposureReservationRuntime): string {
  const context = requestContext(runtime, request);
  return createHash("sha256").update(canonicalJson({
    plan,
    evaluation_ref: request.evaluation_ref,
    graph_hash: request.graph_hash,
    source_provenance: runtime.source.provenance,
    accept_partial: request.accept_partial === true,
    ...context,
  })).digest("hex");
}

function fromIdempotency(
  runtime: ExposureReservationRuntime,
  key: string,
  fingerprint: string,
): ExposureReservationAdmission | null {
  const stored = runtime.idempotency.get(key);
  if (!stored) return null;
  if (stored.fingerprint !== fingerprint) {
    return { status: "rejected", code: "IDEMPOTENCY_KEY_CONFLICT", details: ["idempotency_payload_mismatch"] };
  }
  const liveRecord = runtime.reservations.get(stored.reservation.reservation_id);
  const currentReservation = liveRecord?.reservation ?? stored.reservation;
  if (currentReservation.state !== "accepted_reserved" && currentReservation.state !== "executing") {
    return {
      status: "rejected",
      code: "IDEMPOTENCY_KEY_TERMINAL",
      details: [`reservation_${currentReservation.state}`],
    };
  }
  if (!liveRecord) {
    return {
      status: "rejected",
      code: "RESERVATION_NOT_FOUND",
      details: ["active_reservation_missing"],
    };
  }
  return {
    status: "accepted_reserved",
    reservation: cloneReservation(liveRecord.reservation),
    evaluation: cloneEvaluation(liveRecord.evaluation),
    idempotent: true,
  };
}

function admissionFromEvaluation(
  evaluation: ExposurePlanEvaluation,
  hasActiveReservations: boolean,
): { code: ExposureReservationRejectionCode; details: string[] } | null {
  const details = [...new Set(evaluation.violations.map((violation) => violation.code))];
  if (hasActiveReservations && details.some((code) => code.startsWith("reserved_"))) {
    return { code: "SHARED_CAPACITY_INSUFFICIENT", details };
  }
  if (evaluation.policy_status !== "PASS") return { code: "POLICY_VIOLATION", details };
  if (evaluation.goal_status === "UNSATISFIED") return { code: "GOAL_UNSATISFIED", details: ["goal_unsatisfied"] };
  if (evaluation.goal_status === "PARTIAL" && evaluation.paper_eligibility !== "ELIGIBLE") {
    return { code: "PARTIAL_ACCEPTANCE_REQUIRED", details: ["partial_requires_operator_acceptance"] };
  }
  if (evaluation.paper_eligibility !== "ELIGIBLE") {
    return { code: "PAPER_SESSION_INELIGIBLE", details: ["paper_session_ineligible"] };
  }
  if (evaluation.execution_mode !== "PAPER_AUTHORIZABLE") {
    return { code: "POLICY_VIOLATION", details: evaluation.execution_preconditions };
  }
  return null;
}

function serializeResource(value: bigint): string {
  return formatFixedUnits(value);
}

function makeReservation(
  runtime: ExposureReservationRuntime,
  plan: ExposurePlanV1,
  request: ExposureReservationRequest,
  evaluation: ExposurePlanEvaluation,
  nowMs: number,
): ExposureReservationAdmission {
  if (runtime.reservations.size >= runtime.max_reservations) {
    pruneTerminalReservations(runtime);
    if (runtime.reservations.size >= runtime.max_reservations) {
      return { status: "rejected", code: "RESERVATION_STORAGE_FULL", details: ["reservation_storage_bounded"] };
    }
  }
  if (runtime.idempotency.size >= runtime.max_idempotency_entries) {
    pruneIdempotency(runtime, nowMs);
    if (runtime.idempotency.size >= runtime.max_idempotency_entries) {
      return { status: "rejected", code: "IDEMPOTENCY_STORE_FULL", details: ["idempotency_storage_bounded"] };
    }
  }

  const context = requestContext(runtime, request);
  const reservationId = `reservation_${randomUUID().replaceAll("-", "")}`;
  const createdAt = new Date(nowMs).toISOString();
  const resources = evaluation.resource_requirements;
  const reservation: ExposureReservationV1 = {
    reservation_id: reservationId,
    plan_hash: evaluation.plan_hash,
    plan: clonePlan(plan),
    agent_id: plan.agent_id,
    policy_version: runtime.policy.policy_version,
    evidence_ref: request.evaluation_ref,
    graph_hash: request.graph_hash,
    peak_total_increase_units: serializeResource(resources.peak_total_increase_raw),
    peak_aave_increase_units: serializeResource(resources.peak_aave_increase_raw),
    required_preexisting_direct_units: serializeResource(resources.required_preexisting_direct_raw),
    required_preexisting_aave_units: serializeResource(resources.required_preexisting_aave_raw),
    internal_acquired_consumed_units: serializeResource(resources.internal_acquired_consumed_raw),
    state: "accepted_reserved",
    session_id: context.session_id,
    mode: context.mode,
    source_provenance: runtime.source.provenance,
    runtime_generation: context.runtime_generation,
    idempotency_key: request.idempotency_key,
    created_at: createdAt,
    expires_at: new Date(nowMs + runtime.reservation_ttl_ms).toISOString(),
    capacity_release_event_id: null,
  };
  const record: ExposureReservationRecord = {
    reservation,
    plan: clonePlan(plan),
    evaluation: cloneEvaluation(evaluation),
    resources: { ...resources },
    fingerprint: requestFingerprint(plan, request, runtime),
    version: 1,
  };
  runtime.reservations.set(reservationId, record);
  runtime.idempotency.set(request.idempotency_key, {
    fingerprint: record.fingerprint,
    reservation: cloneReservation(reservation),
    evaluation: cloneEvaluation(evaluation),
    created_at_ms: nowMs,
    // Active records are protected from eviction. This is replaced with a
    // bounded post-terminal expiry when transitionRelease() runs.
    expires_at_ms: Number.POSITIVE_INFINITY,
  });
  runtime.reservation_revision += 1;
  return {
    status: "accepted_reserved",
    reservation: cloneReservation(reservation),
    evaluation: cloneEvaluation(evaluation),
  };
}

function admitAgainstSnapshot(
  runtime: ExposureReservationRuntime,
  plan: ExposurePlanV1,
  request: ExposureReservationRequest,
  state: ExposureAccountingState,
  source: ExposureReservationSource,
  nowMs: number,
): ExposureReservationAdmission {
  const contextFailure = validateContext({ ...runtime, base_state: state, source }, request);
  if (contextFailure) return contextFailure;
  const evaluation = evaluateExposurePlan(state, plan, runtime.policy, activeDeltas(runtime), {
    source_provenance: source.provenance,
    paper_session_eligible: runtime.paper_session_eligible,
    accept_partial: request.accept_partial === true,
  });
  const failure = admissionFromEvaluation(evaluation, activeRecords(runtime).length > 0);
  if (failure) return { status: "rejected", ...failure, evaluation: cloneEvaluation(evaluation) };
  return makeReservation(runtime, plan, request, evaluation, nowMs);
}

function normalizedPlan(input: ExposurePlanV1): ExposurePlanV1 | null {
  const result = validateExposurePlan(input);
  return result.ok ? result.plan : null;
}

function prepareAdmission(
  runtime: ExposureReservationRuntime,
  input: ExposurePlanV1,
  request: ExposureReservationRequest,
): { plan: ExposurePlanV1; fingerprint: string; nowMs: number } | ExposureReservationAdmission {
  const plan = normalizedPlan(input);
  if (!plan) return { status: "rejected", code: "INVALID_PLAN", details: ["invalid_exposure_plan"] };
  if (typeof request.idempotency_key !== "string" || request.idempotency_key.length === 0 || request.idempotency_key.length > 128) {
    return invalid(["idempotency_key"]);
  }
  if (typeof request.evaluation_ref !== "string" || typeof request.graph_hash !== "string") {
    return invalid(["source_identity"]);
  }
  const nowMs = (request.now ?? new Date()).getTime();
  if (!Number.isFinite(nowMs)) return invalid(["now"]);
  pruneRuntime(runtime, nowMs);
  const fingerprint = requestFingerprint(plan, request, runtime);
  const contextFailure = validateContext(runtime, request);
  if (contextFailure) return contextFailure;
  const duplicate = fromIdempotency(runtime, request.idempotency_key, fingerprint);
  if (duplicate) return duplicate;
  return { plan, fingerprint, nowMs };
}

export function acceptExposurePlan(
  input: ExposurePlanV1,
  host: ExposureReservationHost,
  request: ExposureReservationRequest,
): ExposureReservationAdmission {
  const runtime = runtimeOf(host);
  const prepared = prepareAdmission(runtime, input, request);
  if ("status" in prepared) return prepared;
  return admitAgainstSnapshot(runtime, prepared.plan, request, runtime.base_state, runtime.source, prepared.nowMs);
}

function sameRuntimeVersion(
  runtime: ExposureReservationRuntime,
  version: { runtime_generation: string; session_id: string; mode: ExposureReservationSessionMode; state_revision: number; source_revision: number; reservation_revision: number },
): boolean {
  return runtime.runtime_generation === version.runtime_generation
    && runtime.session_id === version.session_id
    && runtime.mode === version.mode
    && runtime.state_revision === version.state_revision
    && runtime.source_revision === version.source_revision
    && runtime.reservation_revision === version.reservation_revision;
}

export async function acceptExposurePlanWithRefresh(
  input: ExposurePlanV1,
  host: ExposureReservationHost,
  request: ExposureReservationRequest,
  refresh: ExposureReservationRefresh,
): Promise<ExposureReservationAdmission> {
  const runtime = runtimeOf(host);
  const prepared = prepareAdmission(runtime, input, request);
  if ("status" in prepared) return prepared;
  const version = {
    runtime_generation: runtime.runtime_generation,
    session_id: runtime.session_id,
    mode: runtime.mode,
    state_revision: runtime.state_revision,
    source_revision: runtime.source_revision,
    reservation_revision: runtime.reservation_revision,
  };
  let refreshed: ExposureReservationRefreshResult;
  try {
    refreshed = await refresh();
  } catch {
    return { status: "rejected", code: "SOURCE_UNAVAILABLE", details: ["source_refresh_failed"] };
  }
  if (refreshed.status === "blocked") {
    return { status: "rejected", code: refreshed.code, details: ["source_refresh_failed"] };
  }
  if (!sameRuntimeVersion(runtime, version)) {
    return { status: "rejected", code: "STATE_CHANGED_REQUIRES_REEVALUATION", details: ["runtime_state_changed_during_refresh"] };
  }
  const snapshot = refreshed.snapshot;
  if (snapshot.runtime_generation !== runtime.runtime_generation
      || snapshot.session_id !== runtime.session_id
      || snapshot.mode !== runtime.mode) {
    return { status: "rejected", code: "STATE_CHANGED_REQUIRES_REEVALUATION", details: ["refresh_context_changed"] };
  }
  if (!snapshot.source.qualified) {
    return { status: "rejected", code: "SOURCE_UNAVAILABLE", details: ["source_not_qualified"] };
  }
  if (snapshot.source.evaluation_ref !== request.evaluation_ref || snapshot.source.graph_hash !== request.graph_hash) {
    return { status: "rejected", code: "SOURCE_REFERENCE_MISMATCH", details: ["refresh_source_identity_mismatch"] };
  }
  const result = admitAgainstSnapshot(
    runtime,
    prepared.plan,
    request,
    snapshot.state,
    snapshot.source,
    prepared.nowMs,
  );
  if (result.status !== "accepted_reserved") return result;
  runtime.base_state = cloneState(snapshot.state);
  runtime.source = { ...snapshot.source };
  runtime.state_revision += 1;
  runtime.source_revision += 1;
  return result;
}

function transitionRelease(
  runtime: ExposureReservationRuntime,
  record: ExposureReservationRecord,
  state: "cancelled" | "expired" | "invalidated" | "rejected" | "paper_executed",
  nowMs = Date.now(),
): void {
  if (record.reservation.state === state) return;
  record.reservation.state = state;
  if (record.reservation.capacity_release_event_id === null) {
    record.reservation.capacity_release_event_id = `release_${randomUUID().replaceAll("-", "")}`;
    runtime.reservation_revision += 1;
  }
  const stored = runtime.idempotency.get(record.reservation.idempotency_key);
  if (stored) {
    stored.reservation = cloneReservation(record.reservation);
    stored.expires_at_ms = nowMs + runtime.idempotency_retention_ms;
  }
  record.version += 1;
}

export function cancelExposureReservation(
  reservationId: string,
  host: ExposureReservationHost,
  options: { now?: Date } = {},
): ExposureReservationLifecycleResult {
  const runtime = runtimeOf(host);
  const nowMs = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(nowMs)) return { status: "rejected", code: "INVALID_REQUEST", details: ["now"] };
  pruneRuntime(runtime, nowMs);
  const record = runtime.reservations.get(reservationId);
  if (!record) return { status: "rejected", code: "RESERVATION_NOT_FOUND", details: ["reservation_unknown"] };
  if (record.reservation.state === "accepted_reserved") {
    transitionRelease(runtime, record, "cancelled", nowMs);
    return { status: "cancelled", reservation: cloneReservation(record.reservation) };
  }
  if (record.reservation.state === "cancelled") {
    return { status: "cancelled", reservation: cloneReservation(record.reservation) };
  }
  if (record.reservation.state === "expired") {
    return { status: "expired", reservation: cloneReservation(record.reservation) };
  }
  return { status: "rejected", code: "INVALID_RESERVATION_STATE", details: [record.reservation.state] };
}

export function expireExposureReservations(
  host: ExposureReservationHost,
  now = new Date(),
): ExposureReservationV1[] {
  const runtime = runtimeOf(host);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];
  const expired = expireInternal(runtime, nowMs);
  pruneIdempotency(runtime, nowMs);
  pruneTerminalReservations(runtime);
  return expired;
}

export function updateExposureReservationSource(
  host: ExposureReservationHost,
  snapshot: ExposureReservationSourceSnapshot,
  options: { now?: Date } = {},
): void {
  const runtime = runtimeOf(host);
  const contextChanged = runtime.session_id !== snapshot.session_id
    || runtime.mode !== snapshot.mode
    || runtime.runtime_generation !== snapshot.runtime_generation;
  const provenanceChanged = runtime.source.provenance !== snapshot.source.provenance;
  if (contextChanged || provenanceChanged) {
    const nowMs = (options.now ?? new Date()).getTime();
    for (const record of activeRecords(runtime)) {
      transitionRelease(runtime, record, "invalidated", Number.isFinite(nowMs) ? nowMs : Date.now());
    }
  }
  runtime.base_state = cloneState(snapshot.state);
  runtime.source = { ...snapshot.source };
  runtime.session_id = snapshot.session_id;
  runtime.mode = snapshot.mode;
  runtime.runtime_generation = snapshot.runtime_generation;
  runtime.state_revision += 1;
  runtime.source_revision += 1;
}
