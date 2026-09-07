import { keccak256, toUtf8Bytes } from "ethers";

import type {
  GraphPositionEvidence,
  GraphPositionObservation,
} from "./graph-client.ts";
import type {
  PositionEvidenceObservation,
  PositionEvidenceV1,
} from "../../shared/schemas/position-evidence.ts";

export const POSITION_EVIDENCE_SCHEMA_VERSION = "position_evidence.v1" as const;
export const POSITION_QUERY_TEMPLATE_ID = "aave-v3-user-reserves";
export const POSITION_QUERY_TEMPLATE_VERSION = "1";
export const DEFAULT_MAX_EVIDENCE_AGE_SECONDS = 300;

const ACCOUNT_PATTERN = /^0x[a-fA-F0-9]{40}$/;

type CanonicalObject = Record<string, unknown>;

export type NormalizePositionEvidenceOptions = {
  expected_account?: string;
  expected_chain_id?: number;
  expected_subgraph_id?: string;
  max_evidence_age_seconds?: number;
  now?: Date;
};

function isObject(value: unknown): value is CanonicalObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Serialize JSON-compatible values with sorted object keys and stable arrays. */
export function canonicalStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_number");
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") throw new Error("unsupported_bigint");
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const child = value[key];
        if (child === undefined) throw new Error(`undefined_value:${key}`);
        return `${JSON.stringify(key)}:${canonicalStringify(child)}`;
      })
      .join(",")}}`;
  }
  throw new Error("unsupported_canonical_value");
}

/** Convert a signed integer token amount to a fixed-scale decimal string. */
export function rawIntegerToDecimal(raw: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("invalid_decimals");
  }
  if (!/^-?\d+$/.test(raw)) throw new Error("invalid_raw_integer");

  const negative = raw.startsWith("-");
  const unsigned = (negative ? raw.slice(1) : raw).replace(/^0+(?=\d)/, "");
  if (decimals === 0) return `${negative ? "-" : ""}${unsigned}`;

  const padded = unsigned.padStart(decimals + 1, "0");
  const integerPart = padded.slice(0, -decimals) || "0";
  const fractionalPart = padded.slice(-decimals);
  return `${negative ? "-" : ""}${integerPart}.${fractionalPart}`;
}

function addGap(gaps: string[], reason: string): void {
  if (!gaps.includes(reason)) gaps.push(reason);
}

function normalizeAddress(value: string | undefined): string | null {
  if (!value || !ACCOUNT_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function nullableInteger(value: number | null | undefined): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function decimalAmount(
  raw: string | null,
  decimals: number | null,
  reason: string,
  gaps: string[],
): string | null {
  if (raw === null || decimals === null) {
    addGap(gaps, reason);
    return null;
  }
  try {
    const decimal = rawIntegerToDecimal(raw, decimals);
    if (raw.startsWith("-")) addGap(gaps, `negative_${reason.replace("_amount", "_value")}`);
    return decimal;
  } catch {
    addGap(gaps, reason);
    return null;
  }
}

function normalizeObservation(
  observation: GraphPositionObservation,
  subjectAccount: string,
  gaps: string[],
): PositionEvidenceObservation {
  const account = normalizeAddress(observation.account);
  if (!account || account !== subjectAccount) addGap(gaps, "account_mismatch");

  const decimals = Number.isInteger(observation.asset.decimals)
    && observation.asset.decimals >= 0
    && observation.asset.decimals <= 255
    ? observation.asset.decimals
    : null;
  if (decimals === null) addGap(gaps, "invalid_decimals");

  const suppliedRaw = typeof observation.supplied_raw === "string"
    ? observation.supplied_raw
    : null;
  const debtRaw = typeof observation.debt_raw === "string" ? observation.debt_raw : null;
  const stableDebtRaw = typeof observation.stable_debt_raw === "string"
    ? observation.stable_debt_raw
    : null;
  const variableDebtRaw = typeof observation.variable_debt_raw === "string"
    ? observation.variable_debt_raw
    : null;

  return {
    position_id: observation.id,
    account: account ?? observation.account.toLowerCase(),
    asset: {
      address: observation.asset.address.toLowerCase(),
      symbol: observation.asset.symbol,
      name: observation.asset.name,
      decimals,
    },
    supplied: {
      raw: suppliedRaw,
      decimal: decimalAmount(suppliedRaw, decimals, "invalid_supply_amount", gaps),
      unit: observation.asset.symbol,
    },
    debt: {
      raw: debtRaw,
      decimal: decimalAmount(debtRaw, decimals, "invalid_debt_amount", gaps),
      unit: observation.asset.symbol,
    },
    stable_debt: {
      raw: stableDebtRaw,
      decimal: decimalAmount(stableDebtRaw, decimals, "invalid_stable_debt_amount", gaps),
      unit: observation.asset.symbol,
    },
    variable_debt: {
      raw: variableDebtRaw,
      decimal: decimalAmount(variableDebtRaw, decimals, "invalid_variable_debt_amount", gaps),
      unit: observation.asset.symbol,
    },
    collateral_enabled: observation.collateral_enabled === true,
    position_updated_at: nullableInteger(observation.position_updated_at),
    price_in_eth: {
      raw: typeof observation.asset.price_in_eth_raw === "string"
        ? observation.asset.price_in_eth_raw
        : null,
      source: observation.asset.price_source,
      updated_at: nullableInteger(observation.asset.price_updated_at),
      age_seconds: nullableInteger(observation.asset.price_age_seconds),
      unit: "ETH",
    },
    source_paths: {
      position: "userReserves[].id",
      account: "userReserves[].user.id",
      asset: "userReserves[].reserve.underlyingAsset",
      supplied: "userReserves[].currentATokenBalance",
      debt: "userReserves[].currentTotalDebt",
      price: "userReserves[].reserve.price.priceInEth",
    },
  };
}

function collectStructuralGaps(
  input: GraphPositionEvidence,
  gaps: string[],
  options: NormalizePositionEvidenceOptions,
  now: Date,
): void {
  const indexedBlock = input.source.indexed_block;
  const maxAge = options.max_evidence_age_seconds ?? DEFAULT_MAX_EVIDENCE_AGE_SECONDS;
  const age = indexedBlock.timestamp === null
    ? null
    : Math.floor(now.getTime() / 1000) - indexedBlock.timestamp;

  if (indexedBlock.number <= 0) addGap(gaps, "missing_block_number");
  if (!indexedBlock.hash) addGap(gaps, "missing_block_hash");
  if (indexedBlock.timestamp === null) {
    addGap(gaps, "missing_block_timestamp");
  } else if (age !== null && age > maxAge) {
    addGap(gaps, "stale_indexed_block");
  } else if (age !== null && age < -60) {
    addGap(gaps, "block_timestamp_is_in_the_future");
  }
  if (input.source.has_indexing_errors) addGap(gaps, "provider_reports_indexing_errors");
  if (!input.pagination.complete) addGap(gaps, "pagination_incomplete");
  if (input.observations.length === 0) addGap(gaps, "no_position_observations");
  if (input.valuation.usd_available !== true) addGap(gaps, "usd_valuation_unavailable");

  const expectedAccount = normalizeAddress(options.expected_account);
  if (expectedAccount && expectedAccount !== input.subject.account.toLowerCase()) {
    addGap(gaps, "account_mismatch");
  }
  if (options.expected_chain_id !== undefined && options.expected_chain_id !== input.subject.chain_id) {
    addGap(gaps, "chain_mismatch");
  }
  if (
    options.expected_subgraph_id !== undefined
    && options.expected_subgraph_id !== input.source.subgraph_id
  ) {
    addGap(gaps, "deployment_mismatch");
  }
}

function queryVariablesHash(account: string, chainId: number): string {
  return keccak256(toUtf8Bytes(canonicalStringify({
    account,
    chain_id: chainId,
    template_id: POSITION_QUERY_TEMPLATE_ID,
    template_version: POSITION_QUERY_TEMPLATE_VERSION,
  })));
}

export function normalizePositionEvidence(
  input: GraphPositionEvidence,
  options: NormalizePositionEvidenceOptions = {},
): PositionEvidenceV1 {
  const now = options.now ?? new Date();
  const subjectAccount = input.subject.account.toLowerCase();
  const gaps = [...new Set(input.gaps)];
  collectStructuralGaps(input, gaps, options, now);
  const observations = input.observations.map((observation) =>
    normalizeObservation(observation, subjectAccount, gaps));
  const indexAgeSeconds = input.source.indexed_block.timestamp === null
    ? null
    : Math.floor(now.getTime() / 1000) - input.source.indexed_block.timestamp;

  const payload: Omit<PositionEvidenceV1, "evidence_hash"> = {
    schema_version: POSITION_EVIDENCE_SCHEMA_VERSION,
    mode: input.mode,
    subject: {
      chain_id: input.subject.chain_id,
      account: subjectAccount,
      protocol: "aave-v3",
      deployment: { subgraph_id: input.source.subgraph_id },
    },
    query: {
      template_id: POSITION_QUERY_TEMPLATE_ID,
      template_version: POSITION_QUERY_TEMPLATE_VERSION,
      variables_hash: queryVariablesHash(subjectAccount, input.subject.chain_id),
    },
    source: {
      provider: "thegraph",
      subgraph_id: input.source.subgraph_id,
      fetched_at: input.source.fetched_at,
      indexed_block: {
        number: input.source.indexed_block.number,
        hash: input.source.indexed_block.hash,
        timestamp: input.source.indexed_block.timestamp,
      },
      has_indexing_errors: input.source.has_indexing_errors,
      index_age_seconds: indexAgeSeconds,
    },
    observations,
    valuation: {
      unit: input.valuation.unit,
      usd_available: input.valuation.usd_available,
      note: input.valuation.note,
    },
    pagination: {
      page_size: input.pagination.page_size,
      pages: input.pagination.pages,
      complete: input.pagination.complete,
    },
    gaps,
    quality: {
      decision: gaps.length === 0 ? "ACCEPT" : "DENY",
      reason_codes: [...gaps],
    },
  };

  return {
    ...payload,
    evidence_hash: keccak256(toUtf8Bytes(canonicalStringify(payload))),
  };
}
