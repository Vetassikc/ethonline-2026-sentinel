import { keccak256, toUtf8Bytes, TypedDataEncoder, Wallet, verifyTypedData } from "ethers";

import type {
  ExposureEvaluation,
  ExposurePermitPayload,
  ExposureRequest,
} from "../../shared/schemas/exposure-graph.ts";
import { parseFixedUnits } from "./exposure-policy.ts";

export const EXPOSURE_PERMIT_DOMAIN_NAME = "SentinelExposurePermit";
export const EXPOSURE_PERMIT_DOMAIN_VERSION = "1";
export const EXPOSURE_PERMIT_AUDIENCE = "sentinel-exposure-paper-executor";
export const EXPOSURE_PERMIT_VERIFYING_CONTRACT =
  "0x8004000000000000000000000000000000000003";
export const DEFAULT_EXPOSURE_PERMIT_TTL_SECONDS = 300;

// Public demo-only material. It is intentionally isolated from every application account
// and must never be used for custody, funds or production signing.
const DEMO_EXPOSURE_PERMIT_PRIVATE_KEY =
  "0x3000000000000000000000000000000000000000000000000000000000008005";
const DEMO_EXPOSURE_PERMIT_WALLET = new Wallet(DEMO_EXPOSURE_PERMIT_PRIVATE_KEY);
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/i;
const SIGNATURE_PATTERN = /^0x[0-9a-f]{130}$/i;
const UINT256_MAX = (1n << 256n) - 1n;

const EXPOSURE_PERMIT_FIELDS: Array<{ name: string; type: string }> = [
  { name: "schemaVersion", type: "string" },
  { name: "action", type: "string" },
  { name: "asset", type: "string" },
  { name: "unit", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "account", type: "address" },
  { name: "authorizedUnits", type: "string" },
  { name: "dependencyCapUnits", type: "string" },
  { name: "policyVersion", type: "string" },
  { name: "graphHash", type: "bytes32" },
  { name: "snapshotBlock", type: "uint256" },
  { name: "issuedAt", type: "uint256" },
  { name: "expiresAt", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "audience", type: "string" },
];

export type ExposurePermitTypedData = {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  primaryType: "ExposurePermit";
  types: { ExposurePermit: Array<{ name: string; type: string }> };
  message: Record<string, string>;
};

export type SignedExposurePermit = {
  schema_version: "sentinel-exposure-permit.v1";
  payload: ExposurePermitPayload;
  typed_data: ExposurePermitTypedData;
  permit_hash: string;
  signature: string;
  signer: string;
  demo_only: true;
};

export type IssueExposurePermitOptions = {
  now?: Date;
  ttl_seconds?: number;
  nonce?: string;
  audience?: string;
};

export type ExposurePermitIssueResult =
  | { status: "issued"; permit: SignedExposurePermit }
  | {
    status: "blocked";
    reason: "policy_denied" | "invalid_evaluation" | "invalid_permit_parameters";
  };

export type ExposurePermitCheck = { name: string; ok: boolean };

export type VerifyExposurePermitRequest = {
  request: ExposureRequest;
  permit: SignedExposurePermit;
  expected_audience?: string;
  now?: Date;
};

export type ExposurePermitVerification = {
  valid: boolean;
  executable: boolean;
  code: string;
  permit_hash: string;
  graph_hash: string;
  checks: ExposurePermitCheck[];
};

function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

function isBytes32(value: unknown): value is string {
  return typeof value === "string" && BYTES32_PATTERN.test(value);
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

function buildDomain(chainId: number): ExposurePermitTypedData["domain"] {
  return {
    name: EXPOSURE_PERMIT_DOMAIN_NAME,
    version: EXPOSURE_PERMIT_DOMAIN_VERSION,
    chainId,
    verifyingContract: EXPOSURE_PERMIT_VERIFYING_CONTRACT,
  };
}

function buildMessage(payload: ExposurePermitPayload): ExposurePermitTypedData["message"] {
  return {
    schemaVersion: payload.schema_version,
    action: payload.action,
    asset: payload.asset,
    unit: payload.unit,
    chainId: String(payload.chain_id),
    account: payload.account,
    authorizedUnits: payload.authorized_units,
    dependencyCapUnits: payload.dependency_cap_units,
    policyVersion: payload.policy_version,
    graphHash: payload.graph_hash,
    snapshotBlock: String(payload.snapshot_block),
    issuedAt: String(payload.issued_at),
    expiresAt: String(payload.expires_at),
    nonce: payload.nonce,
    audience: payload.audience,
  };
}

function buildTypedData(payload: ExposurePermitPayload): ExposurePermitTypedData {
  return {
    domain: buildDomain(payload.chain_id),
    primaryType: "ExposurePermit",
    types: { ExposurePermit: EXPOSURE_PERMIT_FIELDS.map((field) => ({ ...field })) },
    message: buildMessage(payload),
  };
}

function hashTypedData(typedData: ExposurePermitTypedData): string {
  return TypedDataEncoder.hash(
    typedData.domain,
    { ExposurePermit: typedData.types.ExposurePermit },
    typedData.message,
  );
}

function compareUnits(left: string, right: string): number | null {
  try {
    const leftValue = parseFixedUnits(left);
    const rightValue = parseFixedUnits(right);
    return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
  } catch {
    return null;
  }
}

function buildPayload(
  evaluation: ExposureEvaluation,
  options: IssueExposurePermitOptions,
): ExposurePermitPayload | null {
  const now = options.now ?? new Date();
  const ttl = options.ttl_seconds ?? DEFAULT_EXPOSURE_PERMIT_TTL_SECONDS;
  const nonce = options.nonce ?? String(now.getTime());
  const audience = options.audience ?? EXPOSURE_PERMIT_AUDIENCE;
  const account = evaluation.graph.subject.account.toLowerCase();
  const chainId = evaluation.graph.subject.chain_id;
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + ttl;
  const authorizedUnits = evaluation.policy.allowed_units;
  const capComparison = compareUnits(evaluation.policy.dependency_cap_units, authorizedUnits);

  if (
    !isValidDate(now)
    || evaluation.schema_version !== "exposure_evaluation.v1"
    || evaluation.request.schema_version !== "sentinel-exposure-buy.v1"
    || evaluation.request.action !== "BUY_EXPOSURE"
    || evaluation.request.asset !== "wstETH"
    || evaluation.request.unit !== "wstETH"
    || evaluation.policy.verdict === "DENY"
    || !isAddress(account)
    || !Number.isSafeInteger(chainId)
    || chainId <= 0
    || !Number.isSafeInteger(evaluation.graph.source.block.number)
    || evaluation.graph.source.block.number <= 0
    || !isBytes32(evaluation.graph.graph_hash)
    || !Number.isInteger(ttl)
    || ttl <= 0
    || ttl > 3600
    || !isUint256(nonce)
    || audience.trim().length === 0
    || compareUnits(authorizedUnits, "0") !== 1
    || capComparison === null
    || capComparison < 0
  ) {
    return null;
  }

  return {
    schema_version: "sentinel-exposure-permit.v1",
    action: "BUY_EXPOSURE",
    asset: "wstETH",
    unit: "wstETH",
    chain_id: chainId,
    account,
    authorized_units: authorizedUnits,
    dependency_cap_units: evaluation.policy.dependency_cap_units,
    policy_version: evaluation.policy.policy_version,
    graph_hash: evaluation.graph.graph_hash,
    snapshot_block: evaluation.graph.source.block.number,
    issued_at: issuedAt,
    expires_at: expiresAt,
    nonce,
    audience,
  };
}

export function issueExposurePermit(
  evaluation: ExposureEvaluation,
  options: IssueExposurePermitOptions = {},
): ExposurePermitIssueResult {
  if (evaluation.policy.verdict === "DENY") return { status: "blocked", reason: "policy_denied" };
  const payload = buildPayload(evaluation, options);
  if (!payload) return { status: "blocked", reason: "invalid_evaluation" };

  let typedData: ExposurePermitTypedData;
  let permitHash: string;
  try {
    typedData = buildTypedData(payload);
    permitHash = hashTypedData(typedData);
  } catch {
    return { status: "blocked", reason: "invalid_permit_parameters" };
  }
  const signature = DEMO_EXPOSURE_PERMIT_WALLET.signingKey.sign(permitHash).serialized;
  return {
    status: "issued",
    permit: {
      schema_version: "sentinel-exposure-permit.v1",
      payload,
      typed_data: typedData,
      permit_hash: permitHash,
      signature,
      signer: DEMO_EXPOSURE_PERMIT_WALLET.address,
      demo_only: true,
    },
  };
}

function check(name: string, ok: boolean): ExposurePermitCheck {
  return { name, ok };
}

export function verifyExposurePermit(
  request: VerifyExposurePermitRequest,
): ExposurePermitVerification {
  if (
    !request
    || !request.permit
    || typeof request.permit !== "object"
    || !request.permit.payload
    || typeof request.permit.payload !== "object"
  ) {
    return {
      valid: false,
      executable: false,
      code: "INVALID_PERMIT_SCHEMA",
      permit_hash: "",
      graph_hash: "",
      checks: [check("schema_supported", false)],
    };
  }
  const permit = request.permit;
  const now = request.now ?? new Date();
  const expectedAudience = request.expected_audience ?? EXPOSURE_PERMIT_AUDIENCE;
  let typedDataMatches = false;
  let permitHash = "";
  let signatureRecoverable = false;
  let recoveredSigner = "";
  try {
    const expectedTypedData = buildTypedData(permit.payload);
    typedDataMatches = JSON.stringify(permit.typed_data) === JSON.stringify(expectedTypedData);
    permitHash = hashTypedData(permit.typed_data);
  } catch {
    typedDataMatches = false;
  }
  try {
    if (SIGNATURE_PATTERN.test(permit.signature)) {
      recoveredSigner = verifyTypedData(
        permit.typed_data.domain,
        { ExposurePermit: permit.typed_data.types.ExposurePermit },
        permit.typed_data.message,
        permit.signature,
      );
      signatureRecoverable = isAddress(recoveredSigner);
    }
  } catch {
    signatureRecoverable = false;
  }

  const schemaSupported =
    permit.schema_version === "sentinel-exposure-permit.v1"
    && permit.payload.schema_version === "sentinel-exposure-permit.v1";
  const permitHashMatches = permitHash !== "" && permit.permit_hash === permitHash;
  const signerMatches = isAddress(permit.signer)
    && permit.signer.toLowerCase() === DEMO_EXPOSURE_PERMIT_WALLET.address.toLowerCase();
  const trustedSignature = signatureRecoverable
    && recoveredSigner.toLowerCase() === DEMO_EXPOSURE_PERMIT_WALLET.address.toLowerCase();
  const payloadShape =
    permit.payload.action === "BUY_EXPOSURE"
    && permit.payload.asset === "wstETH"
    && permit.payload.unit === "wstETH"
    && isAddress(permit.payload.account)
    && isBytes32(permit.payload.graph_hash)
    && isUint256(permit.payload.nonce)
    && isUint256(String(permit.payload.issued_at))
    && isUint256(String(permit.payload.expires_at))
    && Number.isSafeInteger(permit.payload.chain_id)
    && Number.isSafeInteger(permit.payload.snapshot_block);
  const requestBindings =
    request.request.schema_version === "sentinel-exposure-buy.v1"
    && request.request.action === permit.payload.action
    && request.request.asset === permit.payload.asset
    && request.request.unit === permit.payload.unit;
  const requestedWithinAuthorization =
    compareUnits(request.request.requested_units, permit.payload.authorized_units) !== null
    && compareUnits(request.request.requested_units, permit.payload.authorized_units)! <= 0;
  const audienceMatches = permit.payload.audience === expectedAudience;
  const issuedAt = Number(permit.payload.issued_at);
  const expiresAt = Number(permit.payload.expires_at);
  const timestampsValid =
    isUint256(String(permit.payload.issued_at))
    && isUint256(String(permit.payload.expires_at))
    && Number.isSafeInteger(issuedAt)
    && Number.isSafeInteger(expiresAt)
    && expiresAt > issuedAt;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const notBefore = timestampsValid && nowSeconds >= issuedAt;
  const notExpired = timestampsValid && nowSeconds <= expiresAt;

  const valid =
    schemaSupported
    && typedDataMatches
    && permitHashMatches
    && payloadShape
    && signerMatches
    && trustedSignature
    && requestBindings
    && audienceMatches
    && timestampsValid;
  const executable = valid && notBefore && notExpired && requestedWithinAuthorization;

  let code = "EXECUTION_PERMITTED";
  if (!schemaSupported) code = "INVALID_PERMIT_SCHEMA";
  else if (!typedDataMatches) code = "PERMIT_PAYLOAD_MISMATCH";
  else if (!permitHashMatches) code = "PERMIT_HASH_MISMATCH";
  else if (!payloadShape) code = "INVALID_PERMIT_PAYLOAD";
  else if (!signatureRecoverable || !trustedSignature || !signerMatches) code = "SIGNER_UNTRUSTED";
  else if (!requestBindings) code = "REQUEST_BINDING_MISMATCH";
  else if (!audienceMatches) code = "AUDIENCE_MISMATCH";
  else if (!timestampsValid) code = "INVALID_PERMIT_TIMESTAMPS";
  else if (!notBefore) code = "PERMIT_NOT_YET_ACTIVE";
  else if (!notExpired) code = "PERMIT_EXPIRED";
  else if (!requestedWithinAuthorization) code = "REQUEST_EXCEEDS_AUTHORIZATION";

  return {
    valid,
    executable,
    code,
    permit_hash: permit.permit_hash,
    graph_hash: permit.payload.graph_hash,
    checks: [
      check("schema_supported", schemaSupported),
      check("typed_data_matches_payload", typedDataMatches),
      check("permit_hash_matches", permitHashMatches),
      check("payload_shape_valid", payloadShape),
      check("signature_recoverable", signatureRecoverable),
      check("trusted_signer_matches", signerMatches && trustedSignature),
      check("request_bindings_match", requestBindings),
      check("audience_matches", audienceMatches),
      check("permit_not_expired", notExpired),
      check("requested_units_within_authorization", requestedWithinAuthorization),
    ],
  };
}
