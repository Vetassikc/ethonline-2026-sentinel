import { TypedDataEncoder, verifyTypedData } from "ethers";

import type { ExposureAgentId } from "../../shared/schemas/exposure-plan.ts";
import type { ExposureSourceProvenance } from "./exposure-plan-engine.ts";
import {
  getDemoExposureSignerAddress,
  isTrustedDemoExposureSigner,
  signDemoExposureDigest,
} from "./exposure-permit.ts";

export const EXPOSURE_PLAN_PERMIT_DOMAIN_NAME = "SentinelExposurePlanPermit";
export const EXPOSURE_PLAN_PERMIT_DOMAIN_VERSION = "1";
export const EXPOSURE_PLAN_PERMIT_AUDIENCE = "sentinel-exposure-plan-paper-executor" as const;
export const EXPOSURE_PLAN_PERMIT_CHAIN_ID = 8453;
export const EXPOSURE_PLAN_PERMIT_VERIFYING_CONTRACT =
  "0x8004000000000000000000000000000000000004";
export const DEFAULT_EXPOSURE_PLAN_PERMIT_TTL_SECONDS = 300;

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const SIGNATURE_PATTERN = /^0x[0-9a-f]{130}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const GRAPH_HASH_PATTERN = /^(?:0x[0-9a-f]{64}|[A-Za-z0-9:_-]{1,128})$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const EVIDENCE_REFERENCE_PATTERN = /^exposure_[0-9a-f]{32}$/;
const UINT256_MAX = (1n << 256n) - 1n;

const EXPOSURE_PLAN_PERMIT_FIELDS: Array<{ name: string; type: string }> = [
  { name: "schemaVersion", type: "string" },
  { name: "planHash", type: "string" },
  { name: "agentId", type: "string" },
  { name: "account", type: "address" },
  { name: "policyVersion", type: "string" },
  { name: "evidenceRef", type: "string" },
  { name: "graphHash", type: "string" },
  { name: "reservationId", type: "string" },
  { name: "sessionId", type: "string" },
  { name: "mode", type: "string" },
  { name: "sourceProvenance", type: "string" },
  { name: "runtimeGeneration", type: "string" },
  { name: "issuedAt", type: "uint256" },
  { name: "expiresAt", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "audience", type: "string" },
];

export type ExposurePlanPermitPayload = {
  schema_version: "sentinel-exposure-plan-permit.v1";
  plan_hash: string;
  agent_id: ExposureAgentId;
  account: string;
  policy_version: string;
  evidence_ref: string;
  graph_hash: string;
  reservation_id: string;
  session_id: string;
  mode: "live" | "what_if";
  source_provenance: ExposureSourceProvenance;
  runtime_generation: string;
  issued_at: number;
  expires_at: number;
  nonce: string;
  audience: typeof EXPOSURE_PLAN_PERMIT_AUDIENCE;
};

export type ExposurePlanPermitTypedData = {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  primaryType: "ExposurePlanPermit";
  types: { ExposurePlanPermit: Array<{ name: string; type: string }> };
  message: Record<string, string>;
};

export type SignedExposurePlanPermit = {
  schema_version: "sentinel-exposure-plan-permit.v1";
  payload: ExposurePlanPermitPayload;
  typed_data: ExposurePlanPermitTypedData;
  permit_hash: string;
  signature: string;
  signer: string;
  demo_only: true;
};

export type ExposurePlanPermitVerification = {
  cryptographically_valid: boolean;
  current_execution_eligibility: "UNVERIFIED_UNTIL_FRESH_RECHECK";
  code: string;
  permit_hash: string;
  checks: Array<{ name: string; ok: boolean }>;
};

export type IssueExposurePlanPermitInput = Omit<ExposurePlanPermitPayload, "schema_version" | "issued_at" | "expires_at" | "nonce" | "audience">
  & { now?: Date; ttl_seconds?: number; nonce?: string };

function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

function isUint256(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return false;
  try {
    return BigInt(value) <= UINT256_MAX;
  } catch {
    return false;
  }
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function check(name: string, ok: boolean): { name: string; ok: boolean } {
  return { name, ok };
}

function buildDomain(): ExposurePlanPermitTypedData["domain"] {
  return {
    name: EXPOSURE_PLAN_PERMIT_DOMAIN_NAME,
    version: EXPOSURE_PLAN_PERMIT_DOMAIN_VERSION,
    chainId: EXPOSURE_PLAN_PERMIT_CHAIN_ID,
    verifyingContract: EXPOSURE_PLAN_PERMIT_VERIFYING_CONTRACT,
  };
}

function buildMessage(payload: ExposurePlanPermitPayload): Record<string, string> {
  return {
    schemaVersion: payload.schema_version,
    planHash: payload.plan_hash,
    agentId: payload.agent_id,
    account: payload.account,
    policyVersion: payload.policy_version,
    evidenceRef: payload.evidence_ref,
    graphHash: payload.graph_hash,
    reservationId: payload.reservation_id,
    sessionId: payload.session_id,
    mode: payload.mode,
    sourceProvenance: payload.source_provenance,
    runtimeGeneration: payload.runtime_generation,
    issuedAt: String(payload.issued_at),
    expiresAt: String(payload.expires_at),
    nonce: payload.nonce,
    audience: payload.audience,
  };
}

function buildTypedData(payload: ExposurePlanPermitPayload): ExposurePlanPermitTypedData {
  return {
    domain: buildDomain(),
    primaryType: "ExposurePlanPermit",
    types: { ExposurePlanPermit: EXPOSURE_PLAN_PERMIT_FIELDS.map((field) => ({ ...field })) },
    message: buildMessage(payload),
  };
}

function hashTypedData(typedData: ExposurePlanPermitTypedData): string {
  return TypedDataEncoder.hash(
    typedData.domain,
    { ExposurePlanPermit: typedData.types.ExposurePlanPermit },
    typedData.message,
  );
}

function validPayload(payload: ExposurePlanPermitPayload): boolean {
  return typeof payload.schema_version === "string"
    && typeof payload.plan_hash === "string"
    && typeof payload.agent_id === "string"
    && typeof payload.account === "string"
    && typeof payload.policy_version === "string"
    && typeof payload.evidence_ref === "string"
    && typeof payload.graph_hash === "string"
    && typeof payload.reservation_id === "string"
    && typeof payload.session_id === "string"
    && typeof payload.mode === "string"
    && typeof payload.source_provenance === "string"
    && typeof payload.runtime_generation === "string"
    && typeof payload.audience === "string"
    && payload.schema_version === "sentinel-exposure-plan-permit.v1"
    && HASH_PATTERN.test(payload.plan_hash)
    && (payload.agent_id === "agent_a" || payload.agent_id === "agent_b")
    && isAddress(payload.account)
    && payload.policy_version.length > 0
    && payload.policy_version.length <= 128
    && EVIDENCE_REFERENCE_PATTERN.test(payload.evidence_ref)
    && GRAPH_HASH_PATTERN.test(payload.graph_hash)
    && OPAQUE_ID_PATTERN.test(payload.reservation_id)
    && OPAQUE_ID_PATTERN.test(payload.session_id)
    && (payload.mode === "live" || payload.mode === "what_if")
    && (payload.source_provenance === "LIVE_SOURCE"
      || payload.source_provenance === "FIXTURE"
      || payload.source_provenance === "REPLAY"
      || payload.source_provenance === "MODELED")
    && OPAQUE_ID_PATTERN.test(payload.runtime_generation)
    && Number.isSafeInteger(payload.issued_at)
    && Number.isSafeInteger(payload.expires_at)
    && payload.expires_at > payload.issued_at
    && isUint256(payload.nonce)
    && payload.audience === EXPOSURE_PLAN_PERMIT_AUDIENCE;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function issueExposurePlanPermit(
  input: IssueExposurePlanPermitInput,
): { status: "issued"; permit: SignedExposurePlanPermit } | { status: "blocked"; reason: string } {
  const now = input.now ?? new Date();
  const ttl = input.ttl_seconds ?? DEFAULT_EXPOSURE_PLAN_PERMIT_TTL_SECONDS;
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + ttl;
  const payload: ExposurePlanPermitPayload = {
    schema_version: "sentinel-exposure-plan-permit.v1",
    plan_hash: input.plan_hash,
    agent_id: input.agent_id,
    account: input.account.toLowerCase(),
    policy_version: input.policy_version,
    evidence_ref: input.evidence_ref,
    graph_hash: input.graph_hash,
    reservation_id: input.reservation_id,
    session_id: input.session_id,
    mode: input.mode,
    source_provenance: input.source_provenance,
    runtime_generation: input.runtime_generation,
    issued_at: issuedAt,
    expires_at: expiresAt,
    nonce: input.nonce ?? String(now.getTime()),
    audience: EXPOSURE_PLAN_PERMIT_AUDIENCE,
  };
  if (
    !isValidDate(now)
    || !Number.isSafeInteger(ttl)
    || ttl <= 0
    || ttl > 3600
    || !validPayload(payload)
  ) {
    return { status: "blocked", reason: "invalid_permit_parameters" };
  }
  try {
    const typedData = buildTypedData(payload);
    const permitHash = hashTypedData(typedData);
    return {
      status: "issued",
      permit: {
        schema_version: "sentinel-exposure-plan-permit.v1",
        payload,
        typed_data: typedData,
        permit_hash: permitHash,
        signature: signDemoExposureDigest(permitHash),
        signer: getDemoExposureSignerAddress(),
        demo_only: true,
      },
    };
  } catch {
    return { status: "blocked", reason: "invalid_permit_parameters" };
  }
}

export function validateSignedExposurePlanPermit(input: unknown):
  | { ok: true; permit: SignedExposurePlanPermit }
  | { ok: false; details: string[] } {
  if (!isRecord(input) || !exactKeys(input, ["schema_version", "payload", "typed_data", "permit_hash", "signature", "signer", "demo_only"])) {
    return { ok: false, details: ["permit_shape"] };
  }
  if (
    input.schema_version !== "sentinel-exposure-plan-permit.v1"
    || input.demo_only !== true
    || typeof input.permit_hash !== "string"
    || !/^0x[0-9a-f]{64}$/i.test(input.permit_hash)
    || typeof input.signature !== "string"
    || !SIGNATURE_PATTERN.test(input.signature)
    || !isAddress(input.signer)
    || !isRecord(input.payload)
    || !isRecord(input.typed_data)
  ) {
    return { ok: false, details: ["permit_fields"] };
  }
  const payload = input.payload;
  if (!exactKeys(payload, ["schema_version", "plan_hash", "agent_id", "account", "policy_version", "evidence_ref", "graph_hash", "reservation_id", "session_id", "mode", "source_provenance", "runtime_generation", "issued_at", "expires_at", "nonce", "audience"])) {
    return { ok: false, details: ["payload_keys"] };
  }
  const typedData = input.typed_data;
  if (!exactKeys(typedData, ["domain", "primaryType", "types", "message"]) || !isRecord(typedData.domain) || !isRecord(typedData.types) || !isRecord(typedData.message)) {
    return { ok: false, details: ["typed_data_shape"] };
  }
  const typedTypes = typedData.types.ExposurePlanPermit;
  if (!Array.isArray(typedTypes) || typedTypes.length !== EXPOSURE_PLAN_PERMIT_FIELDS.length) {
    return { ok: false, details: ["typed_data_types"] };
  }
  const candidate = input as unknown as SignedExposurePlanPermit;
  if (!validPayload(candidate.payload)) return { ok: false, details: ["payload_values"] };
  return { ok: true, permit: candidate };
}

export function verifyExposurePlanPermit(options: {
  permit: unknown;
  now?: Date;
}): ExposurePlanPermitVerification {
  const invalidResult = (code: string, checks: Array<{ name: string; ok: boolean }>): ExposurePlanPermitVerification => ({
    cryptographically_valid: false,
    current_execution_eligibility: "UNVERIFIED_UNTIL_FRESH_RECHECK",
    code,
    permit_hash: "",
    checks,
  });
  const validated = validateSignedExposurePlanPermit(options.permit);
  if (!validated.ok) return invalidResult("INVALID_PERMIT_SCHEMA", [check("schema_supported", false)]);
  const permit = validated.permit;
  const now = options.now ?? new Date();
  let typedDataMatches = false;
  let hashMatches = false;
  let signatureRecoverable = false;
  let signerMatches = false;
  try {
    const expected = buildTypedData(permit.payload);
    typedDataMatches = JSON.stringify(permit.typed_data) === JSON.stringify(expected);
    const calculated = hashTypedData(permit.typed_data);
    hashMatches = calculated === permit.permit_hash;
    const recovered = verifyTypedData(
      permit.typed_data.domain,
      { ExposurePlanPermit: permit.typed_data.types.ExposurePlanPermit },
      permit.typed_data.message,
      permit.signature,
    );
    signatureRecoverable = isAddress(recovered);
    signerMatches = isTrustedDemoExposureSigner(recovered) && isTrustedDemoExposureSigner(permit.signer);
  } catch {
    typedDataMatches = false;
  }
  const timestampsValid = validPayload(permit.payload);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const notBefore = timestampsValid && nowSeconds >= permit.payload.issued_at;
  const notExpired = timestampsValid && nowSeconds <= permit.payload.expires_at;
  const cryptographicallyValid = typedDataMatches
    && hashMatches
    && signatureRecoverable
    && signerMatches
    && timestampsValid
    && notBefore
    && notExpired;
  let code = "PERMIT_VALID";
  if (!typedDataMatches) code = "PERMIT_PAYLOAD_MISMATCH";
  else if (!hashMatches) code = "PERMIT_HASH_MISMATCH";
  else if (!signatureRecoverable || !signerMatches) code = "SIGNER_UNTRUSTED";
  else if (!timestampsValid) code = "INVALID_PERMIT_PAYLOAD";
  else if (!notBefore) code = "PERMIT_NOT_YET_ACTIVE";
  else if (!notExpired) code = "PERMIT_EXPIRED";
  return {
    cryptographically_valid: cryptographicallyValid,
    current_execution_eligibility: "UNVERIFIED_UNTIL_FRESH_RECHECK",
    code,
    permit_hash: permit.permit_hash,
    checks: [
      check("schema_supported", true),
      check("typed_data_matches_payload", typedDataMatches),
      check("permit_hash_matches", hashMatches),
      check("signature_recoverable", signatureRecoverable),
      check("trusted_signer_matches", signerMatches),
      check("permit_not_before", notBefore),
      check("permit_not_expired", notExpired),
    ],
  };
}
