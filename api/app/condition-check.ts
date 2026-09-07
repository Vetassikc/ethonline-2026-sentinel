import type { ExposureEvaluation } from "../../shared/schemas/exposure-graph.ts";
import { parseFixedUnits } from "./exposure-policy.ts";
import {
  verifyExposurePermit,
  type SignedExposurePermit,
  type ExposurePermitVerification,
} from "./exposure-permit.ts";
import type { ExposureRuntimeState } from "./exposure-service.ts";

const NON_BLOCKING_GAPS = new Set(["usd_valuation_unavailable", "stale_oracle_price"]);

export type ExposureConditionCheck = {
  executable: boolean;
  code: string;
  checks: Array<{ name: string; ok: boolean }>;
};

export type ExposureRefreshResult =
  | ExposureEvaluation
  | { status: "blocked"; code: string };

export type ExposureExecutionResult = {
  executable: boolean;
  code: string;
  permit_hash: string;
  nonce: string;
};

function check(name: string, ok: boolean): { name: string; ok: boolean } {
  return { name, ok };
}

function sameUnits(left: string, right: string): boolean {
  try {
    return parseFixedUnits(left) === parseFixedUnits(right);
  } catch {
    return false;
  }
}

function requiredSourceIsAvailable(evaluation: ExposureEvaluation): boolean {
  return evaluation.graph.source_status === "ok"
    && evaluation.graph.gaps.every((gap) => NON_BLOCKING_GAPS.has(gap));
}

function baseFailure(
  permit: SignedExposurePermit,
  code: string,
  checks: Array<{ name: string; ok: boolean }>,
): ExposureConditionCheck {
  return { executable: false, code, checks };
}

export function checkExposurePermitConditions(
  permit: SignedExposurePermit,
  currentEvaluation: ExposureEvaluation,
  now = new Date(currentEvaluation.created_at),
): ExposureConditionCheck {
  const verification: ExposurePermitVerification = verifyExposurePermit({
    request: currentEvaluation.request,
    permit,
    now,
  });
  if (!verification.valid || !verification.executable) {
    return baseFailure(permit, verification.code, verification.checks);
  }

  const subjectMatches =
    currentEvaluation.graph.subject.account.toLowerCase() === permit.payload.account.toLowerCase()
    && currentEvaluation.graph.subject.chain_id === permit.payload.chain_id;
  const policyMatches =
    currentEvaluation.policy.policy_version === permit.payload.policy_version
    && currentEvaluation.policy.unit === permit.payload.unit
    && sameUnits(currentEvaluation.policy.dependency_cap_units, permit.payload.dependency_cap_units);
  const sourceAvailable = requiredSourceIsAvailable(currentEvaluation);
  const currentAuthorization = sameUnits(
    currentEvaluation.policy.allowed_units,
    permit.payload.authorized_units,
  ) || (() => {
    try {
      return parseFixedUnits(currentEvaluation.policy.allowed_units)
        >= parseFixedUnits(permit.payload.authorized_units);
    } catch {
      return false;
    }
  })();
  const verdictAllows = currentEvaluation.policy.verdict !== "DENY";
  const checks = [
    check("signature_and_request_valid", true),
    check("subject_matches", subjectMatches),
    check("policy_bindings_match", policyMatches),
    check("required_source_available", sourceAvailable),
    check("current_policy_allows", verdictAllows),
    check("current_headroom_sufficient", currentAuthorization),
  ];

  if (!subjectMatches) return baseFailure(permit, "CURRENT_SUBJECT_MISMATCH", checks);
  if (!policyMatches) return baseFailure(permit, "POLICY_VERSION_MISMATCH", checks);
  if (!sourceAvailable) return baseFailure(permit, "CURRENT_SOURCE_UNAVAILABLE", checks);
  if (!currentAuthorization) return baseFailure(permit, "CURRENT_HEADROOM_INSUFFICIENT", checks);
  if (!verdictAllows) return baseFailure(permit, "CURRENT_POLICY_DENIED", checks);
  return { executable: true, code: "CONDITIONS_OK", checks };
}

export async function executeExposurePermit(options: {
  request: Parameters<typeof verifyExposurePermit>[0]["request"];
  permit: SignedExposurePermit;
  state: ExposureRuntimeState;
  refresh: () => Promise<ExposureRefreshResult>;
  now?: Date;
}): Promise<ExposureExecutionResult> {
  const nonce = options.permit.payload.nonce;
  const account = options.permit.payload.account.toLowerCase();
  if (options.state.consumed_nonces.has(nonce)) {
    return {
      executable: false,
      code: "NONCE_ALREADY_USED",
      permit_hash: options.permit.permit_hash,
      nonce,
    };
  }
  if (options.state.pending_accounts.has(account)) {
    return {
      executable: false,
      code: "ACCOUNT_ACTION_PENDING",
      permit_hash: options.permit.permit_hash,
      nonce,
    };
  }

  options.state.pending_accounts.add(account);
  try {
    const now = options.now ?? new Date();
    const verification = verifyExposurePermit({
      request: options.request,
      permit: options.permit,
      now,
    });
    if (!verification.executable) {
      return {
        executable: false,
        code: verification.code,
        permit_hash: options.permit.permit_hash,
        nonce,
      };
    }

    let refreshed: ExposureRefreshResult;
    try {
      refreshed = await options.refresh();
    } catch {
      return {
        executable: false,
        code: "REFRESH_FAILED",
        permit_hash: options.permit.permit_hash,
        nonce,
      };
    }
    if (!("schema_version" in refreshed)) {
      return {
        executable: false,
        code: refreshed.code,
        permit_hash: options.permit.permit_hash,
        nonce,
      };
    }

    const conditions = checkExposurePermitConditions(options.permit, refreshed, now);
    if (!conditions.executable) {
      return {
        executable: false,
        code: conditions.code,
        permit_hash: options.permit.permit_hash,
        nonce,
      };
    }
    if (options.state.consumed_nonces.has(nonce)) {
      return {
        executable: false,
        code: "NONCE_ALREADY_USED",
        permit_hash: options.permit.permit_hash,
        nonce,
      };
    }
    options.state.consumed_nonces.add(nonce);
    return {
      executable: true,
      code: "PAPER_EXECUTED",
      permit_hash: options.permit.permit_hash,
      nonce,
    };
  } finally {
    options.state.pending_accounts.delete(account);
  }
}
