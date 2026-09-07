import { keccak256, toUtf8Bytes, TypedDataEncoder, Wallet, verifyTypedData } from "ethers";

import type {
  EvidencePermitPayload,
  EvidencePermitTypedData,
  PositionEvidencePolicyDecision,
  PositionEvidenceV1,
  SignedEvidencePermit,
} from "../../shared/schemas/position-evidence.ts";
import type { TradeIntent, VerdictAction } from "../../shared/schemas/sentinel.ts";
import {
  canonicalStringify,
  computePositionEvidenceHash,
} from "./position-evidence.ts";
import { evaluateTradeIntent } from "./policy.ts";

export const EVIDENCE_PERMIT_SCHEMA_VERSION = "position-evidence-permit.v1" as const;
export const EVIDENCE_PERMIT_DOMAIN_NAME = "SentinelPositionEvidencePermit";
export const EVIDENCE_PERMIT_DOMAIN_VERSION = "1";
export const EVIDENCE_PERMIT_AUDIENCE = "sentinel-paper-executor";
export const EVIDENCE_PERMIT_VERIFYING_CONTRACT =
  "0x8004000000000000000000000000000000000002";
export const DEFAULT_EVIDENCE_PERMIT_TTL_SECONDS = 300;

// This key is intentionally public demo-only material. It must never be used for funds,
// custody or production signing; a production deployment must inject an isolated signer.
const DEMO_PERMIT_PRIVATE_KEY =
  "0x3000000000000000000000000000000000000000000000000000000000008004";
const DEMO_PERMIT_WALLET = new Wallet(DEMO_PERMIT_PRIVATE_KEY);
const HEX32_PATTERN = /^0x[0-9a-f]{64}$/i;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const SIGNATURE_PATTERN = /^0x[0-9a-f]{130}$/i;
const MAX_UINT256 = (1n << 256n) - 1n;

const POSITION_EVIDENCE_PERMIT_TYPES: Array<{ name: string; type: string }> = [
  { name: "schemaVersion", type: "string" },
  { name: "policyVersion", type: "string" },
  { name: "intentHash", type: "bytes32" },
  { name: "evidenceHash", type: "bytes32" },
  { name: "subjectChainId", type: "uint256" },
  { name: "subjectAccount", type: "address" },
  { name: "verdict", type: "string" },
  { name: "authorizedNotionalUsd", type: "string" },
  { name: "issuedAt", type: "uint256" },
  { name: "expiresAt", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "audience", type: "string" },
];

export type IssueEvidencePermitOptions = {
  now?: Date;
  ttl_seconds?: number;
  nonce?: string;
  audience?: string;
};

export type EvidencePermitIssueResult =
  | { status: "issued"; permit: SignedEvidencePermit }
  | {
      status: "blocked";
      reason: "policy_denied" | "invalid_evidence" | "invalid_permit_parameters";
    };

export type EvidencePermitCheck = {
  name: string;
  ok: boolean;
};

export type VerifyEvidencePermitRequest = {
  intent: TradeIntent;
  evidence: PositionEvidenceV1;
  permit: SignedEvidencePermit;
  requested_notional_usd?: string;
  expected_audience?: string;
  nonce_store?: Set<string>;
  now?: Date;
};

export type EvidencePermitVerification = {
  valid: boolean;
  executable: boolean;
  code: string;
  permit_hash: string;
  evidence_hash: string;
  checks: EvidencePermitCheck[];
};

function isUint256(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  try {
    return BigInt(value) <= MAX_UINT256;
  } catch {
    return false;
  }
}

function isAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value);
}

function isBytes32(value: string): boolean {
  return HEX32_PATTERN.test(value);
}

function isVerdict(value: string): value is VerdictAction {
  return value === "ALLOW" || value === "ALLOW_WITH_DOWNSIZE" || value === "DENY";
}

function isNonNegativeDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value);
}

function normalizeDecimal(value: string): { whole: string; fraction: string } | null {
  if (!isNonNegativeDecimal(value)) return null;
  const [wholePart, fractionPart = ""] = value.split(".");
  return {
    whole: wholePart.replace(/^0+(?=\d)/, ""),
    fraction: fractionPart.replace(/0+$/, ""),
  };
}

function compareNonNegativeDecimals(left: string, right: string): number | null {
  const normalizedLeft = normalizeDecimal(left);
  const normalizedRight = normalizeDecimal(right);
  if (!normalizedLeft || !normalizedRight) return null;

  if (normalizedLeft.whole.length !== normalizedRight.whole.length) {
    return normalizedLeft.whole.length > normalizedRight.whole.length ? 1 : -1;
  }
  if (normalizedLeft.whole !== normalizedRight.whole) {
    return normalizedLeft.whole > normalizedRight.whole ? 1 : -1;
  }

  const length = Math.max(normalizedLeft.fraction.length, normalizedRight.fraction.length);
  const leftFraction = normalizedLeft.fraction.padEnd(length, "0");
  const rightFraction = normalizedRight.fraction.padEnd(length, "0");
  if (leftFraction === rightFraction) return 0;
  return leftFraction > rightFraction ? 1 : -1;
}

function isValidIsoDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function buildDomain(chainId: number): EvidencePermitTypedData["domain"] {
  return {
    name: EVIDENCE_PERMIT_DOMAIN_NAME,
    version: EVIDENCE_PERMIT_DOMAIN_VERSION,
    chainId,
    verifyingContract: EVIDENCE_PERMIT_VERIFYING_CONTRACT,
  };
}

function buildPayloadMessage(payload: EvidencePermitPayload): EvidencePermitTypedData["message"] {
  return {
    schemaVersion: payload.schema_version,
    policyVersion: payload.policy_version,
    intentHash: payload.intent_hash,
    evidenceHash: payload.evidence_hash,
    subjectChainId: String(payload.subject_chain_id),
    subjectAccount: payload.subject_account,
    verdict: payload.verdict,
    authorizedNotionalUsd: payload.authorized_notional_usd,
    issuedAt: payload.issued_at,
    expiresAt: payload.expires_at,
    nonce: payload.nonce,
    audience: payload.audience,
  };
}

function buildTypedData(payload: EvidencePermitPayload): EvidencePermitTypedData {
  return {
    domain: buildDomain(payload.subject_chain_id),
    primaryType: "PositionEvidencePermit",
    types: {
      PositionEvidencePermit: POSITION_EVIDENCE_PERMIT_TYPES.map((field) => ({ ...field })),
    },
    message: buildPayloadMessage(payload),
  };
}

function hashTypedData(typedData: EvidencePermitTypedData): string {
  return TypedDataEncoder.hash(
    typedData.domain,
    { PositionEvidencePermit: typedData.types.PositionEvidencePermit },
    typedData.message,
  );
}

export function computeTradeIntentHash(intent: TradeIntent): string {
  return keccak256(toUtf8Bytes(canonicalStringify(intent)));
}

function isEvidenceAcceptable(
  evidence: PositionEvidenceV1,
  policy: PositionEvidencePolicyDecision,
): boolean {
  try {
    return (
      evidence.schema_version === "position_evidence.v1" &&
      evidence.quality.decision === "ACCEPT" &&
      evidence.gaps.length === 0 &&
      evidence.quality.reason_codes.length === 0 &&
      policy.evidence_quality === "ACCEPT" &&
      (policy.verdict === "ALLOW" || policy.verdict === "ALLOW_WITH_DOWNSIZE") &&
      computePositionEvidenceHash(evidence) === evidence.evidence_hash &&
      policy.evidence_hash === evidence.evidence_hash
    );
  } catch {
    return false;
  }
}

function buildPermitPayload(
  intent: TradeIntent,
  evidence: PositionEvidenceV1,
  policy: PositionEvidencePolicyDecision,
  options: IssueEvidencePermitOptions,
): EvidencePermitPayload | null {
  const now = options.now ?? new Date();
  const ttl = options.ttl_seconds ?? DEFAULT_EVIDENCE_PERMIT_TTL_SECONDS;
  const nonce = options.nonce ?? String(now.getTime());
  const audience = options.audience ?? EVIDENCE_PERMIT_AUDIENCE;
  const authorizedNotional = policy.allowed_notional_usd;

  if (
    !isValidIsoDate(now) ||
    !Number.isInteger(ttl) ||
    ttl <= 0 ||
    ttl > 3600 ||
    !isUint256(nonce) ||
    audience.trim().length === 0 ||
    !isNonNegativeDecimal(authorizedNotional) ||
    compareNonNegativeDecimals(authorizedNotional, "0") !== 1 ||
    !isAddress(evidence.subject.account) ||
    !Number.isSafeInteger(evidence.subject.chain_id) ||
    evidence.subject.chain_id <= 0
  ) {
    return null;
  }

  let evidenceHash: string;
  let intentHash: string;
  try {
    evidenceHash = computePositionEvidenceHash(evidence);
    intentHash = computeTradeIntentHash(intent);
  } catch {
    return null;
  }
  if (!isBytes32(evidenceHash) || !isBytes32(intentHash)) return null;

  const issuedAt = Math.floor(now.getTime() / 1000);
  return {
    schema_version: EVIDENCE_PERMIT_SCHEMA_VERSION,
    policy_version: policy.policy_version,
    intent_hash: intentHash,
    evidence_hash: evidenceHash,
    subject_chain_id: evidence.subject.chain_id,
    subject_account: evidence.subject.account.toLowerCase(),
    verdict: policy.verdict,
    authorized_notional_usd: authorizedNotional,
    issued_at: String(issuedAt),
    expires_at: String(issuedAt + ttl),
    nonce,
    audience,
  };
}

export function issueEvidencePermit(
  intent: TradeIntent,
  evidence: PositionEvidenceV1,
  policy: PositionEvidencePolicyDecision,
  options: IssueEvidencePermitOptions = {},
): EvidencePermitIssueResult {
  if (policy.verdict === "DENY") return { status: "blocked", reason: "policy_denied" };
  if (!isEvidenceAcceptable(evidence, policy)) {
    return { status: "blocked", reason: "invalid_evidence" };
  }

  const payload = buildPermitPayload(intent, evidence, policy, options);
  if (!payload) return { status: "blocked", reason: "invalid_permit_parameters" };

  const typedData = buildTypedData(payload);
  const permitHash = hashTypedData(typedData);
  const signature = DEMO_PERMIT_WALLET.signingKey.sign(permitHash).serialized;
  return {
    status: "issued",
    permit: {
      schema_version: EVIDENCE_PERMIT_SCHEMA_VERSION,
      payload,
      typed_data: typedData,
      permit_hash: permitHash,
      signature,
      signer: DEMO_PERMIT_WALLET.address,
      demo_only: true,
    },
  };
}

function check(name: string, ok: boolean): EvidencePermitCheck {
  return { name, ok };
}

export function verifyEvidencePermit(
  request: VerifyEvidencePermitRequest,
): EvidencePermitVerification {
  if (
    !request.permit ||
    typeof request.permit !== "object" ||
    !request.permit.payload ||
    typeof request.permit.payload !== "object"
  ) {
    return {
      valid: false,
      executable: false,
      code: "INVALID_PERMIT_SCHEMA",
      permit_hash: "",
      evidence_hash: "",
      checks: [check("schema_supported", false)],
    };
  }

  const { intent, evidence, permit } = request;
  const now = request.now ?? new Date();
  const expectedAudience = request.expected_audience ?? EVIDENCE_PERMIT_AUDIENCE;
  const nonceStore = request.nonce_store ?? new Set<string>();
  const requestedNotional = request.requested_notional_usd ?? intent.notional_usd;

  let expectedTypedData: EvidencePermitTypedData | null = null;
  let typedDataMatches = false;
  let permitHash = "";
  let signatureRecoverable = false;
  let recoveredSigner = "";
  let expectedIntentHash = "";
  let expectedEvidenceHash = "";
  try {
    expectedTypedData = buildTypedData(permit.payload);
    typedDataMatches = canonicalStringify(permit.typed_data) === canonicalStringify(expectedTypedData);
    permitHash = hashTypedData(permit.typed_data);
  } catch {
    typedDataMatches = false;
  }
  try {
    if (SIGNATURE_PATTERN.test(permit.signature)) {
      recoveredSigner = verifyTypedData(
        permit.typed_data.domain,
        { PositionEvidencePermit: permit.typed_data.types.PositionEvidencePermit },
        permit.typed_data.message,
        permit.signature,
      );
      signatureRecoverable = isAddress(recoveredSigner);
    }
  } catch {
    signatureRecoverable = false;
  }
  try {
    expectedIntentHash = computeTradeIntentHash(intent);
    expectedEvidenceHash = computePositionEvidenceHash(evidence);
  } catch {
    expectedIntentHash = "";
    expectedEvidenceHash = "";
  }

  const schemaSupported =
    permit.schema_version === EVIDENCE_PERMIT_SCHEMA_VERSION &&
    permit.payload.schema_version === EVIDENCE_PERMIT_SCHEMA_VERSION;
  const permitHashMatches = permitHash !== "" && permit.permit_hash === permitHash;
  const signerMatches =
    typeof permit.signer === "string" &&
    isAddress(permit.signer) &&
    permit.signer.toLowerCase() === DEMO_PERMIT_WALLET.address.toLowerCase();
  const signatureMatchesTrusted =
    signatureRecoverable && recoveredSigner.toLowerCase() === DEMO_PERMIT_WALLET.address.toLowerCase();
  const intentHashMatches =
    expectedIntentHash !== "" && permit.payload.intent_hash === expectedIntentHash;
  const evidenceHashMatches =
    expectedEvidenceHash !== "" &&
    permit.payload.evidence_hash === evidence.evidence_hash &&
    permit.payload.evidence_hash === expectedEvidenceHash;
  const subjectMatches =
    typeof permit.payload.subject_account === "string" &&
    typeof evidence.subject.account === "string" &&
    isAddress(permit.payload.subject_account) &&
    isAddress(evidence.subject.account) &&
    permit.payload.subject_chain_id === evidence.subject.chain_id &&
    permit.payload.subject_account.toLowerCase() === evidence.subject.account.toLowerCase();
  const audienceMatches = permit.payload.audience === expectedAudience;
  const qualityAccepted =
    evidence.quality.decision === "ACCEPT" &&
    evidence.gaps.length === 0 &&
    evidence.quality.reason_codes.length === 0;
  const verdictAllows = permit.payload.verdict === "ALLOW" || permit.payload.verdict === "ALLOW_WITH_DOWNSIZE";
  const authorizedAmountValid = isNonNegativeDecimal(permit.payload.authorized_notional_usd);
  const requestedWithinAuthorization =
    authorizedAmountValid &&
    compareNonNegativeDecimals(requestedNotional, permit.payload.authorized_notional_usd) !== null &&
    compareNonNegativeDecimals(requestedNotional, permit.payload.authorized_notional_usd)! <= 0;
  const issuedAt = isUint256(permit.payload.issued_at) ? Number(permit.payload.issued_at) : NaN;
  const expiresAt = isUint256(permit.payload.expires_at) ? Number(permit.payload.expires_at) : NaN;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const timestampsValid =
    Number.isSafeInteger(issuedAt) &&
    Number.isSafeInteger(expiresAt) &&
    expiresAt > issuedAt;
  const notBefore = timestampsValid && nowSeconds >= issuedAt;
  const notExpired = timestampsValid && nowSeconds <= expiresAt;
  const nonceAvailable = !nonceStore.has(permit.payload.nonce);

  const valid =
    schemaSupported &&
    typedDataMatches &&
    permitHashMatches &&
    signerMatches &&
    signatureMatchesTrusted &&
    intentHashMatches &&
    evidenceHashMatches &&
    subjectMatches &&
    audienceMatches &&
    qualityAccepted &&
    verdictAllows &&
    authorizedAmountValid &&
    timestampsValid;
  const executable =
    valid &&
    notBefore &&
    notExpired &&
    requestedWithinAuthorization &&
    nonceAvailable;

  let code = "EXECUTION_PERMITTED";
  if (!schemaSupported) code = "INVALID_PERMIT_SCHEMA";
  else if (!typedDataMatches) code = "PERMIT_PAYLOAD_MISMATCH";
  else if (!permitHashMatches) code = "PERMIT_HASH_MISMATCH";
  else if (!signatureRecoverable) code = "SIGNATURE_INVALID";
  else if (!signatureMatchesTrusted || !signerMatches) code = "SIGNER_UNTRUSTED";
  else if (!intentHashMatches) code = "INTENT_HASH_MISMATCH";
  else if (!evidenceHashMatches) code = "EVIDENCE_HASH_MISMATCH";
  else if (!subjectMatches) code = "SUBJECT_MISMATCH";
  else if (!audienceMatches) code = "AUDIENCE_MISMATCH";
  else if (!qualityAccepted) code = "EVIDENCE_QUALITY_DENIED";
  else if (!timestampsValid) code = "INVALID_PERMIT_TIMESTAMPS";
  else if (!notBefore) code = "PERMIT_NOT_YET_ACTIVE";
  else if (!notExpired) code = "PERMIT_EXPIRED";
  else if (!verdictAllows) code = "VERDICT_DENIED";
  else if (!authorizedAmountValid) code = "INVALID_AUTHORIZATION";
  else if (!requestedWithinAuthorization) code = "REQUEST_EXCEEDS_AUTHORIZATION";
  else if (!nonceAvailable) code = "NONCE_ALREADY_USED";

  if (executable) nonceStore.add(permit.payload.nonce);

  return {
    valid,
    executable,
    code,
    permit_hash: permit.permit_hash,
    evidence_hash: permit.payload.evidence_hash,
    checks: [
      check("schema_supported", schemaSupported),
      check("typed_data_matches_payload", typedDataMatches),
      check("permit_hash_matches", permitHashMatches),
      check("signature_recoverable", signatureRecoverable),
      check("trusted_signer_matches", signatureMatchesTrusted && signerMatches),
      check("intent_hash_matches", intentHashMatches),
      check("evidence_hash_matches", evidenceHashMatches),
      check("subject_matches_evidence", subjectMatches),
      check("audience_matches", audienceMatches),
      check("evidence_quality_accepted", qualityAccepted),
      check("permit_not_expired", notExpired),
      check("requested_notional_within_authorization", requestedWithinAuthorization),
      check("nonce_available", nonceAvailable),
    ],
  };
}
