import type { PositionEvidencePolicyDecision, PositionEvidenceV1 } from "../../shared/schemas/position-evidence.ts";
import type { TradeIntent } from "../../shared/schemas/sentinel.ts";
import { evaluateTradeIntent } from "./policy.ts";

const EVIDENCE_POLICY_VERSION = "position-evidence-gate-v1";
const EVIDENCE_HASH_PATTERN = /^0x[0-9a-f]{64}$/;

function invalidEvidenceReasons(evidence: PositionEvidenceV1): string[] {
  const reasons: string[] = [];
  if (evidence.schema_version !== "position_evidence.v1") {
    reasons.push("unsupported_schema_version");
  }
  if (!EVIDENCE_HASH_PATTERN.test(evidence.evidence_hash)) {
    reasons.push("missing_or_malformed_evidence_hash");
  }
  if (
    evidence.quality.decision === "ACCEPT"
    && (evidence.gaps.length > 0 || evidence.quality.reason_codes.length > 0)
  ) {
    reasons.push("quality_accepts_with_gaps");
  }
  return reasons;
}

function buildDecision(
  intent: TradeIntent,
  evidence: PositionEvidenceV1,
  baselineVerdict: ReturnType<typeof evaluateTradeIntent>,
  verdict: PositionEvidencePolicyDecision["verdict"],
  reasonCode: string,
  reasonDetail: string[],
  allowedNotionalUsd: string,
): PositionEvidencePolicyDecision {
  return {
    policy_version: EVIDENCE_POLICY_VERSION,
    evidence_hash: evidence.evidence_hash,
    evidence_quality: evidence.quality.decision,
    baseline_verdict: baselineVerdict.verdict,
    verdict,
    reason_code: reasonCode,
    reason_detail: reasonDetail,
    requested_notional_usd: intent.notional_usd,
    allowed_notional_usd: allowedNotionalUsd,
  };
}

/** Apply the evidence gate without weakening the existing deterministic trade policy. */
export function evaluatePositionEvidencePolicy(
  intent: TradeIntent,
  evidence: PositionEvidenceV1,
): PositionEvidencePolicyDecision {
  const baselineVerdict = evaluateTradeIntent(intent);
  const invalidReasons = invalidEvidenceReasons(evidence);
  if (invalidReasons.length > 0) {
    return buildDecision(
      intent,
      evidence,
      baselineVerdict,
      "DENY",
      "INVALID_POSITION_EVIDENCE",
      invalidReasons,
      "0.00",
    );
  }

  if (evidence.quality.decision !== "ACCEPT") {
    return buildDecision(
      intent,
      evidence,
      baselineVerdict,
      "DENY",
      "POSITION_EVIDENCE_BLOCKED",
      [
        "evidence_quality_denied",
        ...(evidence.quality.reason_codes.length > 0
          ? evidence.quality.reason_codes
          : ["quality_denied_without_reason"]),
      ],
      "0.00",
    );
  }

  return buildDecision(
    intent,
    evidence,
    baselineVerdict,
    baselineVerdict.verdict,
    baselineVerdict.reason_code,
    ["position_evidence_accepted", ...baselineVerdict.reason_detail],
    baselineVerdict.allowed_notional_usd,
  );
}
