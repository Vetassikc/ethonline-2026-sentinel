import test from "node:test";
import assert from "node:assert/strict";

import type { ExposurePlanV1 } from "../../shared/schemas/exposure-plan.ts";
import { createExposureRuntimeState } from "../app/exposure-service.ts";
import {
  acceptExposurePlan,
  acceptExposurePlanWithRefresh,
  cancelExposureReservation,
  createExposureReservationRuntime,
  expireExposureReservations,
  getExposureReservationCapacity,
  updateExposureReservationSource,
  type ExposureReservationRuntime,
  type ExposureReservationSourceSnapshot,
} from "../app/exposure-reservations.ts";
import type { ExposureAccountingState, ExposurePlanPolicy } from "../app/exposure-plan-engine.ts";

const POLICY: ExposurePlanPolicy = {
  policy_version: "exposure-plan-wsteth-v1",
  dependency_cap_units: "1.000000000000000000",
  aave_cap_units: "0.500000000000000000",
  unit: "wstETH",
};

const CANONICAL_STATE: ExposureAccountingState = {
  direct_available_raw: 400000000000000000n,
  aave_exposure_raw: 400000000000000000n,
  total_exposure_raw: 800000000000000000n,
  debt_raw: 0n,
  dependency_cap_raw: 1000000000000000000n,
  aave_cap_raw: 500000000000000000n,
};

const EVALUATION_REF = "exposure_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const GRAPH_HASH = "graph_fixture_a";
const NOW = new Date("2026-09-08T12:00:00.000Z");

function acquirePlan(agent_id: "agent_a" | "agent_b", units = "0.150000000000000000"): ExposurePlanV1 {
  return {
    schema_version: "exposure_plan.v1",
    agent_id,
    goal: { kind: "acquire_up_to", target_units: units },
    steps: [{ kind: "acquire_wsteth", units }],
  };
}

function supplyPlan(
  agent_id: "agent_a" | "agent_b",
  units = "0.100000000000000000",
): ExposurePlanV1 {
  return {
    schema_version: "exposure_plan.v1",
    agent_id,
    goal: { kind: "supply_up_to", target_units: units },
    steps: [{ kind: "supply_aave", units }],
  };
}

function withdrawPlan(
  agent_id: "agent_a" | "agent_b",
  units = "0.100000000000000000",
): ExposurePlanV1 {
  return {
    schema_version: "exposure_plan.v1",
    agent_id,
    goal: { kind: "reduce_aave_exposure", target_units: units },
    steps: [{ kind: "withdraw_aave_to_wallet", units }],
  };
}

function partialPlan(): ExposurePlanV1 {
  return {
    schema_version: "exposure_plan.v1",
    agent_id: "agent_a",
    goal: { kind: "supply_up_to", target_units: "0.300000000000000000" },
    steps: [
      { kind: "acquire_wsteth", units: "0.200000000000000000" },
      { kind: "supply_aave", units: "0.100000000000000000" },
    ],
  };
}

function sourceSnapshot(overrides: Partial<ExposureReservationSourceSnapshot> = {}): ExposureReservationSourceSnapshot {
  return {
    state: CANONICAL_STATE,
    source: {
      evaluation_ref: EVALUATION_REF,
      graph_hash: GRAPH_HASH,
      provenance: "FIXTURE",
      qualified: true,
    },
    session_id: "session_fixture_a",
    mode: "fixture",
    runtime_generation: "generation_a",
    ...overrides,
  };
}

function runtime(
  state: ExposureAccountingState = CANONICAL_STATE,
  overrides: Partial<Parameters<typeof createExposureReservationRuntime>[0]> = {},
): ExposureReservationRuntime {
  const snapshot = sourceSnapshot({ state });
  return createExposureReservationRuntime({
    account_scope: "server-test-account",
    base_state: state,
    policy: POLICY,
    source: snapshot.source,
    session_id: "session_fixture_a",
    mode: "fixture",
    runtime_generation: "generation_a",
    now: NOW,
    ...overrides,
  });
}

function request(key: string, overrides: Record<string, unknown> = {}) {
  return {
    evaluation_ref: EVALUATION_REF,
    graph_hash: GRAPH_HASH,
    idempotency_key: key,
    now: NOW,
    ...overrides,
  };
}

function assertAccepted(result: ReturnType<typeof acceptExposurePlan>) {
  assert.equal(result.status, "accepted_reserved");
  if (result.status !== "accepted_reserved") throw new Error("expected accepted reservation");
  return result;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve; });
  return { promise, resolve };
}

test("atomic shared-headroom admission accepts one .15 acquire and leaves exact .05 total headroom", async () => {
  const state = runtime();
  assertAccepted(acceptExposurePlan(acquirePlan("agent_b"), runtime(), request("individual-b")));
  const first = assertAccepted(acceptExposurePlan(acquirePlan("agent_a"), state, request("agent-a-1")));
  const second = acceptExposurePlan(acquirePlan("agent_b"), state, request("agent-b-1"));

  assert.equal(first.reservation.peak_total_increase_units, "0.150000000000000000");
  assert.equal(first.reservation.peak_aave_increase_units, "0.000000000000000000");
  assert.equal(second.status, "rejected");
  if (second.status === "rejected") {
    assert.equal(second.code, "SHARED_CAPACITY_INSUFFICIENT");
    assert.equal(second.details.includes("reserved_total_cap_exceeded"), true);
  }

  const capacity = getExposureReservationCapacity(state);
  assert.equal(capacity.remaining_total_headroom_raw, 50000000000000000n);
  assert.equal(capacity.remaining_aave_headroom_raw, 100000000000000000n);
  assert.equal(capacity.active_reservation_count, 1);

  const simultaneousState = runtime();
  const simultaneous = await Promise.all([
    Promise.resolve().then(() => acceptExposurePlan(acquirePlan("agent_a"), simultaneousState, request("sim-a"))),
    Promise.resolve().then(() => acceptExposurePlan(acquirePlan("agent_b"), simultaneousState, request("sim-b"))),
  ]);
  assert.equal(simultaneous.filter((item) => item.status === "accepted_reserved").length, 1);
  assert.equal(simultaneous.filter((item) => item.status === "rejected").length, 1);
});

test("protocol Aave-cap contention is independent from shared total-headroom contention", () => {
  const result = acceptExposurePlan(supplyPlan("agent_a", "0.150000000000000000"), runtime(), request("aave-cap"));
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "POLICY_VIOLATION");
    assert.equal(result.details.includes("aave_cap_exceeded"), true);
    assert.equal(result.details.includes("reserved_total_cap_exceeded"), false);
  }
});

test("direct and Aave inventory conflicts are admitted independently", () => {
  const lowAave = runtime({
    ...CANONICAL_STATE,
    direct_available_raw: 400000000000000000n,
    aave_exposure_raw: 200000000000000000n,
    total_exposure_raw: 600000000000000000n,
  });
  assertAccepted(acceptExposurePlan(supplyPlan("agent_a", "0.200000000000000000"), lowAave, request("direct-a")));
  const directConflict = acceptExposurePlan(supplyPlan("agent_b", "0.300000000000000000"), lowAave, request("direct-b"));
  assert.equal(directConflict.status, "rejected");
  if (directConflict.status === "rejected") {
    assert.equal(directConflict.code, "SHARED_CAPACITY_INSUFFICIENT");
    assert.equal(directConflict.details.includes("reserved_direct_inventory_exceeded"), true);
  }

  const lowDirect = runtime({
    ...CANONICAL_STATE,
    direct_available_raw: 600000000000000000n,
    aave_exposure_raw: 200000000000000000n,
    total_exposure_raw: 800000000000000000n,
  });
  assertAccepted(acceptExposurePlan(withdrawPlan("agent_a", "0.100000000000000000"), lowDirect, request("aave-a")));
  const aaveConflict = acceptExposurePlan(withdrawPlan("agent_b", "0.150000000000000000"), lowDirect, request("aave-b"));
  assert.equal(aaveConflict.status, "rejected");
  if (aaveConflict.status === "rejected") {
    assert.equal(aaveConflict.code, "SHARED_CAPACITY_INSUFFICIENT");
    assert.equal(aaveConflict.details.includes("reserved_aave_inventory_exceeded"), true);
  }
});

test("cancellation, expiry and duplicate release change capacity exactly once", () => {
  const state = runtime(CANONICAL_STATE, { reservation_ttl_ms: 10 });
  const accepted = assertAccepted(acceptExposurePlan(acquirePlan("agent_a"), state, request("release-a")));
  const cancelled = cancelExposureReservation(accepted.reservation.reservation_id, state, { now: NOW });
  assert.equal(cancelled.status, "cancelled");
  if (cancelled.status !== "cancelled") throw new Error("expected cancellation");
  const releaseEvent = cancelled.reservation.capacity_release_event_id;
  assert.ok(releaseEvent);
  const duplicate = cancelExposureReservation(accepted.reservation.reservation_id, state, { now: NOW });
  assert.equal(duplicate.status, "cancelled");
  if (duplicate.status === "cancelled") assert.equal(duplicate.reservation.capacity_release_event_id, releaseEvent);
  assert.equal(getExposureReservationCapacity(state).remaining_total_headroom_raw, 200000000000000000n);

  const expiring = assertAccepted(acceptExposurePlan(acquirePlan("agent_b"), state, request("release-b", {
    now: new Date(NOW.getTime() + 20),
  })));
  const expired = expireExposureReservations(state, new Date(NOW.getTime() + 31));
  assert.deepEqual(expired.map((item) => item.reservation_id), [expiring.reservation.reservation_id]);
  const expiredAgain = expireExposureReservations(state, new Date(NOW.getTime() + 32));
  assert.deepEqual(expiredAgain, []);
  assert.equal(getExposureReservationCapacity(state).active_reservation_count, 0);
});

test("idempotency returns the original reservation and rejects a different payload", () => {
  const state = runtime();
  const first = assertAccepted(acceptExposurePlan(acquirePlan("agent_a"), state, request("same-key")));
  const duplicate = acceptExposurePlan(acquirePlan("agent_a"), state, request("same-key"));
  assert.equal(duplicate.status, "accepted_reserved");
  if (duplicate.status === "accepted_reserved") {
    assert.equal(duplicate.idempotent, true);
    assert.equal(duplicate.reservation.reservation_id, first.reservation.reservation_id);
  }
  const conflict = acceptExposurePlan(acquirePlan("agent_b"), state, request("same-key"));
  assert.equal(conflict.status, "rejected");
  if (conflict.status === "rejected") assert.equal(conflict.code, "IDEMPOTENCY_KEY_CONFLICT");
});

test("active idempotency survives retention expiry and terminal replay is not authorization", () => {
  const state = runtime(CANONICAL_STATE, {
    reservation_ttl_ms: 1_000,
    idempotency_retention_ms: 10,
  });
  const first = assertAccepted(acceptExposurePlan(
    acquirePlan("agent_a", "0.050000000000000000"),
    state,
    request("active-retention", { now: NOW }),
  ));

  const afterRetention = acceptExposurePlan(
    acquirePlan("agent_a", "0.050000000000000000"),
    state,
    request("active-retention", { now: new Date(NOW.getTime() + 11) }),
  );
  assert.equal(afterRetention.status, "accepted_reserved");
  if (afterRetention.status === "accepted_reserved") {
    assert.equal(afterRetention.idempotent, true);
    assert.equal(afterRetention.reservation.reservation_id, first.reservation.reservation_id);
  }
  assert.equal(state.reservations.size, 1);

  const cancelled = cancelExposureReservation(first.reservation.reservation_id, state, {
    now: new Date(NOW.getTime() + 12),
  });
  assert.equal(cancelled.status, "cancelled");

  const terminalReplay = acceptExposurePlan(
    acquirePlan("agent_a", "0.050000000000000000"),
    state,
    request("active-retention", { now: new Date(NOW.getTime() + 13) }),
  );
  assert.equal(terminalReplay.status, "rejected");
  if (terminalReplay.status === "rejected") assert.equal(terminalReplay.code, "IDEMPOTENCY_KEY_TERMINAL");

  const afterTerminalRetention = acceptExposurePlan(
    acquirePlan("agent_a", "0.050000000000000000"),
    state,
    request("active-retention", { now: new Date(NOW.getTime() + 23) }),
  );
  assert.equal(afterTerminalRetention.status, "accepted_reserved");
  if (afterTerminalRetention.status === "accepted_reserved") {
    assert.notEqual(afterTerminalRetention.reservation.reservation_id, first.reservation.reservation_id);
  }
});

test("bounded idempotency storage never evicts an active replay guarantee", () => {
  const state = runtime(CANONICAL_STATE, {
    reservation_ttl_ms: 1_000,
    idempotency_retention_ms: 10,
    max_idempotency_entries: 1,
  });
  const first = assertAccepted(acceptExposurePlan(
    acquirePlan("agent_a", "0.050000000000000000"),
    state,
    request("bounded-active"),
  ));
  const rejected = acceptExposurePlan(
    acquirePlan("agent_b", "0.050000000000000000"),
    state,
    request("different-key", { now: new Date(NOW.getTime() + 11) }),
  );
  assert.equal(rejected.status, "rejected");
  if (rejected.status === "rejected") assert.equal(rejected.code, "IDEMPOTENCY_STORE_FULL");
  const duplicate = acceptExposurePlan(
    acquirePlan("agent_a", "0.050000000000000000"),
    state,
    request("bounded-active", { now: new Date(NOW.getTime() + 12) }),
  );
  assert.equal(duplicate.status, "accepted_reserved");
  if (duplicate.status === "accepted_reserved") assert.equal(duplicate.reservation.reservation_id, first.reservation.reservation_id);
});

test("pending withdrawals do not release cap capacity and peak Aave demand survives a return", () => {
  const atAaveCap = runtime({
    ...CANONICAL_STATE,
    direct_available_raw: 300000000000000000n,
    aave_exposure_raw: 500000000000000000n,
    total_exposure_raw: 800000000000000000n,
  });
  assertAccepted(acceptExposurePlan(withdrawPlan("agent_a", "0.100000000000000000"), atAaveCap, request("pending-withdrawal")));
  const supply = acceptExposurePlan(supplyPlan("agent_b", "0.100000000000000000"), atAaveCap, request("blocked-supply"));
  assert.equal(supply.status, "rejected");
  if (supply.status === "rejected") assert.equal(supply.details.includes("aave_cap_exceeded"), true);

  const roundTrip = assertAccepted(acceptExposurePlan({
    schema_version: "exposure_plan.v1",
    agent_id: "agent_a",
    goal: { kind: "supply_up_to", target_units: "0.100000000000000000" },
    steps: [
      { kind: "supply_aave", units: "0.100000000000000000" },
      { kind: "withdraw_aave_to_wallet", units: "0.050000000000000000" },
    ],
  }, runtime(), request("round-trip", { accept_partial: true })));
  assert.equal(roundTrip.reservation.peak_aave_increase_units, "0.100000000000000000");
  assert.equal(roundTrip.reservation.required_preexisting_direct_units, "0.100000000000000000");
  assert.equal(roundTrip.reservation.required_preexisting_aave_units, "0.000000000000000000");
});

test("PARTIAL admission requires an explicit operator acceptance", () => {
  const state = runtime();
  const pending = acceptExposurePlan(partialPlan(), state, request("partial-pending"));
  assert.equal(pending.status, "rejected");
  if (pending.status === "rejected") assert.equal(pending.code, "PARTIAL_ACCEPTANCE_REQUIRED");
  const accepted = acceptExposurePlan(partialPlan(), state, request("partial-accepted", { accept_partial: true }));
  assert.equal(accepted.status, "accepted_reserved");
  if (accepted.status === "accepted_reserved") assert.equal(accepted.evaluation.goal_status, "PARTIAL");
});

test("session, mode and generation mismatches reject stale admission", () => {
  const state = runtime();
  for (const [field, value, code] of [
    ["session_id", "other-session", "SESSION_CONTEXT_MISMATCH"],
    ["mode", "live", "SESSION_CONTEXT_MISMATCH"],
    ["runtime_generation", "old-generation", "RUNTIME_RESTART_INVALIDATED"],
  ] as const) {
    const result = acceptExposurePlan(acquirePlan("agent_a"), state, request(`mismatch-${field}`, { [field]: value }));
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") assert.equal(result.code, code);
  }

  const restarted = runtime(undefined, {
    source: sourceSnapshot({
      evaluation_ref: "exposure_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      graph_hash: "graph_fixture_b",
    }),
    runtime_generation: "generation_b",
    session_id: "session_fixture_b",
  });
  const oldReference = acceptExposurePlan(acquirePlan("agent_a"), restarted, request("old-reference"));
  assert.equal(oldReference.status, "rejected");
  if (oldReference.status === "rejected") assert.equal(oldReference.code, "SOURCE_REFERENCE_MISMATCH");

  const prior = assertAccepted(acceptExposurePlan(acquirePlan("agent_a"), state, request("prior-runtime")));
  const freshRuntime = runtime(undefined, {
    session_id: "session_fixture_c",
    runtime_generation: "generation_c",
  });
  const staleCancel = cancelExposureReservation(prior.reservation.reservation_id, freshRuntime);
  assert.equal(staleCancel.status, "rejected");
  if (staleCancel.status === "rejected") assert.equal(staleCancel.code, "RESERVATION_NOT_FOUND");
});

test("context rotation isolates active records and never replays old authorization", () => {
  const state = runtime();
  const first = assertAccepted(acceptExposurePlan(acquirePlan("agent_a"), state, request("rotated-context")));

  updateExposureReservationSource(state, sourceSnapshot({
    session_id: "session_fixture_b",
    runtime_generation: "generation_b",
    source: {
      evaluation_ref: "exposure_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      graph_hash: "graph_fixture_b",
      provenance: "FIXTURE",
      qualified: true,
    },
  }));

  const record = state.reservations.get(first.reservation.reservation_id);
  assert.ok(record);
  assert.equal(record?.reservation.state, "invalidated");
  assert.equal(getExposureReservationCapacity(state).active_reservation_count, 0);

  const staleReplay = acceptExposurePlan(
    acquirePlan("agent_a"),
    state,
    request("rotated-context", {
      evaluation_ref: EVALUATION_REF,
      graph_hash: GRAPH_HASH,
      session_id: "session_fixture_a",
      mode: "fixture",
      runtime_generation: "generation_a",
      now: new Date(NOW.getTime() + 1),
    }),
  );
  assert.equal(staleReplay.status, "rejected");
  if (staleReplay.status === "rejected") assert.equal(staleReplay.code, "RUNTIME_RESTART_INVALIDATED");
});

test("same-session source refresh preserves active reservations", () => {
  const state = runtime();
  const first = assertAccepted(acceptExposurePlan(acquirePlan("agent_a"), state, request("same-session-refresh")));

  updateExposureReservationSource(state, sourceSnapshot({
    state: {
      ...CANONICAL_STATE,
      total_exposure_raw: 810000000000000000n,
      direct_available_raw: 410000000000000000n,
    },
    source: { ...sourceSnapshot().source, graph_hash: "graph_fixture_refresh" },
  }));

  const record = state.reservations.get(first.reservation.reservation_id);
  assert.ok(record);
  assert.equal(record?.reservation.state, "accepted_reserved");
  assert.equal(getExposureReservationCapacity(state).active_reservation_count, 1);
});

test("the legacy runtime owns a fresh isolated reservation generation", () => {
  const first = createExposureRuntimeState({
    reservation: {
      account_scope: "server-test-account",
      base_state: CANONICAL_STATE,
      policy: POLICY,
      source: sourceSnapshot().source,
      session_id: "session_fixture_a",
      mode: "fixture",
      runtime_generation: "generation_a",
    },
  });
  const second = createExposureRuntimeState({
    reservation: {
      account_scope: "server-test-account",
      base_state: CANONICAL_STATE,
      policy: POLICY,
      source: sourceSnapshot().source,
      session_id: "session_fixture_b",
      mode: "fixture",
      runtime_generation: "generation_b",
    },
  });
  assert.equal(first.reservation_runtime.runtime_generation, "generation_a");
  assert.equal(second.reservation_runtime.runtime_generation, "generation_b");
  assert.notEqual(first.reservation_runtime.reservations, second.reservation_runtime.reservations);
});

test("source failure during awaited refresh leaves no reservation or capacity debit", async () => {
  const state = runtime();
  const result = await acceptExposurePlanWithRefresh(
    acquirePlan("agent_a"),
    state,
    request("refresh-failure"),
    async () => ({ status: "blocked" as const, code: "SOURCE_UNAVAILABLE" as const }),
  );
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "SOURCE_UNAVAILABLE");
  assert.equal(getExposureReservationCapacity(state).active_reservation_count, 0);
  assert.equal(state.reservations.size, 0);
});

test("state or reservation changes during awaited refresh fail closed without a partial commit", async () => {
  const state = runtime();
  const pending = deferred<{ status: "ok"; snapshot: ExposureReservationSourceSnapshot }>();
  const admission = acceptExposurePlanWithRefresh(
    acquirePlan("agent_a"),
    state,
    request("refresh-race"),
    () => pending.promise,
  );

  assertAccepted(acceptExposurePlan(acquirePlan("agent_b"), state, request("race-winner")));
  pending.resolve({ status: "ok", snapshot: sourceSnapshot() });
  const result = await admission;
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "STATE_CHANGED_REQUIRES_REEVALUATION");
  assert.equal(state.reservations.size, 1);
  assert.equal(getExposureReservationCapacity(state).remaining_total_headroom_raw, 50000000000000000n);

  const sourcePending = deferred<{ status: "ok"; snapshot: ExposureReservationSourceSnapshot }>();
  const sourceAdmission = acceptExposurePlanWithRefresh(
    acquirePlan("agent_a"),
    state,
    request("source-race"),
    () => sourcePending.promise,
  );
  updateExposureReservationSource(state, sourceSnapshot({
    state: { ...CANONICAL_STATE, total_exposure_raw: 900000000000000000n, direct_available_raw: 500000000000000000n },
    source: { ...sourceSnapshot().source, graph_hash: "graph_fixture_changed" },
  }));
  sourcePending.resolve({ status: "ok", snapshot: sourceSnapshot() });
  const sourceResult = await sourceAdmission;
  assert.equal(sourceResult.status, "rejected");
  if (sourceResult.status === "rejected") assert.equal(sourceResult.code, "STATE_CHANGED_REQUIRES_REEVALUATION");
});

test("bounded terminal storage retains a non-authorizing receipt after expiry pruning", () => {
  const state = runtime(CANONICAL_STATE, {
    reservation_ttl_ms: 10,
    max_reservations: 1,
    idempotency_retention_ms: 10_000,
    max_idempotency_entries: 4,
  });
  const first = assertAccepted(acceptExposurePlan(acquirePlan("agent_a"), state, request("retained-key")));
  expireExposureReservations(state, new Date(NOW.getTime() + 11));
  assertAccepted(acceptExposurePlan(acquirePlan("agent_b"), state, request("new-key", { now: new Date(NOW.getTime() + 12) })));
  assert.ok(state.reservations.size <= 1);
  const duplicate = acceptExposurePlan(acquirePlan("agent_a"), state, request("retained-key", { now: new Date(NOW.getTime() + 13) }));
  assert.equal(duplicate.status, "rejected");
  if (duplicate.status === "rejected") assert.equal(duplicate.code, "IDEMPOTENCY_KEY_TERMINAL");
  assert.equal(first.reservation.state, "accepted_reserved");
});
