const GRAPH_GATEWAY_BASE = "https://gateway.thegraph.com/api/subgraphs/id";
const PREFLIGHT_QUERY = `
  query PositionEvidencePreflight {
    _meta {
      block {
        number
        hash
        timestamp
      }
      hasIndexingErrors
    }
  }
`;

type GraphResponse = {
  data?: {
    _meta?: {
      block?: {
        number?: number | string;
        hash?: string;
        timestamp?: number | string;
      } | null;
      hasIndexingErrors?: boolean;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type PreflightResult =
  | {
      status: "blocked";
      reason: "missing_configuration";
      missing: string[];
    }
  | {
      status: "error";
      reason: string;
      http_status?: number;
      details?: string;
    }
  | {
      status: "ok";
      endpoint: string;
      subgraph_id: string;
      chain_id?: string;
      fetched_at: string;
      indexed_block: {
        number: number;
        hash: string | null;
        timestamp: number | null;
      };
      has_indexing_errors: boolean;
      index_age_seconds: number | null;
      warnings: string[];
    };

function normalizeRequired(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function buildGraphEndpoint(subgraphId: string): string {
  const normalized = normalizeRequired(subgraphId);
  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error("invalid_subgraph_id");
  }

  return `${GRAPH_GATEWAY_BASE}/${encodeURIComponent(normalized)}`;
}

function safeGraphError(payload: GraphResponse): string {
  const message = payload.errors?.find((error) => error.message)?.message;
  return message ? "provider_rejected_query" : "graphql_error";
}

function parseNumber(value: number | string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parsePreflightPayload(
  payload: GraphResponse,
  fetchedAt = new Date(),
): PreflightResult {
  if (payload.errors?.length || !payload.data) {
    return {
      status: "error",
      reason: "graphql_error",
      details: safeGraphError(payload),
    };
  }

  const meta = payload.data._meta;
  const block = meta?.block;
  const number = parseNumber(block?.number);
  const timestamp = parseNumber(block?.timestamp);
  const hash = typeof block?.hash === "string" && block.hash ? block.hash : null;
  const warnings: string[] = [];

  if (!meta || !block || number === null) warnings.push("missing_block_number");
  if (timestamp === null) warnings.push("missing_block_timestamp");
  if (!hash) warnings.push("missing_block_hash");
  if (meta?.hasIndexingErrors === true) warnings.push("provider_reports_indexing_errors");

  const nowSeconds = Math.floor(fetchedAt.getTime() / 1000);
  const indexAgeSeconds = timestamp === null ? null : nowSeconds - timestamp;
  if (indexAgeSeconds !== null && indexAgeSeconds < -60) {
    warnings.push("block_timestamp_is_in_the_future");
  }

  return {
    status: "ok",
    endpoint: `${GRAPH_GATEWAY_BASE}/<SUBGRAPH_ID>`,
    subgraph_id: "configured",
    fetched_at: fetchedAt.toISOString(),
    indexed_block: { number: number ?? 0, hash, timestamp },
    has_indexing_errors: meta?.hasIndexingErrors === true,
    index_age_seconds: indexAgeSeconds,
    warnings,
  };
}

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<GraphResponse> }>;

export async function runGraphPreflight(options: {
  apiKey?: string;
  subgraphId?: string;
  chainId?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: Date;
}): Promise<PreflightResult> {
  const apiKey = normalizeRequired(options.apiKey);
  const subgraphId = normalizeRequired(options.subgraphId);
  const missing = [
    !apiKey ? "GRAPH_API_KEY" : "",
    !subgraphId ? "GRAPH_SUBGRAPH_ID" : "",
  ].filter(Boolean);
  if (missing.length) return { status: "blocked", reason: "missing_configuration", missing };

  let endpoint: string;
  try {
    endpoint = buildGraphEndpoint(subgraphId);
  } catch {
    return { status: "error", reason: "invalid_subgraph_id" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query: PREFLIGHT_QUERY, operationName: "PositionEvidencePreflight" }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { status: "error", reason: "http_error", http_status: response.status };
    }

    let payload: GraphResponse;
    try {
      payload = await response.json();
    } catch {
      return { status: "error", reason: "invalid_json" };
    }

    const parsed = parsePreflightPayload(payload, options.now ?? new Date());
    if (parsed.status !== "ok") return parsed;

    return {
      ...parsed,
      subgraph_id: subgraphId,
      chain_id: normalizeRequired(options.chainId) || undefined,
    };
  } catch (error) {
    return {
      status: "error",
      reason: error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error",
    };
  } finally {
    clearTimeout(timer);
  }
}

if (process.argv[1]?.endsWith("/scripts/graph-preflight.ts")) {
  const result = await runGraphPreflight({
    apiKey: process.env.GRAPH_API_KEY,
    subgraphId: process.env.GRAPH_SUBGRAPH_ID,
    chainId: process.env.GRAPH_CHAIN_ID,
  });

  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "ok") process.exitCode = 2;
}
