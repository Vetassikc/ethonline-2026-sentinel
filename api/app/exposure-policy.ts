import type {
  ExposureGraphV1,
  ExposurePolicyConfig,
  ExposurePolicyDecision,
  ExposureRequest,
} from "../../shared/schemas/exposure-graph.ts";

const DEFAULT_DECIMALS = 18;
const MAX_FIXED_DIGITS = 78;
const NON_BLOCKING_GAPS = new Set(["usd_valuation_unavailable", "stale_oracle_price"]);

export function parseFixedUnits(value: string, decimals = DEFAULT_DECIMALS): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("invalid_decimals");
  }
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    if (typeof value === "string" && value.startsWith("-")) throw new Error("negative_units");
    throw new Error("invalid_units");
  }
  const [integerPart, fractionalPart = ""] = value.split(".");
  if (fractionalPart.length > decimals) throw new Error("too_many_decimals");
  if (integerPart.length + fractionalPart.length > MAX_FIXED_DIGITS) {
    throw new Error("units_overflow");
  }
  const scale = 10n ** BigInt(decimals);
  const fraction = fractionalPart.padEnd(decimals, "0") || "0";
  const result = BigInt(integerPart) * scale + BigInt(fraction);
  if (result < 0n) throw new Error("negative_units");
  return result;
}

export function formatFixedUnits(value: bigint, decimals = DEFAULT_DECIMALS): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("invalid_decimals");
  }
  if (value < 0n) throw new Error("negative_units");
  const scale = 10n ** BigInt(decimals);
  const integerPart = value / scale;
  if (decimals === 0) return integerPart.toString();
  const fractionalPart = (value % scale).toString().padStart(decimals, "0");
  return `${integerPart}.${fractionalPart}`;
}

function decisionBase(
  config: ExposurePolicyConfig,
  request: ExposureRequest,
  overrides: Partial<ExposurePolicyDecision> = {},
): ExposurePolicyDecision {
  return {
    verdict: "DENY",
    requested_units: request.requested_units,
    allowed_units: formatFixedUnits(0n),
    dependency_cap_units: config.dependency_cap_units,
    gross_exposure_units: null,
    headroom_units: null,
    binding_constraint: "request",
    policy_version: config.policy_version,
    unit: "wstETH",
    reason_codes: [],
    debt_units: null,
    ...overrides,
  };
}

function rawUnits(raw: string, decimals: number): bigint | null {
  if (decimals !== DEFAULT_DECIMALS || !/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function sumDebt(graph: ExposureGraphV1): bigint | null {
  let total = 0n;
  for (const debt of graph.debt) {
    const value = rawUnits(debt.quantity.raw, debt.quantity.decimals);
    if (value === null || debt.quantity.unit !== "wstETH") return null;
    total += value;
  }
  return total;
}

export function evaluateExposurePolicy(
  graph: ExposureGraphV1,
  config: ExposurePolicyConfig,
  request: ExposureRequest,
): ExposurePolicyDecision {
  let requested: bigint;
  let cap: bigint;
  try {
    requested = parseFixedUnits(request.requested_units);
    cap = parseFixedUnits(config.dependency_cap_units);
  } catch {
    return decisionBase(config, request, {
      binding_constraint: "request",
      reason_codes: ["invalid_request_or_policy"],
    });
  }
  if (requested <= 0n || config.unit !== "wstETH" || cap < 0n) {
    return decisionBase(config, request, {
      binding_constraint: "request",
      reason_codes: ["invalid_request_or_policy"],
    });
  }

  const base = decisionBase(config, request, {
    requested_units: formatFixedUnits(requested),
    dependency_cap_units: formatFixedUnits(cap),
  });
  const requiredGaps = graph.gaps.filter((gap) => !NON_BLOCKING_GAPS.has(gap));
  if (graph.source_status !== "ok" || requiredGaps.length > 0) {
    return {
      ...base,
      binding_constraint: "source_quality",
      reason_codes: [
        ...(graph.source_status !== "ok" ? ["source_not_authorizing"] : []),
        ...(requiredGaps.length > 0 ? ["required_source_gap"] : []),
      ],
    };
  }

  const contributingPaths = graph.paths.filter((path) => path.capital_contribution);
  const kinds = new Set(contributingPaths.map((path) => path.kind));
  if (!kinds.has("direct_holding") || !kinds.has("aave_supply")) {
    return {
      ...base,
      binding_constraint: "source_quality",
      reason_codes: ["missing_exposure_path"],
    };
  }

  let gross = 0n;
  for (const path of contributingPaths) {
    const raw = rawUnits(path.raw_quantity, path.decimals);
    let decimal: bigint | null = null;
    try {
      decimal = parseFixedUnits(path.decimal_quantity, path.decimals);
    } catch {
      decimal = null;
    }
    if (
      path.unit !== "wstETH"
      || raw === null
      || decimal === null
      || raw !== decimal
    ) {
      return {
        ...base,
        binding_constraint: "source_quality",
        reason_codes: ["malformed_exposure_quantity"],
      };
    }
    gross += raw;
  }

  const debt = sumDebt(graph);
  if (debt === null) {
    return {
      ...base,
      binding_constraint: "source_quality",
      reason_codes: ["malformed_debt_quantity"],
    };
  }
  const headroom = cap > gross ? cap - gross : 0n;
  const allowed = requested < headroom ? requested : headroom;
  const common = {
    ...base,
    gross_exposure_units: formatFixedUnits(gross),
    headroom_units: formatFixedUnits(headroom),
    debt_units: formatFixedUnits(debt),
  };
  if (headroom === 0n) {
    return {
      ...common,
      binding_constraint: "dependency_cap",
      reason_codes: ["dependency_cap_reached"],
    };
  }
  if (allowed < requested) {
    return {
      ...common,
      verdict: "ALLOW_WITH_DOWNSIZE",
      allowed_units: formatFixedUnits(allowed),
      binding_constraint: "dependency_cap",
      reason_codes: ["dependency_cap_applied"],
    };
  }
  return {
    ...common,
    verdict: "ALLOW",
    allowed_units: formatFixedUnits(allowed),
    binding_constraint: "none",
    reason_codes: [],
  };
}
