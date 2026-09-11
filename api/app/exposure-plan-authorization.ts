import { randomUUID } from "node:crypto";

import type { ExposureEvaluation, ExposureMode } from "../../shared/schemas/exposure-graph.ts";
import type { ExposurePlanV1 } from "../../shared/schemas/exposure-plan.ts";
import type { ExposureSourceProvenance } from "./exposure-plan-engine.ts";
import {
  DEFAULT_EXPOSURE_PLAN_POLICY,
  deriveExposurePlanAccountingState,
  exposurePlanSourceProvenance,
} from "./exposure-plan-service.ts";
import {
  evaluateExposurePlan,
  type ExposureAccountingState,
  type ExposurePlanEvaluation,
  type ExposureReservationDelta,
} from "./exposure-plan-engine.ts";
import {
  issueExposurePlanPermit,
  verifyExposurePlanPermit,
  type SignedExposurePlanPermit,
} from "./exposure-plan-permit.ts";
import {
  acceptExposurePlan,
  cancelExposureReservation,
  commitExposureReservationPaperExecution,
  expireExposureReservations,
  getActiveExposureReservationDeltas,
  getExposureReservationExecutionView,
  type ExposureReservationHost,
  type ExposureReservationSessionMode,
  type ExposureReservationSource,
  type ExposureReservationSourceSnapshot,
  updateExposureReservationSource,
} from "./exposure-reservations.ts";
import type { ExposureRuntimeState } from "./exposure-service.ts";
import { validateExposurePlan } from "./exposure-plan-request.ts";

export const OPERATOR_SESSION_COOKIE_NAME = "sentinel_operator_session";
export const OPERATOR_SESSION_MODE = "live" as const;
export const DEFAULT_OPERATOR_ORIGIN = "http://127.0.0.1:8787";
export const DEFAULT_OPERATOR_SESSION_TTL_MS = 15 * 60_000;
export const DEFAULT_OPERATOR_RECOVERY_WINDOW_MS = 5 * 60_000;
export const MAX_OPERATOR_RECOVERY_WINDOW_MS = 15 * 60_000;

const ACCOUNT_PATTERN = /^0x[0-9a-f]{40}$/i;
const EVALUATION_REFERENCE_PATTERN = /^exposure_[0-9a-f]{32}$/;

export type ExposurePlanOperatorBoundaryConfig = {
  allowed_origin?: string;
  allowed_host?: string;
  session_ttl_ms?: number;
  recovery_window_ms?: number;
  max_sessions?: number;
  clock?: ExposureServerClock;
};

export type ExposureServerClock = () => Date;

export type OperatorRequestHeaders = Record<string, string | string[] | undefined>;

export type ExposurePlanOperatorSession = {
  session_id: string;
  csrf_token: string;
  runtime_generation: string;
  policy_version: string;
  mode: typeof OPERATOR_SESSION_MODE;
  expires_at: string;
};

export type ExposurePlanOperatorRecoveryChallenge = {
  status: "recovery_required";
  session_id: string;
  runtime_generation: string;
  policy_version: string;
  mode: typeof OPERATOR_SESSION_MODE;
  recovery_csrf_token: string;
  recovery_expires_at: string;
};

type OperatorSessionRecord = ExposurePlanOperatorSession & {
  cookie_token: string;
  expires_at_ms: number;
  recovery_csrf_token: string;
  recovery_expires_at_ms: number;
};

type AcceptedPlanRecord = {
  reservation_id: string;
  plan: ExposurePlanV1;
  evaluation: ExposurePlanEvaluation;
  source: ExposureReservationSource;
  account: string;
  chain_id: number;
  accept_partial: boolean;
};

export type ExposurePaperEvent = {
  event_id: string;
  reservation_id: string;
  plan_hash: string;
  before_state: ExposureAccountingState;
  after_state: ExposureAccountingState;
  source_provenance: ExposureReservationSource["provenance"];
  created_at: string;
};

export type ExposurePaperOverlay = {
  session_id: string;
  runtime_generation: string;
  base_state: ExposureAccountingState;
  effective_state: ExposureAccountingState;
  base_source: ExposureReservationSource;
  state_revision: number;
  events: ExposurePaperEvent[];
};

export type ExposurePlanAuthorizationRuntime = {
  sessions: Map<string, OperatorSessionRecord>;
  accepted_plans: Map<string, AcceptedPlanRecord>;
  session_source_provenance: ExposureSourceProvenance | null;
  paper_overlay: ExposurePaperOverlay | null;
  consumed_nonces: Set<string>;
  max_sessions: number;
  max_accepted_plans: number;
};

export type ExposurePlanRefreshResult =
  | { status: "ok"; snapshot: ExposureReservationSourceSnapshot }
  | { status: "blocked"; code: "SOURCE_UNAVAILABLE" };

export type ExposurePlanExecutionRequest = {
  reservation_id: string;
  permit: SignedExposurePlanPermit;
  session_id: string;
  mode: "live" | "what_if";
  /** Server-owned in HTTP routes; `now` is retained for deterministic internal callers. */
  clock?: ExposureServerClock;
  now?: Date;
};

export type ExposurePlanExecutionResult =
  | {
      status: "paper_executed";
      code: "PAPER_EXECUTED";
      permit_hash: string;
      nonce: string;
      reservation: unknown;
      overlay: unknown;
    }
  | {
      status: "rejected";
      code: string;
      details: string[];
      permit_hash: string;
      nonce: string;
    };

const AUTHORIZATION_RUNTIME_BY_STATE = new WeakMap<ExposureRuntimeState, ExposurePlanAuthorizationRuntime>();

function safePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
}

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isSafeInteger(value) && value! > 0 && value! <= maximum ? value! : fallback;
}

function runtimeOf(state: ExposureRuntimeState): ExposureReservationHost {
  return state.reservation_runtime;
}

export function getExposurePlanAuthorizationRuntime(
  state: ExposureRuntimeState,
): ExposurePlanAuthorizationRuntime {
  const existing = AUTHORIZATION_RUNTIME_BY_STATE.get(state);
  if (existing) return existing;
  const runtime: ExposurePlanAuthorizationRuntime = {
    sessions: new Map(),
    accepted_plans: new Map(),
    session_source_provenance: null,
    paper_overlay: null,
    consumed_nonces: new Set(),
    max_sessions: 16,
    max_accepted_plans: 128,
  };
  AUTHORIZATION_RUNTIME_BY_STATE.set(state, runtime);
  return runtime;
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

function cloneEvaluation(evaluation: ExposurePlanEvaluation): ExposurePlanEvaluation {
  return {
    ...evaluation,
    initial_state: cloneState(evaluation.initial_state),
    final_state: cloneState(evaluation.final_state),
    diagnostic_projection: {
      ...evaluation.diagnostic_projection,
      projected_final_state: evaluation.diagnostic_projection.projected_final_state
        ? cloneState(evaluation.diagnostic_projection.projected_final_state)
        : null,
      intermediate_states: evaluation.diagnostic_projection.intermediate_states.map(cloneState),
      violations: evaluation.diagnostic_projection.violations.map((violation) => ({
        ...violation,
        before: cloneState(violation.before),
        after: cloneState(violation.after),
      })),
    },
    intermediate_states: evaluation.intermediate_states.map(cloneState),
    violations: evaluation.violations.map((violation) => ({
      ...violation,
      before: cloneState(violation.before),
      after: cloneState(violation.after),
    })),
    resource_requirements: { ...evaluation.resource_requirements },
    original_steps: evaluation.original_steps.map((step) => ({ ...step })),
    execution_preconditions: [...evaluation.execution_preconditions],
    real_transaction_preconditions: [...evaluation.real_transaction_preconditions],
  };
}

function serializeBigInts<T>(value: T): T {
  if (typeof value === "bigint") return value.toString() as T;
  if (Array.isArray(value)) return value.map((item) => serializeBigInts(item)) as T;
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = serializeBigInts(item);
    }
    return result as T;
  }
  return value;
}

function cloneSource(source: ExposureReservationSource): ExposureReservationSource {
  return { ...source };
}

function sourceSummary(source: ExposureReservationSource, mode: ExposureMode, chainId?: number) {
  return {
    mode,
    provenance: source.provenance,
    qualification: source.qualified ? "QUALIFIED" : "BLOCKED",
    evaluation_ref: source.evaluation_ref,
    graph_hash: source.graph_hash,
    chain_id: chainId ?? null,
  };
}

function cookieValue(headers: OperatorRequestHeaders): string | null {
  const raw = headers.cookie;
  if (typeof raw !== "string") return null;
  for (const item of raw.split(";")) {
    const parts = item.trim().split("=");
    const name = parts.shift();
    if (name === OPERATOR_SESSION_COOKIE_NAME) return parts.join("=") || null;
  }
  return null;
}

export function getExposureOperatorCookieToken(headers: OperatorRequestHeaders): string | null {
  return cookieValue(headers);
}

function headerValue(headers: OperatorRequestHeaders, name: string): string | null {
  const value = headers[name.toLowerCase()];
  return typeof value === "string" ? value : null;
}

function boundaryOrigin(config: ExposurePlanOperatorBoundaryConfig): string {
  return config.allowed_origin ?? DEFAULT_OPERATOR_ORIGIN;
}

function boundaryHost(config: ExposurePlanOperatorBoundaryConfig): string {
  if (config.allowed_host) return config.allowed_host.toLowerCase();
  try {
    return new URL(boundaryOrigin(config)).host.toLowerCase();
  } catch {
    return "127.0.0.1:8787";
  }
}

function cookieHeader(token: string, ttlMs: number): string {
  return OPERATOR_SESSION_COOKIE_NAME
    + "=" + token
    + "; Max-Age=" + Math.max(1, Math.ceil(ttlMs / 1000))
    + "; Path=/; HttpOnly; SameSite=Strict";
}

function publicSession(record: OperatorSessionRecord): ExposurePlanOperatorSession {
  return {
    session_id: record.session_id,
    csrf_token: record.csrf_token,
    runtime_generation: record.runtime_generation,
    policy_version: record.policy_version,
    mode: record.mode,
    expires_at: record.expires_at,
  };
}

function pruneOperatorSessions(
  authorization: ExposurePlanAuthorizationRuntime,
  nowMs: number,
): void {
  for (const [token, session] of authorization.sessions) {
    if (session.expires_at_ms <= nowMs) authorization.sessions.delete(token);
  }
  while (authorization.sessions.size >= authorization.max_sessions) {
    const oldest = authorization.sessions.keys().next().value as string | undefined;
    if (!oldest) break;
    authorization.sessions.delete(oldest);
  }
}

function pruneAcceptedPlans(
  state: ExposureRuntimeState,
  authorization: ExposurePlanAuthorizationRuntime,
): void {
  if (authorization.accepted_plans.size < authorization.max_accepted_plans) return;
  for (const [reservationId] of authorization.accepted_plans) {
    if (!getExposureReservationExecutionView(runtimeOf(state), reservationId)) {
      authorization.accepted_plans.delete(reservationId);
    }
    if (authorization.accepted_plans.size < authorization.max_accepted_plans) return;
  }
}

function newOpaque(prefix: string): string {
  return prefix + "_" + randomUUID().replaceAll("-", "");
}

function syncNewSessionContext(
  state: ExposureRuntimeState,
  session: ExposurePlanOperatorSession,
): void {
  const runtime = state.reservation_runtime;
  const authorization = getExposurePlanAuthorizationRuntime(state);
  const hadDifferentSession = runtime.session_id !== session.session_id
    || runtime.mode !== OPERATOR_SESSION_MODE
    || runtime.runtime_generation !== session.runtime_generation;
  if (hadDifferentSession) {
    const previousPaperBase = authorization.paper_overlay?.base_state;
    const snapshot: ExposureReservationSourceSnapshot = {
      state: cloneState(previousPaperBase ?? runtime.base_state),
      source: { ...runtime.source },
      session_id: session.session_id,
      mode: OPERATOR_SESSION_MODE,
      runtime_generation: session.runtime_generation,
    };
    updateExposureReservationSource(runtime, snapshot);
    authorization.paper_overlay = null;
    authorization.session_source_provenance = null;
  }
}

export function createExposurePlanOperatorSession(
  state: ExposureRuntimeState,
  options: {
    cookie_token?: string;
    now?: Date;
    boundary?: ExposurePlanOperatorBoundaryConfig;
    force_new?: boolean;
  } = {},
): { session: ExposurePlanOperatorSession; cookie: string; set_cookie: string } {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const authorization = getExposurePlanAuthorizationRuntime(state);
  const ttlMs = safePositiveInteger(options.boundary?.session_ttl_ms, DEFAULT_OPERATOR_SESSION_TTL_MS);
  const recoveryWindowMs = boundedPositiveInteger(
    options.boundary?.recovery_window_ms,
    DEFAULT_OPERATOR_RECOVERY_WINDOW_MS,
    MAX_OPERATOR_RECOVERY_WINDOW_MS,
  );
  const recoveryExpiresAtMs = nowMs + ttlMs + recoveryWindowMs;
  authorization.max_sessions = safePositiveInteger(options.boundary?.max_sessions, authorization.max_sessions);
  pruneOperatorSessions(authorization, nowMs);
  const requestedToken = options.cookie_token;
  const existing = requestedToken ? authorization.sessions.get(requestedToken) : undefined;
  if (!options.force_new && existing && existing.expires_at_ms > nowMs
      && existing.runtime_generation === state.reservation_runtime.runtime_generation
      && existing.session_id === state.reservation_runtime.session_id
      && state.reservation_runtime.mode === OPERATOR_SESSION_MODE) {
    return {
      session: publicSession(existing),
      cookie: OPERATOR_SESSION_COOKIE_NAME + "=" + existing.cookie_token,
      set_cookie: "",
    };
  }

  const cookieToken = newOpaque("cookie");
  const recoveryCsrfToken = newOpaque("recovery_csrf");
  const session: ExposurePlanOperatorSession = {
    session_id: newOpaque("session"),
    csrf_token: newOpaque("csrf"),
    runtime_generation: state.reservation_runtime.runtime_generation,
    policy_version: state.reservation_runtime.policy.policy_version,
    mode: OPERATOR_SESSION_MODE,
    expires_at: new Date(nowMs + ttlMs).toISOString(),
  };
  const record: OperatorSessionRecord = {
    ...session,
    cookie_token: cookieToken,
    expires_at_ms: nowMs + ttlMs,
    recovery_csrf_token: recoveryCsrfToken,
    recovery_expires_at_ms: recoveryExpiresAtMs,
  };
  authorization.sessions.set(cookieToken, record);
  syncNewSessionContext(state, session);
  return {
    session,
    cookie: OPERATOR_SESSION_COOKIE_NAME + "=" + cookieToken,
    set_cookie: cookieHeader(cookieToken, recoveryExpiresAtMs - nowMs),
  };
}

function sessionRecordForId(
  authorization: ExposurePlanAuthorizationRuntime,
  sessionId: string,
): OperatorSessionRecord | null {
  for (const record of authorization.sessions.values()) {
    if (record.session_id === sessionId) return record;
  }
  return null;
}

function activeOperatorContext(
  state: ExposureRuntimeState,
  nowMs: number,
): boolean {
  const authorization = getExposurePlanAuthorizationRuntime(state);
  const hasLiveSession = [...authorization.sessions.values()].some((session) => session.expires_at_ms > nowMs);
  return hasLiveSession
    || authorization.paper_overlay !== null
    || getActiveExposureReservationDeltas(runtimeOf(state)).length > 0;
}

export function authorizeExposureOperatorBootstrap(
  state: ExposureRuntimeState,
  headers: OperatorRequestHeaders,
  options: { now?: Date; boundary?: ExposurePlanOperatorBoundaryConfig } = {},
): { ok: true; cookie_token: string | null } | { ok: false; statusCode: number; payload: Record<string, unknown> } {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const config = options.boundary ?? {};
  if (!isExposureOperatorHostAllowed(headers, config)) {
    return { ok: false, statusCode: 403, payload: { error: "operator_host_rejected" } };
  }
  const origin = headerValue(headers, "origin");
  if (origin !== null && origin !== boundaryOrigin(config)) {
    return { ok: false, statusCode: 403, payload: { error: "operator_origin_rejected" } };
  }
  const fetchSite = headerValue(headers, "sec-fetch-site")?.toLowerCase();
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return { ok: false, statusCode: 403, payload: { error: "operator_fetch_site_rejected" } };
  }
  const token = cookieValue(headers);
  const authorization = getExposurePlanAuthorizationRuntime(state);
  if (token) {
    const session = authorization.sessions.get(token);
    if (!session) return { ok: false, statusCode: 401, payload: { error: "operator_session_invalid" } };
    if (session.expires_at_ms <= nowMs) {
      return { ok: false, statusCode: 401, payload: { error: "operator_session_expired" } };
    }
    if (session.session_id !== state.reservation_runtime.session_id
        || session.runtime_generation !== state.reservation_runtime.runtime_generation
        || state.reservation_runtime.mode !== OPERATOR_SESSION_MODE) {
      return { ok: false, statusCode: 403, payload: { error: "operator_session_stale" } };
    }
    return { ok: true, cookie_token: token };
  }
  if (activeOperatorContext(state, nowMs)) {
    return { ok: false, statusCode: 401, payload: { error: "operator_session_required" } };
  }
  return { ok: true, cookie_token: null };
}

type ExposureOperatorRecoveryContextResult =
  | { ok: true; record: OperatorSessionRecord }
  | { ok: false; statusCode: number; payload: Record<string, unknown> };

function authorizeExposureOperatorRecoveryContext(
  state: ExposureRuntimeState,
  headers: OperatorRequestHeaders,
  options: { now?: Date; boundary?: ExposurePlanOperatorBoundaryConfig; require_origin?: boolean } = {},
): ExposureOperatorRecoveryContextResult {
  const nowMs = (options.now ?? new Date()).getTime();
  const config = options.boundary ?? {};
  const origin = headerValue(headers, "origin");
  const host = headerValue(headers, "host");
  if (options.require_origin !== false && origin !== boundaryOrigin(config)) {
    return { ok: false, statusCode: 403, payload: { error: "operator_origin_rejected" } };
  }
  if (options.require_origin === false && origin !== null && origin !== boundaryOrigin(config)) {
    return { ok: false, statusCode: 403, payload: { error: "operator_origin_rejected" } };
  }
  if (!host || host.toLowerCase() !== boundaryHost(config)) {
    return { ok: false, statusCode: 403, payload: { error: "operator_host_rejected" } };
  }
  const fetchSite = headerValue(headers, "sec-fetch-site")?.toLowerCase();
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return { ok: false, statusCode: 403, payload: { error: "operator_fetch_site_rejected" } };
  }
  const token = cookieValue(headers);
  if (!token) return { ok: false, statusCode: 401, payload: { error: "operator_session_required" } };
  const authorization = getExposurePlanAuthorizationRuntime(state);
  const record = authorization.sessions.get(token);
  if (!record) return { ok: false, statusCode: 401, payload: { error: "operator_session_invalid" } };
  if (record.session_id !== state.reservation_runtime.session_id
      || record.runtime_generation !== state.reservation_runtime.runtime_generation
      || state.reservation_runtime.mode !== OPERATOR_SESSION_MODE) {
    return { ok: false, statusCode: 403, payload: { error: "operator_session_stale" } };
  }
  if (record.expires_at_ms > nowMs) {
    return { ok: false, statusCode: 409, payload: { error: "operator_recovery_requires_expired_session" } };
  }
  if (record.recovery_expires_at_ms <= nowMs) {
    return { ok: false, statusCode: 401, payload: { error: "operator_recovery_window_expired" } };
  }
  return { ok: true, record };
}

function recoveryChallenge(record: OperatorSessionRecord): ExposurePlanOperatorRecoveryChallenge {
  return {
    status: "recovery_required",
    session_id: record.session_id,
    runtime_generation: record.runtime_generation,
    policy_version: record.policy_version,
    mode: record.mode,
    recovery_csrf_token: record.recovery_csrf_token,
    recovery_expires_at: new Date(record.recovery_expires_at_ms).toISOString(),
  };
}

export function getExposureOperatorRecoveryChallenge(
  state: ExposureRuntimeState,
  headers: OperatorRequestHeaders,
  options: { now?: Date; boundary?: ExposurePlanOperatorBoundaryConfig } = {},
): { ok: true; challenge: ExposurePlanOperatorRecoveryChallenge } | { ok: false; statusCode: number; payload: Record<string, unknown> } {
  const authorized = authorizeExposureOperatorRecoveryContext(state, headers, { ...options, require_origin: false });
  if (!authorized.ok) return authorized;
  return { ok: true, challenge: recoveryChallenge(authorized.record) };
}

export function authorizeExposureOperatorRecovery(
  state: ExposureRuntimeState,
  headers: OperatorRequestHeaders,
  options: { now?: Date; boundary?: ExposurePlanOperatorBoundaryConfig } = {},
): { ok: true; session: ExposurePlanOperatorSession } | { ok: false; statusCode: number; payload: Record<string, unknown> } {
  const authorized = authorizeExposureOperatorRecoveryContext(state, headers, options);
  if (!authorized.ok) return authorized;
  if (headerValue(headers, "x-sentinel-recovery-csrf") !== authorized.record.recovery_csrf_token) {
    return { ok: false, statusCode: 403, payload: { error: "operator_recovery_csrf_rejected" } };
  }
  return { ok: true, session: publicSession(authorized.record) };
}

export function resetExposurePlanOperatorSession(
  state: ExposureRuntimeState,
  session: ExposurePlanOperatorSession,
  options: { now?: Date; boundary?: ExposurePlanOperatorBoundaryConfig } = {},
): { session: ExposurePlanOperatorSession; cookie: string; set_cookie: string } | null {
  const authorization = getExposurePlanAuthorizationRuntime(state);
  const currentToken = [...authorization.sessions.entries()]
    .find(([, record]) => record.session_id === session.session_id)?.[0];
  if (!currentToken) return null;
  return createExposurePlanOperatorSession(state, {
    cookie_token: currentToken,
    force_new: true,
    now: options.now,
    boundary: options.boundary,
  });
}

export function authorizeExposureOperatorMutation(
  state: ExposureRuntimeState,
  headers: OperatorRequestHeaders,
  options: { now?: Date; boundary?: ExposurePlanOperatorBoundaryConfig } = {},
): { ok: true; session: ExposurePlanOperatorSession } | { ok: false; statusCode: number; payload: Record<string, unknown> } {
  const nowMs = (options.now ?? new Date()).getTime();
  const origin = headerValue(headers, "origin");
  const host = headerValue(headers, "host");
  const config = options.boundary ?? {};
  if (origin !== boundaryOrigin(config)) {
    return { ok: false, statusCode: 403, payload: { error: "operator_origin_rejected" } };
  }
  if (!host || host.toLowerCase() !== boundaryHost(config)) {
    return { ok: false, statusCode: 403, payload: { error: "operator_host_rejected" } };
  }
  const token = cookieValue(headers);
  if (!token) return { ok: false, statusCode: 401, payload: { error: "operator_session_required" } };
  const authorization = getExposurePlanAuthorizationRuntime(state);
  const session = authorization.sessions.get(token);
  if (!session) return { ok: false, statusCode: 401, payload: { error: "operator_session_invalid" } };
  if (session.expires_at_ms <= nowMs) {
    return { ok: false, statusCode: 401, payload: { error: "operator_session_expired" } };
  }
  if (session.session_id !== state.reservation_runtime.session_id
      || session.runtime_generation !== state.reservation_runtime.runtime_generation
      || state.reservation_runtime.mode !== OPERATOR_SESSION_MODE) {
    return { ok: false, statusCode: 403, payload: { error: "operator_session_stale" } };
  }
  if (headerValue(headers, "x-sentinel-csrf") !== session.csrf_token) {
    return { ok: false, statusCode: 403, payload: { error: "operator_csrf_rejected" } };
  }
  return { ok: true, session: publicSession(session) };
}

export function isExposureOperatorHostAllowed(
  headers: OperatorRequestHeaders,
  config: ExposurePlanOperatorBoundaryConfig = {},
): boolean {
  const host = headerValue(headers, "host");
  return Boolean(host && host.toLowerCase() === boundaryHost(config));
}

function isSameState(left: ExposureAccountingState, right: ExposureAccountingState): boolean {
  return left.direct_available_raw === right.direct_available_raw
    && left.aave_exposure_raw === right.aave_exposure_raw
    && left.total_exposure_raw === right.total_exposure_raw
    && left.debt_raw === right.debt_raw
    && left.dependency_cap_raw === right.dependency_cap_raw
    && left.aave_cap_raw === right.aave_cap_raw;
}

function sourceFromEvaluation(
  evaluationRef: string,
  evaluation: ExposureEvaluation,
): { ok: true; state: ExposureAccountingState; source: ExposureReservationSource; account: string; chain_id: number } | { ok: false; code: string; details: string[] } {
  if (evaluation.mode === "replay" || evaluation.graph.source_status !== "ok") {
    return { ok: false, code: "SOURCE_UNAVAILABLE", details: ["source_not_qualified"] };
  }
  const derived = deriveExposurePlanAccountingState(evaluation, DEFAULT_EXPOSURE_PLAN_POLICY);
  if (!derived.ok) return { ok: false, code: "SOURCE_UNAVAILABLE", details: derived.reason_codes };
  const account = evaluation.graph.subject.account.toLowerCase();
  if (!ACCOUNT_PATTERN.test(account) || evaluation.graph.subject.chain_id !== 8453) {
    return { ok: false, code: "SOURCE_UNAVAILABLE", details: ["server_source_identity_invalid"] };
  }
  return {
    ok: true,
    state: derived.state,
    source: {
      evaluation_ref: evaluationRef,
      graph_hash: evaluation.graph.graph_hash,
      provenance: exposurePlanSourceProvenance(evaluation.mode),
      qualified: true,
      account,
      chain_id: evaluation.graph.subject.chain_id,
    },
    account,
    chain_id: evaluation.graph.subject.chain_id,
  };
}

export function buildExposurePlanRefreshSnapshot(
  evaluationRef: string,
  evaluation: ExposureEvaluation,
  context: { session_id?: string; runtime_generation?: string; mode?: ExposureReservationSessionMode } = {},
): ExposurePlanRefreshResult {
  const derived = sourceFromEvaluation(evaluationRef, evaluation);
  if (!derived.ok) return { status: "blocked", code: "SOURCE_UNAVAILABLE" };
  return {
    status: "ok",
    snapshot: {
      state: derived.state,
      source: derived.source,
      session_id: context.session_id ?? "unbound_session",
      mode: context.mode ?? OPERATOR_SESSION_MODE,
      runtime_generation: context.runtime_generation ?? "unbound_generation",
    },
  };
}

function acceptedPlanRecord(
  state: ExposureRuntimeState,
  reservationId: string,
): AcceptedPlanRecord | null {
  return getExposurePlanAuthorizationRuntime(state).accepted_plans.get(reservationId) ?? null;
}

export type ExposurePlanImpactAcceptedPlan = {
  plan: ExposurePlanV1;
  plan_hash: string;
  original: {
    policy_status: ExposurePlanEvaluation["policy_status"];
    goal_status: ExposurePlanEvaluation["goal_status"];
    paper_eligibility: ExposurePlanEvaluation["paper_eligibility"];
  };
  reservation_id: string;
  reservation_state: string;
  permit_check_id: string | null;
};

/**
 * Return only analysis-safe accepted-plan metadata for the Task 5 fork.
 * Account, cookies, credentials and signed permit material stay in the
 * authorization runtime and are never copied into the simulation response.
 */
export function getExposurePlanImpactAcceptedPlans(
  state: ExposureRuntimeState,
  evaluationRef: string,
): ExposurePlanImpactAcceptedPlan[] {
  const authorization = getExposurePlanAuthorizationRuntime(state);
  const plans: ExposurePlanImpactAcceptedPlan[] = [];
  for (const record of authorization.accepted_plans.values()) {
    if (record.source.evaluation_ref !== evaluationRef) continue;
    const view = getExposureReservationExecutionView(runtimeOf(state), record.reservation_id);
    if (!view) continue;
    plans.push({
      plan: clonePlan(record.plan),
      plan_hash: view.reservation.plan_hash,
      original: {
        policy_status: record.evaluation.policy_status,
        goal_status: record.evaluation.goal_status,
        paper_eligibility: record.evaluation.paper_eligibility,
      },
      reservation_id: record.reservation_id,
      reservation_state: view.reservation.state,
      // The current operator runtime does not persist permit-check receipts.
      // Keep the absence explicit instead of deriving a historical check from
      // the reservation identifier.
      permit_check_id: null,
    });
  }
  return plans;
}

export function acceptExposurePlanForOperator(
  state: ExposureRuntimeState,
  session: ExposurePlanOperatorSession,
  request: { evaluation_ref: string; plan: unknown; idempotency_key: string; accept_partial: boolean },
  options: { now?: Date } = {},
): { statusCode: number; payload: Record<string, unknown> } {
  if (!EVALUATION_REFERENCE_PATTERN.test(request.evaluation_ref)) {
    return { statusCode: 400, payload: { error: "invalid_evaluation_reference" } };
  }
  const planValidation = validateExposurePlan(request.plan);
  if (!planValidation.ok
      || typeof request.idempotency_key !== "string"
      || request.idempotency_key.length === 0
      || request.idempotency_key.length > 128
      || typeof request.accept_partial !== "boolean") {
    return { statusCode: 400, payload: { error: "invalid_plan_acceptance_request" } };
  }
  const now = options.now ?? new Date();
  const stored = state.evaluations.get(request.evaluation_ref);
  if (!stored) return { statusCode: 400, payload: { error: "invalid_evaluation_reference" } };
  if (stored.expires_at_ms <= now.getTime()) return { statusCode: 410, payload: { error: "expired_evaluation_reference" } };
  const source = sourceFromEvaluation(request.evaluation_ref, stored.evaluation);
  if (!source.ok) return { statusCode: 503, payload: { error: source.code, details: source.details } };

  const authorization = getExposurePlanAuthorizationRuntime(state);
  if (authorization.paper_overlay && !isSameState(source.state, authorization.paper_overlay.base_state)) {
    return { statusCode: 409, payload: { status: "rejected", code: "PAPER_SESSION_REBASE_REQUIRED" } };
  }
  if (authorization.session_source_provenance !== null
      && authorization.session_source_provenance !== source.source.provenance) {
    return {
      statusCode: 409,
      payload: {
        status: "rejected",
        code: "SOURCE_PROVENANCE_MISMATCH",
        details: ["operator_session_provenance_changed"],
      },
    };
  }
  const runtime = state.reservation_runtime;
  if (runtime.account_scope !== "server-owned"
      && ACCOUNT_PATTERN.test(runtime.account_scope)
      && runtime.account_scope.toLowerCase() !== source.account) {
    return { statusCode: 409, payload: { error: "SOURCE_ACCOUNT_CHANGED" } };
  }
  runtime.account_scope = source.account;
  runtime.paper_session_eligible = true;
  updateExposureReservationSource(runtime, {
    state: source.state,
    source: source.source,
    session_id: session.session_id,
    mode: OPERATOR_SESSION_MODE,
    runtime_generation: session.runtime_generation,
  });
  if (authorization.paper_overlay) runtime.base_state = cloneState(authorization.paper_overlay.effective_state);
  const result = acceptExposurePlan(planValidation.plan, runtime, {
    evaluation_ref: request.evaluation_ref,
    graph_hash: source.source.graph_hash,
    idempotency_key: request.idempotency_key,
    accept_partial: request.accept_partial,
    session_id: session.session_id,
    mode: OPERATOR_SESSION_MODE,
    runtime_generation: session.runtime_generation,
    now,
  });
  const responseSource = sourceSummary(source.source, stored.evaluation.mode, source.chain_id);
  if (result.status !== "accepted_reserved") {
    return {
      statusCode: result.code === "SOURCE_UNAVAILABLE" ? 503 : 409,
      payload: {
        status: "rejected",
        code: result.code,
        details: result.details,
        ...(result.evaluation ? { evaluation: serializeBigInts(result.evaluation) } : {}),
        source: responseSource,
      },
    };
  }
  pruneAcceptedPlans(state, authorization);
  if (!authorization.accepted_plans.has(result.reservation.reservation_id)) {
    authorization.accepted_plans.set(result.reservation.reservation_id, {
      reservation_id: result.reservation.reservation_id,
      plan: clonePlan(planValidation.plan),
      evaluation: cloneEvaluation(result.evaluation),
      source: cloneSource(source.source),
      account: source.account,
      chain_id: source.chain_id,
      accept_partial: request.accept_partial,
    });
  }
  authorization.session_source_provenance = source.source.provenance;
  return {
    statusCode: 200,
    payload: {
      status: result.status,
      idempotent: result.idempotent === true,
      reservation: result.reservation,
      evaluation: serializeBigInts(result.evaluation),
      source: responseSource,
    },
  };
}

function currentReservationError(
  state: ExposureRuntimeState,
  reservationId: string,
): { statusCode: number; payload: Record<string, unknown> } | null {
  const view = getExposureReservationExecutionView(runtimeOf(state), reservationId);
  if (!view) return { statusCode: 404, payload: { status: "rejected", code: "RESERVATION_NOT_FOUND" } };
  return null;
}

function permitNonce(): string {
  return BigInt("0x" + randomUUID().replaceAll("-", "")).toString();
}

export function issueExposurePlanPermitForReservation(
  state: ExposureRuntimeState,
  session: ExposurePlanOperatorSession,
  request: { reservation_id: string; session_id: string; mode: "live" | "what_if" },
  options: { now?: Date } = {},
): { statusCode: number; payload: Record<string, unknown> } {
  if (request.mode === "what_if") {
    return { statusCode: 409, payload: { status: "rejected", code: "SIMULATION_NOT_EXECUTABLE" } };
  }
  if (request.mode !== "live" || request.session_id !== session.session_id) {
    return { statusCode: 409, payload: { status: "rejected", code: "SESSION_CONTEXT_MISMATCH" } };
  }
  const now = options.now ?? new Date();
  expireExposureReservations(runtimeOf(state), now);
  const currentError = currentReservationError(state, request.reservation_id);
  if (currentError) return currentError;
  const view = getExposureReservationExecutionView(runtimeOf(state), request.reservation_id)!;
  if (view.reservation.session_id !== session.session_id
      || view.reservation.runtime_generation !== session.runtime_generation) {
    return { statusCode: 409, payload: { status: "rejected", code: "RUNTIME_RESTART_INVALIDATED" } };
  }
  if (view.reservation.state !== "accepted_reserved") {
    return { statusCode: 409, payload: { status: "rejected", code: "RESERVATION_NOT_ACTIVE" } };
  }
  const accepted = acceptedPlanRecord(state, request.reservation_id);
  if (!accepted) return { statusCode: 409, payload: { status: "rejected", code: "RESERVATION_NOT_FOUND" } };
  if (view.reservation.source_provenance !== accepted.source.provenance) {
    return { statusCode: 409, payload: { status: "rejected", code: "SOURCE_PROVENANCE_MISMATCH" } };
  }
  const issued = issueExposurePlanPermit({
    plan_hash: view.reservation.plan_hash,
    agent_id: view.reservation.agent_id,
    account: accepted.account,
    policy_version: view.reservation.policy_version,
    evidence_ref: view.reservation.evidence_ref,
    graph_hash: view.reservation.graph_hash,
    reservation_id: view.reservation.reservation_id,
    session_id: session.session_id,
    mode: request.mode,
    source_provenance: view.reservation.source_provenance,
    runtime_generation: session.runtime_generation,
    now,
    nonce: permitNonce(),
  });
  if (issued.status !== "issued") return { statusCode: 409, payload: { status: "rejected", code: "PERMIT_ISSUANCE_BLOCKED" } };
  return { statusCode: 200, payload: { status: "issued", permit: issued.permit } };
}

function executionRejected(
  permitHash: string,
  nonce: string,
  code: string,
  details: string[] = [],
): ExposurePlanExecutionResult {
  return { status: "rejected", code, details, permit_hash: permitHash, nonce };
}

function executionNow(request: ExposurePlanExecutionRequest): Date {
  return request.clock?.() ?? request.now ?? new Date();
}

function operatorSessionValidity(
  state: ExposureRuntimeState,
  sessionId: string,
  nowMs: number,
): "valid" | "expired" | "missing" | "stale" {
  const runtime = state.reservation_runtime;
  const record = sessionRecordForId(getExposurePlanAuthorizationRuntime(state), sessionId);
  if (!record) return "missing";
  if (record.expires_at_ms <= nowMs) return "expired";
  if (record.session_id !== runtime.session_id
      || record.runtime_generation !== runtime.runtime_generation
      || runtime.mode !== OPERATOR_SESSION_MODE) {
    return "stale";
  }
  return "valid";
}

function runtimeVersion(state: ExposureRuntimeState, reservationVersion: number, paperRevision: number) {
  const runtime = state.reservation_runtime;
  return {
    runtime_generation: runtime.runtime_generation,
    session_id: runtime.session_id,
    mode: runtime.mode,
    state_revision: runtime.state_revision,
    source_revision: runtime.source_revision,
    reservation_revision: runtime.reservation_revision,
    reservation_version: reservationVersion,
    paper_revision: paperRevision,
  };
}

function sameRuntimeVersion(
  state: ExposureRuntimeState,
  expected: ReturnType<typeof runtimeVersion>,
  reservationId: string,
): boolean {
  const current = getExposureReservationExecutionView(runtimeOf(state), reservationId);
  if (!current) return false;
  const authorization = getExposurePlanAuthorizationRuntime(state);
  const actual = runtimeVersion(state, current.version, authorization.paper_overlay?.state_revision ?? 0);
  return Object.entries(expected).every(([key, value]) => actual[key as keyof typeof actual] === value);
}

function serializeOverlay(overlay: ExposurePaperOverlay | null): unknown {
  if (!overlay) return null;
  const serialized = serializeBigInts(overlay) as { base_source: Record<string, unknown> };
  delete serialized.base_source.account;
  return serialized;
}

export async function executeExposurePlanReservation(
  state: ExposureRuntimeState,
  request: ExposurePlanExecutionRequest,
  refresh: () => Promise<ExposurePlanRefreshResult>,
): Promise<ExposurePlanExecutionResult> {
  const initialNow = executionNow(request);
  const verification = verifyExposurePlanPermit({ permit: request.permit, now: initialNow });
  const permitHash = verification.permit_hash || request.permit.permit_hash || "";
  const nonce = request.permit.payload?.nonce ?? "";
  if (request.mode === "what_if" || request.permit.payload?.mode === "what_if") {
    return executionRejected(permitHash, nonce, "SIMULATION_NOT_EXECUTABLE");
  }
  if (!verification.cryptographically_valid) return executionRejected(permitHash, nonce, verification.code);
  const runtime = state.reservation_runtime;
  const authorization = getExposurePlanAuthorizationRuntime(state);
  if (request.session_id !== runtime.session_id || request.permit.payload.session_id !== runtime.session_id) {
    return executionRejected(permitHash, nonce, "SESSION_CONTEXT_MISMATCH");
  }
  if (request.permit.payload.runtime_generation !== runtime.runtime_generation) {
    return executionRejected(permitHash, nonce, "RUNTIME_RESTART_INVALIDATED");
  }
  const initialSessionValidity = operatorSessionValidity(state, request.session_id, initialNow.getTime());
  if (initialSessionValidity === "expired") return executionRejected(permitHash, nonce, "OPERATOR_SESSION_EXPIRED");
  if (initialSessionValidity !== "valid") return executionRejected(permitHash, nonce, "SESSION_CONTEXT_MISMATCH");
  if (authorization.consumed_nonces.has(nonce)) return executionRejected(permitHash, nonce, "NONCE_ALREADY_USED");
  let view = getExposureReservationExecutionView(runtimeOf(state), request.reservation_id);
  if (!view) return executionRejected(permitHash, nonce, "RESERVATION_NOT_FOUND");
  if (view.reservation.state !== "accepted_reserved") return executionRejected(permitHash, nonce, "RESERVATION_NOT_ACTIVE");
  const accepted = acceptedPlanRecord(state, request.reservation_id);
  if (!accepted) return executionRejected(permitHash, nonce, "RESERVATION_NOT_FOUND");
  if (
    request.permit.payload.reservation_id !== view.reservation.reservation_id
    || request.permit.payload.plan_hash !== view.reservation.plan_hash
    || request.permit.payload.agent_id !== view.reservation.agent_id
    || request.permit.payload.policy_version !== view.reservation.policy_version
    || request.permit.payload.evidence_ref !== view.reservation.evidence_ref
    || request.permit.payload.graph_hash !== view.reservation.graph_hash
    || request.permit.payload.source_provenance !== view.reservation.source_provenance
    || request.permit.payload.source_provenance !== accepted.source.provenance
  ) {
    return executionRejected(permitHash, nonce, "PERMIT_RESERVATION_BINDING_MISMATCH");
  }
  const expectedRuntime = runtimeVersion(state, view.version, authorization.paper_overlay?.state_revision ?? 0);
  let refreshed: ExposurePlanRefreshResult;
  try {
    refreshed = await refresh();
  } catch {
    return executionRejected(permitHash, nonce, "CURRENT_SOURCE_UNAVAILABLE", ["source_refresh_failed"]);
  }
  if (refreshed.status === "blocked") {
    return executionRejected(permitHash, nonce, "CURRENT_SOURCE_UNAVAILABLE", ["source_refresh_failed"]);
  }
  if (!sameRuntimeVersion(state, expectedRuntime, request.reservation_id)) {
    return executionRejected(permitHash, nonce, "STATE_CHANGED_REQUIRES_REEVALUATION", ["runtime_state_changed_during_refresh"]);
  }
  const snapshot = refreshed.snapshot;
  if (
    snapshot.runtime_generation !== runtime.runtime_generation
    || snapshot.session_id !== runtime.session_id
    || snapshot.mode !== OPERATOR_SESSION_MODE
    || !snapshot.source.qualified
  ) {
    return executionRejected(permitHash, nonce, "STATE_CHANGED_REQUIRES_REEVALUATION", ["refresh_context_changed"]);
  }
  if (!snapshot.source.account
      || snapshot.source.account.toLowerCase() !== accepted.account.toLowerCase()
      || snapshot.source.chain_id !== accepted.chain_id) {
    return executionRejected(permitHash, nonce, "CURRENT_SUBJECT_MISMATCH");
  }
  if (snapshot.source.provenance !== accepted.source.provenance
      || snapshot.source.provenance !== view.reservation.source_provenance
      || authorization.session_source_provenance !== snapshot.source.provenance
      || (authorization.paper_overlay !== null
        && authorization.paper_overlay.base_source.provenance !== snapshot.source.provenance)) {
    return executionRejected(permitHash, nonce, "SOURCE_PROVENANCE_MISMATCH", ["accepted_source_provenance_changed"]);
  }

  const commitNow = executionNow(request);
  const commitVerification = verifyExposurePlanPermit({ permit: request.permit, now: commitNow });
  if (!commitVerification.cryptographically_valid) {
    return executionRejected(permitHash, nonce, commitVerification.code);
  }
  const commitSessionValidity = operatorSessionValidity(state, request.session_id, commitNow.getTime());
  if (commitSessionValidity === "expired") return executionRejected(permitHash, nonce, "OPERATOR_SESSION_EXPIRED");
  if (commitSessionValidity !== "valid") return executionRejected(permitHash, nonce, "SESSION_CONTEXT_MISMATCH");
  expireExposureReservations(runtimeOf(state), commitNow);
  view = getExposureReservationExecutionView(runtimeOf(state), request.reservation_id);
  if (!view) return executionRejected(permitHash, nonce, "RESERVATION_NOT_FOUND");
  if (view.reservation.state === "expired") return executionRejected(permitHash, nonce, "RESERVATION_EXPIRED");
  if (view.reservation.state !== "accepted_reserved") return executionRejected(permitHash, nonce, "RESERVATION_NOT_ACTIVE");
  const overlay = authorization.paper_overlay;
  const baseline = overlay?.base_state ?? runtime.base_state;
  if (!isSameState(snapshot.state, baseline)) {
    return executionRejected(permitHash, nonce, "PAPER_SESSION_REBASE_REQUIRED", ["current_live_state_changed"]);
  }
  const effectiveInitial = overlay?.effective_state ?? snapshot.state;
  const activeReservations: ExposureReservationDelta[] = getActiveExposureReservationDeltas(runtimeOf(state), {
    exclude_reservation_id: request.reservation_id,
  });
  const currentEvaluation = evaluateExposurePlan(
    effectiveInitial,
    accepted.plan,
    runtime.policy,
    activeReservations,
    {
      source_provenance: snapshot.source.provenance,
      paper_session_eligible: runtime.paper_session_eligible,
      accept_partial: accepted.accept_partial,
    },
  );
  if (currentEvaluation.execution_mode !== "PAPER_AUTHORIZABLE") {
    const code = currentEvaluation.violations.some((item) => item.code.includes("cap") || item.code.includes("reserved"))
      ? "CURRENT_HEADROOM_INSUFFICIENT"
      : "CURRENT_PLAN_INELIGIBLE";
    return executionRejected(permitHash, nonce, code, currentEvaluation.execution_preconditions);
  }
  if (currentEvaluation.replay_completeness !== "COMPLETE") {
    return executionRejected(permitHash, nonce, "CURRENT_PLAN_INELIGIBLE", ["replay_incomplete"]);
  }
  const nextOverlay: ExposurePaperOverlay = {
    session_id: runtime.session_id,
    runtime_generation: runtime.runtime_generation,
    base_state: cloneState(snapshot.state),
    effective_state: cloneState(currentEvaluation.final_state),
    base_source: cloneSource(snapshot.source),
    state_revision: (overlay?.state_revision ?? 0) + 1,
    events: [
      ...(overlay?.events ?? []),
      {
        event_id: newOpaque("paper_event"),
        reservation_id: request.reservation_id,
        plan_hash: view.reservation.plan_hash,
        before_state: cloneState(effectiveInitial),
        after_state: cloneState(currentEvaluation.final_state),
        source_provenance: snapshot.source.provenance,
        created_at: commitNow.toISOString(),
      },
    ],
  };
  const committed = commitExposureReservationPaperExecution(
    runtimeOf(state),
    request.reservation_id,
    view.version,
    () => {
      authorization.paper_overlay = nextOverlay;
      authorization.consumed_nonces.add(nonce);
      runtime.base_state = cloneState(nextOverlay.effective_state);
      runtime.source = { ...snapshot.source };
      runtime.state_revision += 1;
      runtime.source_revision += 1;
    },
    { now: commitNow },
  );
  if (committed.status !== "paper_executed") return executionRejected(permitHash, nonce, committed.code, committed.details);
  return {
    status: "paper_executed",
    code: "PAPER_EXECUTED",
    permit_hash: permitHash,
    nonce,
    reservation: committed.reservation,
    overlay: serializeOverlay(authorization.paper_overlay),
  };
}

export function cancelExposurePlanReservation(
  state: ExposureRuntimeState,
  session: ExposurePlanOperatorSession,
  request: { reservation_id: string; reason: string },
  options: { now?: Date } = {},
): { statusCode: number; payload: Record<string, unknown> } {
  if (request.reason !== "operator_cancel") return { statusCode: 400, payload: { error: "invalid_cancel_reason" } };
  const now = options.now ?? new Date();
  expireExposureReservations(runtimeOf(state), now);
  const view = getExposureReservationExecutionView(runtimeOf(state), request.reservation_id);
  if (!view) return { statusCode: 404, payload: { status: "rejected", code: "RESERVATION_NOT_FOUND" } };
  if (view.reservation.session_id !== session.session_id
      || view.reservation.runtime_generation !== session.runtime_generation) {
    return { statusCode: 409, payload: { status: "rejected", code: "SESSION_CONTEXT_MISMATCH" } };
  }
  const result = cancelExposureReservation(request.reservation_id, runtimeOf(state), { now });
  if (result.status === "rejected") return { statusCode: 409, payload: result };
  return { statusCode: 200, payload: result };
}

export function verifyExposurePlanPermitForOperator(
  permit: unknown,
  now = new Date(),
): Record<string, unknown> {
  return verifyExposurePlanPermit({ permit, now }) as unknown as Record<string, unknown>;
}
