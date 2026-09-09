import test from "node:test";
import assert from "node:assert/strict";

import { createPlanRequestLifecycle } from "../../web/exposure-graph.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function settleRequest<T>(
  lifecycle: ReturnType<typeof createPlanRequestLifecycle>,
  token: ReturnType<ReturnType<typeof createPlanRequestLifecycle>["begin"]>,
  response: Promise<T>,
  apply: (value: T) => void,
  fail: () => void,
  setEvaluateDisabled: (value: boolean) => void,
): Promise<void> {
  try {
    const value = await response;
    if (lifecycle.isCurrent(token)) apply(value);
  } catch {
    if (lifecycle.isCurrent(token)) fail();
  } finally {
    if (lifecycle.finish(token)) setEvaluateDisabled(false);
  }
}

test("editing during an in-flight evaluation invalidates stale success without stranding the control", async () => {
  const lifecycle = createPlanRequestLifecycle();
  const pending = deferred<string>();
  let evaluateDisabled = true;
  let currentResult: string | null = null;
  let failed = false;
  const token = lifecycle.begin("evaluate");

  lifecycle.invalidate();
  evaluateDisabled = false;
  pending.resolve("old result");
  await settleRequest(lifecycle, token, pending.promise, (value) => { currentResult = value; }, () => { failed = true; }, (value) => {
    evaluateDisabled = value;
  });

  assert.equal(currentResult, null);
  assert.equal(failed, false);
  assert.equal(evaluateDisabled, false);
  assert.equal(lifecycle.isCurrent(token), false);
});

test("editing during an in-flight evaluation invalidates stale failure and permits recovery", async () => {
  const lifecycle = createPlanRequestLifecycle();
  const oldRequest = deferred<string>();
  let evaluateDisabled = true;
  let currentError = false;
  const oldToken = lifecycle.begin("evaluate");

  lifecycle.invalidate();
  evaluateDisabled = false;
  oldRequest.reject(new Error("old failure"));
  await settleRequest(lifecycle, oldToken, oldRequest.promise, () => {}, () => { currentError = true; }, (value) => {
    evaluateDisabled = value;
  });

  const newRequest = deferred<string>();
  const newToken = lifecycle.begin("evaluate");
  evaluateDisabled = true;
  newRequest.resolve("current result");
  let currentResult: string | null = null;
  await settleRequest(lifecycle, newToken, newRequest.promise, (value) => { currentResult = value; }, () => { currentError = true; }, (value) => {
    evaluateDisabled = value;
  });

  assert.equal(currentError, false);
  assert.equal(currentResult, "current result");
  assert.equal(evaluateDisabled, false);
});

test("an older overlapping response cannot release or overwrite the newer request", async () => {
  const lifecycle = createPlanRequestLifecycle();
  const oldRequest = deferred<string>();
  const newRequest = deferred<string>();
  let evaluateDisabled = false;
  let currentResult: string | null = null;
  const oldToken = lifecycle.begin("evaluate");
  evaluateDisabled = true;
  const newToken = lifecycle.begin("evaluate");
  oldRequest.resolve("old result");
  await settleRequest(lifecycle, oldToken, oldRequest.promise, (value) => { currentResult = value; }, () => {}, (value) => {
    evaluateDisabled = value;
  });

  assert.equal(currentResult, null);
  assert.equal(evaluateDisabled, true);
  newRequest.resolve("new result");
  await settleRequest(lifecycle, newToken, newRequest.promise, (value) => { currentResult = value; }, () => {}, (value) => {
    evaluateDisabled = value;
  });

  assert.equal(currentResult, "new result");
  assert.equal(evaluateDisabled, false);
});

test("source switching and input edits invalidate old source loading while a failed current source recovers", async () => {
  const lifecycle = createPlanRequestLifecycle();
  const oldSource = deferred<string>();
  const currentSource = deferred<string>();
  let sourceResult: string | null = null;
  let sourceError: string | null = null;
  let sourceButtonsDisabled = true;
  const oldToken = lifecycle.begin("source");
  const currentToken = lifecycle.begin("source");

  oldSource.resolve("old fixture");
  await settleRequest(lifecycle, oldToken, oldSource.promise, (value) => { sourceResult = value; }, () => { sourceError = "old"; }, (value) => {
    sourceButtonsDisabled = value;
  });
  assert.equal(sourceResult, null);
  assert.equal(sourceError, null);
  assert.equal(sourceButtonsDisabled, true);

  lifecycle.invalidate();
  sourceButtonsDisabled = false;
  currentSource.reject(new Error("current source unavailable"));
  await settleRequest(lifecycle, currentToken, currentSource.promise, (value) => { sourceResult = value; }, () => { sourceError = "current"; }, (value) => {
    sourceButtonsDisabled = value;
  });

  assert.equal(sourceResult, null);
  assert.equal(sourceError, null);
  assert.equal(sourceButtonsDisabled, false);
});

test("stale responses cannot enable legacy authorization", async () => {
  const lifecycle = createPlanRequestLifecycle();
  const oldRequest = deferred<{ legacyEligible: boolean }>();
  let legacyAuthorizationEnabled = false;
  const token = lifecycle.begin("evaluate");
  lifecycle.invalidate();
  oldRequest.resolve({ legacyEligible: true });
  await settleRequest(lifecycle, token, oldRequest.promise, (value) => {
    legacyAuthorizationEnabled = value.legacyEligible;
  }, () => {}, () => {});

  assert.equal(legacyAuthorizationEnabled, false);
});

test("source loading remains current when Evaluate starts before it settles", async () => {
  const lifecycle = createPlanRequestLifecycle();
  const sourceRequest = deferred<string>();
  let sourceResult: string | null = null;
  let sourceControlsDisabled = true;
  let evaluateDisabled = false;

  const sourceToken = lifecycle.begin("source");
  const evaluateToken = lifecycle.begin("evaluate");

  sourceRequest.resolve("fixture-source");
  await settleRequest(
    lifecycle,
    sourceToken,
    sourceRequest.promise,
    (value) => { sourceResult = value; },
    () => {},
    (value) => { sourceControlsDisabled = value; },
  );
  assert.equal(sourceResult, "fixture-source");
  assert.equal(sourceControlsDisabled, false);

  assert.equal(lifecycle.finish(evaluateToken), true);
  evaluateDisabled = false;
  assert.equal(evaluateDisabled, false);
});

test("a stale source completion cannot unlock a newer source request", async () => {
  const lifecycle = createPlanRequestLifecycle();
  const oldSource = deferred<string>();
  const newSource = deferred<string>();
  let sourceResult: string | null = null;
  let sourceControlsDisabled = true;
  const oldToken = lifecycle.begin("source");
  const newToken = lifecycle.begin("source");

  oldSource.resolve("old-source");
  await settleRequest(
    lifecycle,
    oldToken,
    oldSource.promise,
    (value) => { sourceResult = value; },
    () => {},
    (value) => { sourceControlsDisabled = value; },
  );
  assert.equal(sourceResult, null);
  assert.equal(sourceControlsDisabled, true);

  newSource.resolve("new-source");
  await settleRequest(
    lifecycle,
    newToken,
    newSource.promise,
    (value) => { sourceResult = value; },
    () => {},
    (value) => { sourceControlsDisabled = value; },
  );
  assert.equal(sourceResult, "new-source");
  assert.equal(sourceControlsDisabled, false);
});

test("source switch recovers an invalidated evaluation control without releasing a newer one", async () => {
  const lifecycle = createPlanRequestLifecycle();
  const oldEvaluation = deferred<string>();
  let evaluateDisabled = true;
  const oldToken = lifecycle.begin("evaluate");

  // This is the ownership handoff performed by beginPlanRequest("source").
  lifecycle.invalidate("evaluate");
  evaluateDisabled = false;
  const sourceToken = lifecycle.begin("source");

  oldEvaluation.resolve("stale-evaluation");
  await settleRequest(
    lifecycle,
    oldToken,
    oldEvaluation.promise,
    () => {},
    () => {},
    (value) => { evaluateDisabled = value; },
  );
  assert.equal(evaluateDisabled, false);
  assert.equal(lifecycle.isCurrent(sourceToken), true);

  const currentEvaluation = deferred<string>();
  const currentToken = lifecycle.begin("evaluate");
  evaluateDisabled = true;
  oldEvaluation.resolve("still-stale");
  currentEvaluation.resolve("current-evaluation");
  await settleRequest(
    lifecycle,
    currentToken,
    currentEvaluation.promise,
    () => {},
    () => {},
    (value) => { evaluateDisabled = value; },
  );
  assert.equal(evaluateDisabled, false);
});
