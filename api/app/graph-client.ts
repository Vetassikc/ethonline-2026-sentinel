import { buildGraphEndpoint } from "../../scripts/graph-preflight.ts";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_PRICE_AGE_SECONDS = 300;
const ACCOUNT_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const POSITION_QUERY_FIRST_PAGE = `
  query PositionEvidence($account: String!, $first: Int!) {
    _meta {
      block {
        number
        hash
        timestamp
      }
      hasIndexingErrors
    }
    userReserves(
      first: $first
      where: { user: $account }
      orderBy: id
      orderDirection: asc
    ) {
      id
      user { id }
      reserve {
        id
        underlyingAsset
        symbol
        name
        decimals
        price {
          priceInEth
          priceSource
          lastUpdateTimestamp
        }
      }
      usageAsCollateralEnabledOnUser
      scaledATokenBalance
      currentATokenBalance
      scaledVariableDebt
      currentVariableDebt
      currentStableDebt
      currentTotalDebt
      lastUpdateTimestamp
    }
  }
`;

const POSITION_QUERY_CURSOR_PAGE = `
  query PositionEvidence($account: String!, $first: Int!, $idGt: ID!) {
    _meta {
      block {
        number
        hash
        timestamp
      }
      hasIndexingErrors
    }
    userReserves(
      first: $first
      where: { user: $account, id_gt: $idGt }
      orderBy: id
      orderDirection: asc
    ) {
      id
      user { id }
      reserve {
        id
        underlyingAsset
        symbol
        name
        decimals
        price {
          priceInEth
          priceSource
          lastUpdateTimestamp
        }
      }
      usageAsCollateralEnabledOnUser
      scaledATokenBalance
      currentATokenBalance
      scaledVariableDebt
      currentVariableDebt
      currentStableDebt
      currentTotalDebt
      lastUpdateTimestamp
    }
  }
`;

type GraphBlock = {
  number?: number | string;
  hash?: string;
  timestamp?: number | string;
};

type GraphMeta = {
  block?: GraphBlock | null;
  hasIndexingErrors?: boolean;
};

type GraphPositionRow = {
  id?: string;
  user?: { id?: string } | null;
  reserve?: {
    id?: string;
    underlyingAsset?: string;
    symbol?: string;
    name?: string;
    decimals?: number | string;
    price?: {
      priceInEth?: string;
      priceSource?: string;
      lastUpdateTimestamp?: number | string;
    } | null;
  } | null;
  usageAsCollateralEnabledOnUser?: boolean;
  scaledATokenBalance?: string;
  currentATokenBalance?: string;
  scaledVariableDebt?: string;
  currentVariableDebt?: string;
  currentStableDebt?: string;
  currentTotalDebt?: string;
  lastUpdateTimestamp?: number | string;
};

type GraphResponse = {
  data?: {
    _meta?: GraphMeta | null;
    userReserves?: GraphPositionRow[] | null;
  };
  errors?: Array<{ message?: string }>;
};

export type PositionQueryVariables = {
  account: string;
  first: number;
  idGt?: string;
};

export type PositionQueryRequest = {
  query: string;
  variables: PositionQueryVariables;
  operationName: "PositionEvidence";
};

export type GraphPositionObservation = {
  id: string;
  account: string;
  asset: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    price_in_eth_raw: string | null;
    price_source: string | null;
    price_updated_at: number | null;
    price_age_seconds: number | null;
  };
  supplied_raw: string;
  debt_raw: string;
  stable_debt_raw: string;
  variable_debt_raw: string;
  collateral_enabled: boolean;
  position_updated_at: number | null;
};

export type GraphPositionEvidence = {
  status: "ok";
  mode: "live";
  subject: {
    account: string;
    chain_id: number;
  };
  source: {
    provider: "thegraph";
    subgraph_id: string;
    endpoint: string;
    fetched_at: string;
    indexed_block: {
      number: number;
      hash: string | null;
      timestamp: number | null;
    };
    has_indexing_errors: boolean;
    index_age_seconds: number | null;
  };
  observations: GraphPositionObservation[];
  valuation: {
    unit: "ETH";
    usd_available: false;
    note: "provider_exposes_price_in_eth_only";
  };
  pagination: {
    page_size: number;
    pages: number;
    complete: boolean;
  };
  gaps: string[];
};

export type GraphPositionResult =
  | GraphPositionEvidence
  | {
      status: "blocked";
      reason: "missing_configuration" | "invalid_subject";
      missing?: string[];
      details?: string[];
    }
  | {
      status: "error";
      reason:
        | "invalid_subgraph_id"
        | "http_error"
        | "invalid_json"
        | "graphql_error"
        | "invalid_payload"
        | "timeout"
        | "network_error";
      http_status?: number;
      details?: string;
    };

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<GraphResponse> }>;

function normalizeRequired(value: string | number | undefined): string {
  return value === undefined ? "" : String(value).trim();
}

function parseSafeInteger(value: number | string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseSignedIntegerString(value: string | undefined): string | null {
  return typeof value === "string" && /^-?\d+$/.test(value) ? value : null;
}

function addGap(gaps: string[], reason: string): void {
  if (!gaps.includes(reason)) gaps.push(reason);
}

function normalizeAddress(value: string | undefined): string | null {
  if (!value || !ACCOUNT_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function parseChainId(value: string | number | undefined): number | null {
  const normalized = normalizeRequired(value);
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeGraphError(payload: GraphResponse): string {
  return payload.errors?.some((error) => error.message)
    ? "provider_rejected_query"
    : "graphql_error";
}

function parseMeta(meta: GraphMeta | null | undefined, now: Date, gaps: string[]) {
  const block = meta?.block;
  const number = parseSafeInteger(block?.number);
  const timestamp = parseSafeInteger(block?.timestamp);
  const hash = typeof block?.hash === "string" && block.hash ? block.hash : null;

  if (number === null) addGap(gaps, "missing_block_number");
  if (timestamp === null) addGap(gaps, "missing_block_timestamp");
  if (!hash) addGap(gaps, "missing_block_hash");
  if (meta?.hasIndexingErrors === true) {
    addGap(gaps, "provider_reports_indexing_errors");
  }

  const indexAgeSeconds = timestamp === null
    ? null
    : Math.floor(now.getTime() / 1000) - timestamp;
  if (indexAgeSeconds !== null && indexAgeSeconds < -60) {
    addGap(gaps, "block_timestamp_is_in_the_future");
  }

  return {
    number: number ?? 0,
    hash,
    timestamp,
    indexAgeSeconds,
    hasIndexingErrors: meta?.hasIndexingErrors === true,
  };
}

function parseObservation(
  row: GraphPositionRow,
  account: string,
  gaps: string[],
  now: Date,
  maxPriceAgeSeconds: number,
): GraphPositionObservation | null {
  const id = typeof row.id === "string" && row.id ? row.id : null;
  const rowAccount = normalizeAddress(row.user?.id);
  const reserve = row.reserve;
  const reserveAddress = typeof reserve?.underlyingAsset === "string"
    ? reserve.underlyingAsset.toLowerCase()
    : null;
  const symbol = typeof reserve?.symbol === "string" ? reserve.symbol : null;
  const name = typeof reserve?.name === "string" ? reserve.name : null;
  const decimals = parseSafeInteger(reserve?.decimals);
  const supplied = parseSignedIntegerString(row.currentATokenBalance);
  const debt = parseSignedIntegerString(row.currentTotalDebt);
  const stableDebt = parseSignedIntegerString(row.currentStableDebt);
  const variableDebt = parseSignedIntegerString(row.currentVariableDebt);
  const positionUpdatedAt = parseSafeInteger(row.lastUpdateTimestamp);

  if (!id || !rowAccount || !reserve || !reserveAddress || !symbol || !name) {
    addGap(gaps, "malformed_position_row");
    return null;
  }
  if (rowAccount !== account) addGap(gaps, "account_mismatch");
  if (decimals === null || decimals > 255) addGap(gaps, "invalid_decimals");
  if (supplied === null || debt === null || stableDebt === null || variableDebt === null) {
    addGap(gaps, "malformed_position_amount");
  }
  if (supplied?.startsWith("-")) addGap(gaps, "negative_supply_value");
  if (debt?.startsWith("-")) addGap(gaps, "negative_debt_value");
  if (stableDebt?.startsWith("-")) addGap(gaps, "negative_stable_debt_value");
  if (variableDebt?.startsWith("-")) addGap(gaps, "negative_variable_debt_value");
  if (positionUpdatedAt === null) addGap(gaps, "missing_position_timestamp");

  const priceInEth = typeof reserve.price?.priceInEth === "string"
    ? reserve.price.priceInEth
    : null;
  if (!priceInEth) addGap(gaps, "missing_price_in_eth");
  const priceUpdatedAt = parseSafeInteger(reserve.price?.lastUpdateTimestamp);
  if (priceUpdatedAt === null) {
    addGap(gaps, "missing_price_timestamp");
  }
  const priceAgeSeconds = priceUpdatedAt === null
    ? null
    : Math.floor(now.getTime() / 1000) - priceUpdatedAt;
  if (priceAgeSeconds !== null && priceAgeSeconds > maxPriceAgeSeconds) {
    addGap(gaps, "stale_oracle_price");
  }
  if (priceAgeSeconds !== null && priceAgeSeconds < -60) {
    addGap(gaps, "price_timestamp_is_in_the_future");
  }

  return {
    id,
    account,
    asset: {
      address: reserveAddress,
      symbol,
      name,
      decimals: decimals ?? 0,
      price_in_eth_raw: priceInEth,
      price_source: typeof reserve.price?.priceSource === "string"
        ? reserve.price.priceSource.toLowerCase()
        : null,
      price_updated_at: priceUpdatedAt,
      price_age_seconds: priceAgeSeconds,
    },
    supplied_raw: supplied ?? "0",
    debt_raw: debt ?? "0",
    stable_debt_raw: stableDebt ?? "0",
    variable_debt_raw: variableDebt ?? "0",
    collateral_enabled: row.usageAsCollateralEnabledOnUser === true,
    position_updated_at: positionUpdatedAt,
  };
}

function validatePageSize(value: number | undefined): number | null {
  const pageSize = value ?? DEFAULT_PAGE_SIZE;
  return Number.isInteger(pageSize) && pageSize > 0 && pageSize <= MAX_PAGE_SIZE
    ? pageSize
    : null;
}

function validateMaxPages(value: number | undefined): number | null {
  const maxPages = value ?? DEFAULT_MAX_PAGES;
  return Number.isInteger(maxPages) && maxPages > 0 && maxPages <= 100
    ? maxPages
    : null;
}

export function buildPositionQuery(options: {
  account: string;
  pageSize?: number;
  cursor?: string | null;
}): PositionQueryRequest {
  const account = normalizeAddress(options.account);
  const pageSize = validatePageSize(options.pageSize);
  if (!account) throw new Error("invalid_account");
  if (pageSize === null) throw new Error("invalid_page_size");

  return {
    query: options.cursor ? POSITION_QUERY_CURSOR_PAGE : POSITION_QUERY_FIRST_PAGE,
    operationName: "PositionEvidence",
    variables: {
      account,
      first: pageSize,
      ...(options.cursor ? { idGt: options.cursor } : {}),
    },
  };
}

export async function runGraphPositionQuery(options: {
  apiKey?: string;
  subgraphId?: string;
  chainId?: string | number;
  account?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  pageSize?: number;
  maxPages?: number;
  maxPriceAgeSeconds?: number;
  now?: Date;
}): Promise<GraphPositionResult> {
  const apiKey = normalizeRequired(options.apiKey);
  const subgraphId = normalizeRequired(options.subgraphId);
  const rawAccount = normalizeRequired(options.account);
  const rawChainId = normalizeRequired(options.chainId);
  const account = normalizeAddress(options.account);
  const chainId = parseChainId(options.chainId);
  const pageSize = validatePageSize(options.pageSize);
  const maxPages = validateMaxPages(options.maxPages);
  const maxPriceAgeSeconds = options.maxPriceAgeSeconds ?? DEFAULT_MAX_PRICE_AGE_SECONDS;
  const missing = [
    !apiKey ? "GRAPH_API_KEY" : "",
    !subgraphId ? "GRAPH_SUBGRAPH_ID" : "",
    !rawAccount ? "GRAPH_DEMO_ACCOUNT" : "",
    !rawChainId ? "GRAPH_CHAIN_ID" : "",
  ].filter(Boolean);

  if (missing.length > 0) {
    return { status: "blocked", reason: "missing_configuration", missing };
  }
  if (!account || chainId === null) {
    return {
      status: "blocked",
      reason: "invalid_subject",
      details: [
        ...(!account ? ["account must be a 20-byte EVM address."] : []),
        ...(chainId === null ? ["chain_id must be a positive integer."] : []),
      ],
    };
  }
  if (
    pageSize === null ||
    maxPages === null ||
    !Number.isSafeInteger(maxPriceAgeSeconds) ||
    maxPriceAgeSeconds < 0
  ) {
    return {
      status: "blocked",
      reason: "invalid_subject",
      details: ["page size, max pages and chain ID must be bounded positive integers."],
    };
  }

  let endpoint: string;
  try {
    endpoint = buildGraphEndpoint(subgraphId);
  } catch {
    return { status: "error", reason: "invalid_subgraph_id" };
  }

  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const gaps: string[] = ["usd_valuation_unavailable"];
  const observations: GraphPositionObservation[] = [];
  let cursor: string | null = null;
  let pages = 0;
  let complete = false;
  let sourceBlock: ReturnType<typeof parseMeta> | null = null;

  while (pages < maxPages) {
    let request: PositionQueryRequest;
    try {
      request = buildPositionQuery({ account, pageSize, cursor });
    } catch {
      return { status: "blocked", reason: "invalid_subject", details: ["invalid position query parameters."] };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      return {
        status: "error",
        reason: error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error",
      };
    }
    clearTimeout(timer);

    if (!response.ok) {
      return { status: "error", reason: "http_error", http_status: response.status };
    }

    let payload: GraphResponse;
    try {
      payload = await response.json();
    } catch {
      return { status: "error", reason: "invalid_json" };
    }
    if (payload.errors?.length || !payload.data) {
      return { status: "error", reason: "graphql_error", details: safeGraphError(payload) };
    }

    const rows = payload.data.userReserves;
    if (!Array.isArray(rows)) {
      return { status: "error", reason: "invalid_payload", details: "missing_user_reserves" };
    }

    pages += 1;
    const pageBlock = parseMeta(payload.data._meta, now, gaps);
    if (!sourceBlock) {
      sourceBlock = pageBlock;
    } else if (
      sourceBlock.number !== pageBlock.number ||
      sourceBlock.hash !== pageBlock.hash
    ) {
      addGap(gaps, "indexed_block_changed_between_pages");
    }

    for (const row of rows) {
      const observation = parseObservation(row, account, gaps, now, maxPriceAgeSeconds);
      if (observation) observations.push(observation);
    }

    if (rows.length < pageSize) {
      complete = true;
      break;
    }

    const lastId = rows.at(-1)?.id;
    if (typeof lastId !== "string" || !lastId || lastId === cursor) {
      addGap(gaps, "pagination_cursor_not_advanced");
      break;
    }
    cursor = lastId;
  }

  if (!complete) addGap(gaps, "pagination_limit_reached");
  const block = sourceBlock ?? parseMeta(undefined, now, gaps);

  return {
    status: "ok",
    mode: "live",
    subject: { account, chain_id: chainId },
    source: {
      provider: "thegraph",
      subgraph_id: subgraphId,
      endpoint: "https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>",
      fetched_at: fetchedAt,
      indexed_block: { number: block.number, hash: block.hash, timestamp: block.timestamp },
      has_indexing_errors: block.hasIndexingErrors,
      index_age_seconds: block.indexAgeSeconds,
    },
    observations,
    valuation: {
      unit: "ETH",
      usd_available: false,
      note: "provider_exposes_price_in_eth_only",
    },
    pagination: { page_size: pageSize, pages, complete },
    gaps,
  };
}
