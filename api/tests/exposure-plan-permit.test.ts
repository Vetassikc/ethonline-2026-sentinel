import test from "node:test";
import assert from "node:assert/strict";

import type { ExposurePlanV1 } from "../../shared/schemas/exposure-plan.ts";
import {
  createExposureRuntimeState,
  getStoredExposureEvaluation,
} from "../app/exposure-service.ts";
import {
  buildExposurePlanRefreshSnapshot,
  createExposurePlanOperatorSession,
  executeExposurePlanReservation,
  getExposurePlanAuthorizationRuntime,
  issueExposurePlanPermitForReservation,
  type ExposurePlanRefreshResult,
} from "../app/exposure-plan-authorization.ts";
import {
  issueExposurePlanPermit,
  verifyExposurePlanPermit,
} from "../app/exposure-plan-permit.ts";
import {
  getExposureReservationCapacity,
  getExposureReservationExecutionView,
  updateExposureReservationSource,
  type ExposureReservationSourceSnapshot,
} from "../app/exposure-reservations.ts";
import { createJudgeModeServer, handleJudgeModeRequest } from "../app/server.ts";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const ORIGIN = "http://127.0.0.1:8787";
const HOST = "127.0.0.1:8787";

const PLAN: ExposurePlanV1 = {
  schema_version: "exposure_plan.v1",
  agent_id: "agent_a",
  goal: { kind: "acquire_up_to", target_units: "0.050000000000000000" },
  steps: [{ kind: "acquire_wsteth", units: "0.050000000000000000" }],
};

const SHARED_AGENT_A_PLAN: ExposurePlanV1 = {
  ...PLAN,
  goal: { kind: "acquire_up_to", target_units: "0.150000000000000000" },
  steps: [{ kind: "acquire_wsteth", units: "0.150000000000000000" }],
};

const SHARED_AGENT_B_PLAN: ExposurePlanV1 = {
  ...SHARED_AGENT_A_PLAN,
  agent_id: "agent_b",
};

const PARTIAL_PLAN: ExposurePlanV1 = {
  schema_version: "exposure_plan.v1",
  agent_id: "agent_a",
  goal: { kind: "supply_up_to", target_units: "0.300000000000000000" },
  steps: [
    { kind: "acquire_wsteth", units: "0.200000000000000000" },
    { kind: "supply_aave", units: "0.100000000000000000" },
  ],
};

function context(cookie: string, csrf: string, overrides: Record<string, string> = {}) {
  return {
    headers: {
      host: overrides.host ?? HOST,
      origin: overrides.origin ?? ORIGIN,
      cookie,
      "x-sentinel-csrf": csrf,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve; });
  return { promise, resolve };
}

function controlledClock(start = NOW) {
  let currentMs = start.getTime();
  return {
    now: () => new Date(currentMs),
    advance: (milliseconds: number) => { currentMs += milliseconds; },
  };
}

async function establish(
  state = createExposureRuntimeState(),
  options: { boundary?: Record<string, unknown> } = {},
) {
  const session = await handleJudgeModeRequest(
    "GET",
    "/api/exposure/operator/session",
    "",
    {
      exposureDependencies: { runtimeState: state, now: NOW },
      operatorBoundary: options.boundary as any,
    },
    { headers: { host: HOST } },
  );
  assert.equal(session.statusCode, 200);
  const payload = session.payload as Record<string, string>;
  const setCookie = session.headers?.["set-cookie"];
  assert.ok(setCookie);
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.match(cookie, /^sentinel_operator_session=[^;]+;/);
  return {
    state,
    payload,
    cookie: cookie.split(";", 1)[0],
    headers: context(cookie.split(";", 1)[0], payload.csrf_token),
  };
}

async function fixtureReference(state: ReturnType<typeof createExposureRuntimeState>) {
  const response = await handleJudgeModeRequest(
    "GET",
    "/api/exposure/plan/source/fixture",
    "",
    { exposureDependencies: { runtimeState: state, now: NOW } },
  );
  assert.equal(response.statusCode, 200);
  return (response.payload as { evaluation_ref: string }).evaluation_ref;
}

function refreshFor(state: ReturnType<typeof createExposureRuntimeState>, reference: string): () => Promise<ExposurePlanRefreshResult> {
  return async () => {
    const evaluation = getStoredExposureEvaluation(state, reference, NOW);
    assert.ok(evaluation);
    return buildExposurePlanRefreshSnapshot(reference, evaluation!, {
      session_id: state.reservation_runtime.session_id,
      runtime_generation: state.reservation_runtime.runtime_generation,
      mode: "live",
    });
  };
}

function snapshotFor(
  state: ReturnType<typeof createExposureRuntimeState>,
  reference: string,
  overrides: Partial<ExposureReservationSourceSnapshot> = {},
): ExposureReservationSourceSnapshot {
  const evaluation = getStoredExposureEvaluation(state, reference, NOW);
  assert.ok(evaluation);
  const result = buildExposurePlanRefreshSnapshot(reference, evaluation!, {
    session_id: state.reservation_runtime.session_id,
    runtime_generation: state.reservation_runtime.runtime_generation,
    mode: "live",
  });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") throw new Error("expected refresh snapshot");
  return {
    ...result.snapshot,
    ...overrides,
    source: { ...result.snapshot.source, ...(overrides.source ?? {}) },
  };
}

async function acceptAndIssuePermit(
  state: ReturnType<typeof createExposureRuntimeState>,
  reference: string,
  established: Awaited<ReturnType<typeof establish>>,
  plan: ExposurePlanV1,
  idempotencyKey: string,
) {
  const accepted = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan, idempotency_key: idempotencyKey, accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(accepted.statusCode, 200);
  const reservationId = (accepted.payload as { reservation: { reservation_id: string } }).reservation.reservation_id;
  const issued = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/permit",
    JSON.stringify({ reservation_id: reservationId, session_id: established.payload.session_id, mode: "live" }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(issued.statusCode, 200);
  return { reservationId, permit: (issued.payload as { permit: unknown }).permit };
}

test("plan permit is cryptographically plan-bound and verification stays separate from execution eligibility", () => {
  const issued = issueExposurePlanPermit({
    plan_hash: "a".repeat(64),
    agent_id: "agent_a",
    account: "0x0000000000000000000000000000000000000001",
    policy_version: "exposure-plan-wsteth-v1",
    evidence_ref: "exposure_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    graph_hash: "0x" + "11".repeat(32),
    reservation_id: "reservation_demo",
    session_id: "session_demo",
    mode: "live",
    runtime_generation: "generation_demo",
    source_provenance: "FIXTURE",
    now: NOW,
    nonce: "7",
  } as any);
  assert.equal(issued.status, "issued");
  if (issued.status !== "issued") throw new Error("expected plan permit");

  assert.equal(issued.permit.payload.source_provenance, "FIXTURE");

  const verified = verifyExposurePlanPermit({ permit: issued.permit, now: NOW });
  assert.equal(verified.cryptographically_valid, true);
  assert.equal(verified.current_execution_eligibility, "UNVERIFIED_UNTIL_FRESH_RECHECK");

  const tampered = structuredClone(issued.permit);
  tampered.payload.plan_hash = "b".repeat(64);
  const rejected = verifyExposurePlanPermit({ permit: tampered, now: NOW });
  assert.equal(rejected.cryptographically_valid, false);
  assert.equal(rejected.code, "PERMIT_PAYLOAD_MISMATCH");

  const malformed = structuredClone(issued.permit) as any;
  malformed.payload.policy_version = null;
  assert.equal(verifyExposurePlanPermit({ permit: malformed, now: NOW }).cryptographically_valid, false);
});

test("operator mutations require the server session, fixed origin/host and session CSRF before admission", async () => {
  const state = createExposureRuntimeState();
  const reference = await fixtureReference(state);
  const noSession = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PLAN, idempotency_key: "no-session", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    { headers: { host: HOST, origin: ORIGIN } },
  );
  assert.equal(noSession.statusCode, 401);
  assert.equal(state.reservation_runtime.reservations.size, 0);

  const established = await establish(state);
  for (const override of [
    { origin: "https://attacker.invalid" },
    { host: "attacker.invalid" },
  ]) {
    const rejected = await handleJudgeModeRequest(
      "POST",
      "/api/exposure/plan/accept",
      JSON.stringify({ evaluation_ref: reference, plan: PLAN, idempotency_key: `bad-${override.origin ?? override.host}`, accept_partial: false }),
      { exposureDependencies: { runtimeState: state, now: NOW } },
      context(established.cookie, established.payload.csrf_token, override),
    );
    assert.equal(rejected.statusCode, 403);
    assert.equal(state.reservation_runtime.reservations.size, 0);
  }

  const badCsrf = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PLAN, idempotency_key: "bad-csrf", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    context(established.cookie, "wrong-csrf"),
  );
  assert.equal(badCsrf.statusCode, 403);
  assert.equal(state.reservation_runtime.reservations.size, 0);

  const authorityInjection = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({
      evaluation_ref: reference,
      plan: PLAN,
      idempotency_key: "authority-injection",
      accept_partial: false,
      account: "0x0000000000000000000000000000000000000001",
    }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(authorityInjection.statusCode, 400);
  assert.equal(state.reservation_runtime.reservations.size, 0);
});

test("partial operator acceptance is explicit and idempotency remains server-bound", async () => {
  const state = createExposureRuntimeState();
  const reference = await fixtureReference(state);
  const established = await establish(state);

  const denied = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PARTIAL_PLAN, idempotency_key: "partial-denied", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(denied.statusCode, 409);
  assert.equal((denied.payload as { code: string }).code, "PARTIAL_ACCEPTANCE_REQUIRED");

  const accepted = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PARTIAL_PLAN, idempotency_key: "partial-ok", accept_partial: true }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(accepted.statusCode, 200);
  const acceptedPayload = accepted.payload as { status: string; reservation: { reservation_id: string; state: string } };
  assert.equal(acceptedPayload.status, "accepted_reserved");
  assert.equal(acceptedPayload.reservation.state, "accepted_reserved");

  const duplicate = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PARTIAL_PLAN, idempotency_key: "partial-ok", accept_partial: true }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(duplicate.statusCode, 200);
  assert.equal((duplicate.payload as { reservation: { reservation_id: string }; idempotent?: boolean }).reservation.reservation_id, acceptedPayload.reservation.reservation_id);
  assert.equal((duplicate.payload as { idempotent?: boolean }).idempotent, true);

  const conflict = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PLAN, idempotency_key: "partial-ok", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(conflict.statusCode, 409);
  assert.equal((conflict.payload as { code: string }).code, "IDEMPOTENCY_KEY_CONFLICT");
});

test("permit issuance and pure verification do not grant execution until the current reservation checks pass", async () => {
  const state = createExposureRuntimeState();
  const reference = await fixtureReference(state);
  const established = await establish(state);
  const accepted = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PLAN, idempotency_key: "permit-key", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(accepted.statusCode, 200);
  const reservationId = (accepted.payload as { reservation: { reservation_id: string } }).reservation.reservation_id;

  const issued = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/permit",
    JSON.stringify({ reservation_id: reservationId, session_id: established.payload.session_id, mode: "live" }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(issued.statusCode, 200);
  const permit = (issued.payload as { permit: unknown }).permit;

  const verified = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/verify",
    JSON.stringify({ permit, session_id: established.payload.session_id, mode: "live" }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(verified.statusCode, 200);
  assert.equal((verified.payload as { cryptographically_valid: boolean }).cryptographically_valid, true);
  assert.equal((verified.payload as { current_execution_eligibility: string }).current_execution_eligibility, "UNVERIFIED_UNTIL_FRESH_RECHECK");

  const cancelled = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/reservation/cancel",
    JSON.stringify({ reservation_id: reservationId, reason: "operator_cancel" }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(cancelled.statusCode, 200);

  const rejected = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/reservation/execute",
    JSON.stringify({ reservation_id: reservationId, permit, session_id: established.payload.session_id, mode: "live" }),
    { exposureDependencies: { runtimeState: state, now: NOW }, planRefresh: refreshFor(state, reference) },
    established.headers,
  );
  assert.equal(rejected.statusCode, 409);
  assert.equal((rejected.payload as { code: string }).code, "RESERVATION_NOT_ACTIVE");
  assert.equal(getExposurePlanAuthorizationRuntime(state).paper_overlay, null);
});

test("successful paper execution applies one overlay and rejects reuse of the same permit nonce", async () => {
  const state = createExposureRuntimeState();
  const reference = await fixtureReference(state);
  const established = await establish(state);
  const accepted = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PLAN, idempotency_key: "execute-key", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  const reservationId = (accepted.payload as { reservation: { reservation_id: string } }).reservation.reservation_id;
  const issued = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/permit",
    JSON.stringify({ reservation_id: reservationId, session_id: established.payload.session_id, mode: "live" }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  const permit = (issued.payload as { permit: unknown }).permit;
  const executionDependencies = {
    exposureDependencies: { runtimeState: state, now: NOW },
    planRefresh: refreshFor(state, reference),
  };

  const executed = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/reservation/execute",
    JSON.stringify({ reservation_id: reservationId, permit, session_id: established.payload.session_id, mode: "live" }),
    executionDependencies,
    established.headers,
  );
  assert.equal(executed.statusCode, 200);
  assert.equal((executed.payload as { code: string }).code, "PAPER_EXECUTED");
  assert.equal((executed.payload as { overlay: { effective_state: { total_exposure_raw: string } } }).overlay.effective_state.total_exposure_raw, "850000000000000000");

  const replayed = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/reservation/execute",
    JSON.stringify({ reservation_id: reservationId, permit, session_id: established.payload.session_id, mode: "live" }),
    executionDependencies,
    established.headers,
  );
  assert.equal(replayed.statusCode, 409);
  assert.equal((replayed.payload as { code: string }).code, "NONCE_ALREADY_USED");
  assert.equal(getExposurePlanAuthorizationRuntime(state).consumed_nonces.size, 1);
});

test("sequential paper executions apply the overlay once and keep exact effective state", async () => {
  const state = createExposureRuntimeState();
  const reference = await fixtureReference(state);
  const established = await establish(state);
  const first = await acceptAndIssuePermit(state, reference, established, PLAN, "overlay-first");

  const firstExecution = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/reservation/execute",
    JSON.stringify({ reservation_id: first.reservationId, permit: first.permit, session_id: established.payload.session_id, mode: "live" }),
    { exposureDependencies: { runtimeState: state, now: NOW }, planRefresh: refreshFor(state, reference) },
    established.headers,
  );
  assert.equal(firstExecution.statusCode, 200);
  assert.equal((firstExecution.payload as { code: string }).code, "PAPER_EXECUTED");
  const firstOverlay = (firstExecution.payload as { overlay: { effective_state: { total_exposure_raw: string }; base_source: Record<string, unknown> } }).overlay;
  assert.equal(firstOverlay.effective_state.total_exposure_raw, "850000000000000000");
  assert.equal("account" in firstOverlay.base_source, false);

  const second = await acceptAndIssuePermit(state, reference, established, PLAN, "overlay-second");
  const secondView = getExposureReservationExecutionView(state.reservation_runtime, second.reservationId);
  assert.ok(secondView);
  assert.equal(secondView?.evaluation.initial_state.total_exposure_raw, 850000000000000000n);

  const secondExecution = await executeExposurePlanReservation(
    state,
    {
      reservation_id: second.reservationId,
      permit: second.permit as any,
      session_id: established.payload.session_id,
      mode: "live",
      now: NOW,
    },
    refreshFor(state, reference),
  );
  assert.equal(secondExecution.code, "PAPER_EXECUTED");
  assert.equal(
    (secondExecution.overlay as { effective_state: { total_exposure_raw: string } }).effective_state.total_exposure_raw,
    "900000000000000000",
  );
});

test("state changes during awaited refresh reject execution without release or nonce consumption", async () => {
  const state = createExposureRuntimeState();
  const reference = await fixtureReference(state);
  const established = await establish(state);
  const accepted = await acceptAndIssuePermit(state, reference, established, PLAN, "state-refresh-race");
  const pending = deferred<ExposurePlanRefreshResult>();
  const execution = executeExposurePlanReservation(
    state,
    {
      reservation_id: accepted.reservationId,
      permit: accepted.permit as any,
      session_id: established.payload.session_id,
      mode: "live",
      now: NOW,
    },
    () => pending.promise,
  );

  const original = snapshotFor(state, reference);
  updateExposureReservationSource(state, {
    ...original,
    state: {
      ...original.state,
      direct_available_raw: original.state.direct_available_raw + 1n,
      total_exposure_raw: original.state.total_exposure_raw + 1n,
    },
  });
  pending.resolve({ status: "ok", snapshot: original });

  const result = await execution;
  assert.equal(result.code, "STATE_CHANGED_REQUIRES_REEVALUATION");
  const view = getExposureReservationExecutionView(state.reservation_runtime, accepted.reservationId);
  assert.equal(view?.reservation.state, "accepted_reserved");
  assert.equal(view?.reservation.capacity_release_event_id, null);
  assert.equal(getExposurePlanAuthorizationRuntime(state).paper_overlay, null);
  assert.equal(getExposurePlanAuthorizationRuntime(state).consumed_nonces.size, 0);
  assert.equal(getExposureReservationCapacity(state.reservation_runtime).active_reservation_count, 1);
});

test("refresh context changes fail closed without treating the permit as current", async () => {
  const state = createExposureRuntimeState();
  const reference = await fixtureReference(state);
  const established = await establish(state);
  const accepted = await acceptAndIssuePermit(state, reference, established, PLAN, "context-refresh-race");
  const result = await executeExposurePlanReservation(
    state,
    {
      reservation_id: accepted.reservationId,
      permit: accepted.permit as any,
      session_id: established.payload.session_id,
      mode: "live",
      now: NOW,
    },
    async () => ({
      status: "ok",
      snapshot: snapshotFor(state, reference, { session_id: "session_not_current" }),
    }),
  );
  assert.equal(result.code, "STATE_CHANGED_REQUIRES_REEVALUATION");
  assert.equal(getExposureReservationExecutionView(state.reservation_runtime, accepted.reservationId)?.reservation.state, "accepted_reserved");
  assert.equal(getExposurePlanAuthorizationRuntime(state).consumed_nonces.size, 0);
});

test("a source block/hash refresh alone does not invalidate unchanged policy quantities", async () => {
  const state = createExposureRuntimeState();
  const reference = await fixtureReference(state);
  const established = await establish(state);
  const accepted = await acceptAndIssuePermit(state, reference, established, PLAN, "block-refresh");
  const refreshed = snapshotFor(state, reference, {
    source: { graph_hash: "0x" + "56".repeat(32) },
  });
  const result = await executeExposurePlanReservation(
    state,
    {
      reservation_id: accepted.reservationId,
      permit: accepted.permit as any,
      session_id: established.payload.session_id,
      mode: "live",
      now: NOW,
    },
    async () => ({ status: "ok", snapshot: refreshed }),
  );
  assert.equal(result.code, "PAPER_EXECUTED");
  assert.equal(
    (result.overlay as { base_source: { graph_hash: string } }).base_source.graph_hash,
    "0x" + "56".repeat(32),
  );
});

test("reservation expiry is rechecked after an awaited refresh and releases exactly once", async () => {
  const clock = controlledClock();
  const state = createExposureRuntimeState({ reservation: { reservation_ttl_ms: 60_000 } });
  const reference = await fixtureReference(state);
  const established = await establish(state, { boundary: { clock: clock.now } });
  const accepted = await acceptAndIssuePermit(state, reference, established, PLAN, "expiry-during-refresh");
  const pending = deferred<ExposurePlanRefreshResult>();
  const execution = executeExposurePlanReservation(
    state,
    {
      reservation_id: accepted.reservationId,
      permit: accepted.permit as any,
      session_id: established.payload.session_id,
      mode: "live",
      now: NOW,
      clock: clock.now,
      operator_session: established.payload,
    } as any,
    () => pending.promise,
  );

  clock.advance(60_000);
  pending.resolve({ status: "ok", snapshot: snapshotFor(state, reference) });
  const result = await execution;
  assert.equal(result.code, "RESERVATION_EXPIRED");
  const view = getExposureReservationExecutionView(state.reservation_runtime, accepted.reservationId);
  assert.equal(view?.reservation.state, "expired");
  const releaseEvent = view?.reservation.capacity_release_event_id;
  assert.ok(releaseEvent);
  assert.equal(getExposurePlanAuthorizationRuntime(state).paper_overlay, null);
  assert.equal(getExposurePlanAuthorizationRuntime(state).consumed_nonces.size, 0);
  assert.equal(getExposureReservationCapacity(state.reservation_runtime).active_reservation_count, 0);

  const repeated = getExposureReservationExecutionView(state.reservation_runtime, accepted.reservationId);
  assert.equal(repeated?.reservation.capacity_release_event_id, releaseEvent);
});

test("the execute route uses its server-owned clock after refresh", async () => {
  const clock = controlledClock();
  const state = createExposureRuntimeState({ reservation: { reservation_ttl_ms: 60_000 } });
  const reference = await fixtureReference(state);
  const established = await establish(state, { boundary: { clock: clock.now } });
  const accepted = await acceptAndIssuePermit(state, reference, established, PLAN, "route-expiry-during-refresh");
  const pending = deferred<ExposurePlanRefreshResult>();
  const execution = handleJudgeModeRequest(
    "POST",
    "/api/exposure/reservation/execute",
    JSON.stringify({ reservation_id: accepted.reservationId, permit: accepted.permit, session_id: established.payload.session_id, mode: "live" }),
    {
      exposureDependencies: { runtimeState: state, now: NOW },
      operatorBoundary: { clock: clock.now },
      planRefresh: () => pending.promise,
    },
    established.headers,
  );
  clock.advance(60_000);
  pending.resolve({ status: "ok", snapshot: snapshotFor(state, reference) });
  const response = await execution;
  assert.equal(response.statusCode, 409);
  assert.equal((response.payload as { code: string }).code, "RESERVATION_EXPIRED");
  assert.equal(getExposurePlanAuthorizationRuntime(state).paper_overlay, null);
  assert.equal(getExposurePlanAuthorizationRuntime(state).consumed_nonces.size, 0);
});

test("permit expiry is rechecked after refresh without expiring a longer reservation", async () => {
  const clock = controlledClock();
  const state = createExposureRuntimeState({ reservation: { reservation_ttl_ms: 600_000 } });
  const reference = await fixtureReference(state);
  const established = await establish(state, { boundary: { clock: clock.now, session_ttl_ms: 600_000 } });
  const accepted = await acceptAndIssuePermit(state, reference, established, PLAN, "permit-expiry-during-refresh");
  const pending = deferred<ExposurePlanRefreshResult>();
  const execution = executeExposurePlanReservation(
    state,
    {
      reservation_id: accepted.reservationId,
      permit: accepted.permit as any,
      session_id: established.payload.session_id,
      mode: "live",
      now: NOW,
      clock: clock.now,
      operator_session: established.payload,
    } as any,
    () => pending.promise,
  );

  clock.advance(301_000);
  pending.resolve({ status: "ok", snapshot: snapshotFor(state, reference) });
  const result = await execution;
  assert.equal(result.code, "PERMIT_EXPIRED");
  assert.equal(getExposureReservationExecutionView(state.reservation_runtime, accepted.reservationId)?.reservation.state, "accepted_reserved");
  assert.equal(getExposurePlanAuthorizationRuntime(state).paper_overlay, null);
  assert.equal(getExposurePlanAuthorizationRuntime(state).consumed_nonces.size, 0);
});

test("operator-session expiry is rechecked after refresh without execution side effects", async () => {
  const clock = controlledClock();
  const state = createExposureRuntimeState({ reservation: { reservation_ttl_ms: 600_000 } });
  const reference = await fixtureReference(state);
  const established = await establish(state, { boundary: { clock: clock.now, session_ttl_ms: 60_000 } });
  const accepted = await acceptAndIssuePermit(state, reference, established, PLAN, "operator-expiry-during-refresh");
  const pending = deferred<ExposurePlanRefreshResult>();
  const execution = executeExposurePlanReservation(
    state,
    {
      reservation_id: accepted.reservationId,
      permit: accepted.permit as any,
      session_id: established.payload.session_id,
      mode: "live",
      now: NOW,
      clock: clock.now,
      operator_session: established.payload,
    } as any,
    () => pending.promise,
  );

  clock.advance(60_000);
  pending.resolve({ status: "ok", snapshot: snapshotFor(state, reference) });
  const result = await execution;
  assert.equal(result.code, "OPERATOR_SESSION_EXPIRED");
  assert.equal(getExposureReservationExecutionView(state.reservation_runtime, accepted.reservationId)?.reservation.state, "accepted_reserved");
  assert.equal(getExposurePlanAuthorizationRuntime(state).paper_overlay, null);
  assert.equal(getExposurePlanAuthorizationRuntime(state).consumed_nonces.size, 0);
});

test("fixture provenance cannot silently execute against a live refresh", async () => {
  const state = createExposureRuntimeState();
  const reference = await fixtureReference(state);
  const established = await establish(state);
  const accepted = await acceptAndIssuePermit(state, reference, established, PLAN, "fixture-live-provenance");
  const result = await executeExposurePlanReservation(
    state,
    {
      reservation_id: accepted.reservationId,
      permit: accepted.permit as any,
      session_id: established.payload.session_id,
      mode: "live",
      now: NOW,
    },
    async () => ({
      status: "ok",
      snapshot: snapshotFor(state, reference, { source: { provenance: "LIVE_SOURCE" } } as any),
    }),
  );
  assert.equal(result.code, "SOURCE_PROVENANCE_MISMATCH");
  assert.equal(getExposureReservationExecutionView(state.reservation_runtime, accepted.reservationId)?.reservation.state, "accepted_reserved");
  assert.equal(getExposurePlanAuthorizationRuntime(state).paper_overlay, null);
  assert.equal(getExposurePlanAuthorizationRuntime(state).consumed_nonces.size, 0);
});

test("live provenance cannot silently execute against a fixture refresh", async () => {
  const state = createExposureRuntimeState();
  const reference = await fixtureReference(state);
  const stored = state.evaluations.get(reference);
  assert.ok(stored);
  const graph = stored!.evaluation.graph;
  assert.ok(graph);
  stored!.evaluation = {
    ...stored!.evaluation,
    mode: "live",
    graph: { ...graph!, mode: "live" },
  };
  const established = await establish(state);
  const accepted = await acceptAndIssuePermit(state, reference, established, PLAN, "live-fixture-provenance");
  const result = await executeExposurePlanReservation(
    state,
    {
      reservation_id: accepted.reservationId,
      permit: accepted.permit as any,
      session_id: established.payload.session_id,
      mode: "live",
      now: NOW,
    },
    async () => ({
      status: "ok",
      snapshot: snapshotFor(state, reference, { source: { provenance: "FIXTURE" } } as any),
    }),
  );
  assert.equal(result.code, "SOURCE_PROVENANCE_MISMATCH");
  assert.equal(getExposureReservationExecutionView(state.reservation_runtime, accepted.reservationId)?.reservation.state, "accepted_reserved");
  assert.equal(getExposurePlanAuthorizationRuntime(state).paper_overlay, null);
  assert.equal(getExposurePlanAuthorizationRuntime(state).consumed_nonces.size, 0);
});

test("expired permits and restarted runtime generations cannot execute", async () => {
  const expiredState = createExposureRuntimeState();
  const expiredReference = await fixtureReference(expiredState);
  const expiredSession = await establish(expiredState);
  const expired = await acceptAndIssuePermit(expiredState, expiredReference, expiredSession, PLAN, "expired-permit");
  const expiredResult = await executeExposurePlanReservation(
    expiredState,
    {
      reservation_id: expired.reservationId,
      permit: expired.permit as any,
      session_id: expiredSession.payload.session_id,
      mode: "live",
      now: new Date(NOW.getTime() + 301_000),
    },
    refreshFor(expiredState, expiredReference),
  );
  assert.equal(expiredResult.code, "PERMIT_EXPIRED");
  assert.equal(getExposurePlanAuthorizationRuntime(expiredState).paper_overlay, null);

  const restartedState = createExposureRuntimeState();
  const restartedReference = await fixtureReference(restartedState);
  const restartedSession = await establish(restartedState);
  const restarted = await acceptAndIssuePermit(restartedState, restartedReference, restartedSession, PLAN, "restarted-permit");
  const currentSnapshot = snapshotFor(restartedState, restartedReference);
  updateExposureReservationSource(restartedState, {
    ...currentSnapshot,
    runtime_generation: "generation_after_restart",
  });
  const restartedResult = await executeExposurePlanReservation(
    restartedState,
    {
      reservation_id: restarted.reservationId,
      permit: restarted.permit as any,
      session_id: restartedSession.payload.session_id,
      mode: "live",
      now: NOW,
    },
    refreshFor(restartedState, restartedReference),
  );
  assert.equal(restartedResult.code, "RUNTIME_RESTART_INVALIDATED");
  assert.equal(getExposurePlanAuthorizationRuntime(restartedState).paper_overlay, null);
});

test("operator admission routes enforce exact shared capacity for two allowlisted agents", async () => {
  const state = createExposureRuntimeState();
  const reference = await fixtureReference(state);
  const established = await establish(state);
  const first = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: SHARED_AGENT_A_PLAN, idempotency_key: "route-agent-a", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(first.statusCode, 200);

  const second = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: SHARED_AGENT_B_PLAN, idempotency_key: "route-agent-b", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(second.statusCode, 409);
  assert.equal((second.payload as { code: string }).code, "SHARED_CAPACITY_INSUFFICIENT");
  const capacity = getExposureReservationCapacity(state.reservation_runtime);
  assert.equal(capacity.remaining_total_headroom_raw, 50000000000000000n);
  assert.equal(capacity.remaining_aave_headroom_raw, 100000000000000000n);
  assert.equal(capacity.active_reservation_count, 1);
});

test("what-if permits are rejected at the execution boundary without overlay or nonce mutation", async () => {
  const state = createExposureRuntimeState();
  const established = await establish(state);
  const issued = issueExposurePlanPermit({
    plan_hash: "c".repeat(64),
    agent_id: "agent_a",
    account: "0x0000000000000000000000000000000000000001",
    policy_version: "exposure-plan-wsteth-v1",
    evidence_ref: "exposure_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    graph_hash: "0x" + "11".repeat(32),
    reservation_id: "reservation_simulation",
    session_id: established.payload.session_id,
    mode: "what_if",
    source_provenance: "FIXTURE",
    runtime_generation: established.payload.runtime_generation,
    now: NOW,
    nonce: "99",
  });
  assert.equal(issued.status, "issued");
  if (issued.status !== "issued") throw new Error("expected what-if permit");

  const result = await executeExposurePlanReservation(
    state,
    {
      reservation_id: "reservation_simulation",
      permit: issued.permit,
      session_id: established.payload.session_id,
      mode: "what_if",
      now: NOW,
    },
    async () => ({ status: "blocked", code: "SOURCE_UNAVAILABLE" }),
  );
  assert.equal(result.code, "SIMULATION_NOT_EXECUTABLE");
  assert.equal(getExposurePlanAuthorizationRuntime(state).paper_overlay, null);
  assert.equal(getExposurePlanAuthorizationRuntime(state).consumed_nonces.size, 0);
});

test("source failure or state changes during awaited refresh leave reservation, overlay and nonce untouched", async () => {
  const state = createExposureRuntimeState();
  const reference = await fixtureReference(state);
  const established = await establish(state);
  const accepted = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PLAN, idempotency_key: "refresh-race", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  const reservationId = (accepted.payload as { reservation: { reservation_id: string } }).reservation.reservation_id;
  const issued = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/permit",
    JSON.stringify({ reservation_id: reservationId, session_id: established.payload.session_id, mode: "live" }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  const permit = (issued.payload as { permit: any }).permit;

  const sourceFailure = await executeExposurePlanReservation(
    state,
    { reservation_id: reservationId, permit, session_id: established.payload.session_id, mode: "live", now: NOW },
    async () => ({ status: "blocked", code: "SOURCE_UNAVAILABLE" }),
  );
  assert.equal(sourceFailure.code, "CURRENT_SOURCE_UNAVAILABLE");
  assert.equal(getExposurePlanAuthorizationRuntime(state).paper_overlay, null);
  assert.equal(getExposurePlanAuthorizationRuntime(state).consumed_nonces.size, 0);

  const pending = deferred<ExposurePlanRefreshResult>();
  const execution = executeExposurePlanReservation(
    state,
    { reservation_id: reservationId, permit, session_id: established.payload.session_id, mode: "live", now: NOW },
    () => pending.promise,
  );
  const cancelled = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/reservation/cancel",
    JSON.stringify({ reservation_id: reservationId, reason: "operator_cancel" }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(cancelled.statusCode, 200);
  pending.resolve({ status: "ok", snapshot: buildExposurePlanRefreshSnapshot(reference, getStoredExposureEvaluation(state, reference, NOW)!).snapshot! });
  const changed = await execution;
  assert.equal(changed.code, "STATE_CHANGED_REQUIRES_REEVALUATION");
  assert.equal(getExposurePlanAuthorizationRuntime(state).paper_overlay, null);
  assert.equal(getExposurePlanAuthorizationRuntime(state).consumed_nonces.size, 0);
});

test("old operator sessions and runtime generations cannot authorize a current reservation", async () => {
  const state = createExposureRuntimeState();
  const first = await establish(state);
  const reset = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/operator/session/reset",
    "{}",
    { exposureDependencies: { runtimeState: state, now: NOW } },
    first.headers,
  );
  assert.equal(reset.statusCode, 200);
  const resetCookie = reset.headers?.["set-cookie"];
  assert.ok(resetCookie);
  const resetCookieValue = Array.isArray(resetCookie) ? resetCookie[0] : resetCookie;
  const second = {
    state,
    payload: reset.payload as Record<string, string>,
    cookie: resetCookieValue.split(";", 1)[0],
    headers: context(resetCookieValue.split(";", 1)[0], (reset.payload as Record<string, string>).csrf_token),
  };
  assert.notEqual(first.payload.session_id, second.payload.session_id);

  const reference = await fixtureReference(state);
  const stale = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PLAN, idempotency_key: "stale-session", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    first.headers,
  );
  assert.equal(stale.statusCode, 403);

  const current = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PLAN, idempotency_key: "current-session", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    second.headers,
  );
  assert.equal(current.statusCode, 200);
});

test("foreign-origin and cross-site bootstrap requests cannot rotate an active operator context", async () => {
  const state = createExposureRuntimeState();
  const established = await establish(state);
  const reference = await fixtureReference(state);
  const accepted = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PLAN, idempotency_key: "bootstrap-boundary", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(accepted.statusCode, 200);
  const beforeSession = state.reservation_runtime.session_id;

  const foreignOrigin = await handleJudgeModeRequest(
    "GET",
    "/api/exposure/operator/session",
    "",
    { exposureDependencies: { runtimeState: state, now: NOW } },
    { headers: { host: HOST, origin: "https://attacker.invalid" } },
  );
  assert.equal(foreignOrigin.statusCode, 403);
  assert.equal(state.reservation_runtime.session_id, beforeSession);
  assert.equal(getExposureReservationExecutionView(state.reservation_runtime, (accepted.payload as any).reservation.reservation_id)?.reservation.state, "accepted_reserved");

  const crossSite = await handleJudgeModeRequest(
    "GET",
    "/api/exposure/operator/session",
    "",
    { exposureDependencies: { runtimeState: state, now: NOW } },
    { headers: { host: HOST, origin: ORIGIN, "sec-fetch-site": "cross-site" } },
  );
  assert.equal(crossSite.statusCode, 403);
  assert.equal(state.reservation_runtime.session_id, beforeSession);
  assert.equal(getExposureReservationExecutionView(state.reservation_runtime, (accepted.payload as any).reservation.reservation_id)?.reservation.state, "accepted_reserved");
});

test("rejected bootstrap preserves an existing paper overlay", async () => {
  const state = createExposureRuntimeState();
  const reference = await fixtureReference(state);
  const established = await establish(state);
  const accepted = await acceptAndIssuePermit(state, reference, established, PLAN, "bootstrap-overlay");
  const executed = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/reservation/execute",
    JSON.stringify({ reservation_id: accepted.reservationId, permit: accepted.permit, session_id: established.payload.session_id, mode: "live" }),
    { exposureDependencies: { runtimeState: state, now: NOW }, planRefresh: refreshFor(state, reference) },
    established.headers,
  );
  assert.equal(executed.statusCode, 200);
  const before = structuredClone(getExposurePlanAuthorizationRuntime(state).paper_overlay);
  const rejected = await handleJudgeModeRequest(
    "GET",
    "/api/exposure/operator/session",
    "",
    { exposureDependencies: { runtimeState: state, now: NOW } },
    { headers: { host: HOST, origin: "https://attacker.invalid" } },
  );
  assert.equal(rejected.statusCode, 403);
  assert.equal(state.reservation_runtime.session_id, established.payload.session_id);
  assert.deepEqual(getExposurePlanAuthorizationRuntime(state).paper_overlay, before);
});

test("missing and stale cookies cannot bootstrap over an active session, while valid reuse is read-only", async () => {
  const state = createExposureRuntimeState();
  const established = await establish(state);
  const beforeSession = state.reservation_runtime.session_id;
  const missingCookie = await handleJudgeModeRequest(
    "GET",
    "/api/exposure/operator/session",
    "",
    { exposureDependencies: { runtimeState: state, now: NOW } },
    { headers: { host: HOST, origin: ORIGIN } },
  );
  assert.equal(missingCookie.statusCode, 401);
  assert.equal(state.reservation_runtime.session_id, beforeSession);

  const staleCookie = await handleJudgeModeRequest(
    "GET",
    "/api/exposure/operator/session",
    "",
    { exposureDependencies: { runtimeState: state, now: NOW } },
    { headers: { host: HOST, origin: ORIGIN, cookie: "sentinel_operator_session=stale" } },
  );
  assert.equal(staleCookie.statusCode, 401);
  assert.equal(state.reservation_runtime.session_id, beforeSession);

  const reused = await handleJudgeModeRequest(
    "GET",
    "/api/exposure/operator/session",
    "",
    { exposureDependencies: { runtimeState: state, now: NOW } },
    established.headers,
  );
  assert.equal(reused.statusCode, 200);
  assert.equal((reused.payload as Record<string, string>).session_id, established.payload.session_id);
  assert.equal(reused.headers?.["set-cookie"], undefined);
  assert.equal(state.reservation_runtime.session_id, beforeSession);
});

test("initial bootstrap is allowed without CSRF, but explicit reset requires the operator boundary", async () => {
  const initial = await establish();
  assert.equal(initial.payload.mode, "live");

  const state = initial.state;
  const reference = await fixtureReference(state);
  const accepted = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PLAN, idempotency_key: "explicit-reset", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    initial.headers,
  );
  assert.equal(accepted.statusCode, 200);
  const oldSessionId = initial.payload.session_id;

  const reset = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/operator/session/reset",
    "{}",
    { exposureDependencies: { runtimeState: state, now: NOW } },
    initial.headers,
  );
  assert.equal(reset.statusCode, 200);
  assert.notEqual((reset.payload as Record<string, string>).session_id, oldSessionId);
  assert.ok(reset.headers?.["set-cookie"]);
  assert.equal(getExposureReservationExecutionView(state.reservation_runtime, (accepted.payload as any).reservation.reservation_id)?.reservation.state, "invalidated");

  const oldSessionMutation = await handleJudgeModeRequest(
    "POST",
    "/api/exposure/plan/accept",
    JSON.stringify({ evaluation_ref: reference, plan: PLAN, idempotency_key: "old-session-after-reset", accept_partial: false }),
    { exposureDependencies: { runtimeState: state, now: NOW } },
    initial.headers,
  );
  assert.equal(oldSessionMutation.statusCode, 403);
});

test("the real local HTTP server preserves the cookie and CSRF boundary", async () => {
  const port = 18787;
  const origin = "http://127.0.0.1:" + port;
  const server = createJudgeModeServer({
    operatorBoundary: { allowed_origin: origin, allowed_host: "127.0.0.1:" + port },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  try {
    const sessionResponse = await fetch(origin + "/api/exposure/operator/session");
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json() as Record<string, string>;
    const setCookie = sessionResponse.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";", 1)[0];
    assert.match(cookie, /^sentinel_operator_session=/);
    assert.equal("cookie_token" in session, false);
    assert.equal("expires_at_ms" in session, false);

    const mutation = await fetch(origin + "/api/exposure/plan/accept", {
      method: "POST",
      headers: {
        origin,
        cookie,
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(mutation.status, 403);
    assert.equal((await mutation.json()).error, "operator_csrf_rejected");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
