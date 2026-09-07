import { id } from "ethers";

import type { GraphPositionObservation } from "./graph-client.ts";

export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_MAINNET_RPC_URL = "https://mainnet.base.org";
export const BASE_RPC_URL_ENV = "BASE_RPC_URL";
export const BASE_WSTETH_ADDRESS = "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452";
export const BASE_AAVE_WSTETH_ATOKEN_ADDRESS = "0x99cbc45ea5bb7ef3a5bc08fb1b7e56bb2442ef0d";
export const BASE_AAVE_POOL_ADDRESS = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5";

export type BaseRpcConfig = {
  public_endpoint: string;
  chain_id: typeof BASE_MAINNET_CHAIN_ID;
  verify_chain_id: boolean;
  source: "default" | "environment";
};

export type BaseRpcConfigResult =
  | { status: "ok"; config: BaseRpcConfig }
  | {
    status: "blocked";
    reason: "invalid_rpc_url" | "unsupported_rpc_protocol" | "rpc_url_userinfo";
  };

const rawRpcUrls = new WeakMap<BaseRpcConfig, string>();

function configWithPrivateUrl(
  rawUrl: string,
  publicEndpoint: string,
  source: BaseRpcConfig["source"],
  verifyChainId: boolean,
): BaseRpcConfig {
  const config: BaseRpcConfig = {
    public_endpoint: publicEndpoint,
    chain_id: BASE_MAINNET_CHAIN_ID,
    verify_chain_id: verifyChainId,
    source,
  };
  rawRpcUrls.set(config, rawUrl);
  return config;
}

function privateRpcUrl(config: BaseRpcConfig): string | null {
  return rawRpcUrls.get(config) ?? null;
}

export function resolveBaseRpcConfig(
  env: Record<string, string | undefined> = process.env,
): BaseRpcConfigResult {
  const configuredUrl = env[BASE_RPC_URL_ENV]?.trim();
  if (!configuredUrl) {
    return {
      status: "ok",
      config: configWithPrivateUrl(BASE_MAINNET_RPC_URL, BASE_MAINNET_RPC_URL, "default", false),
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    return { status: "blocked", reason: "invalid_rpc_url" };
  }
  if (parsed.protocol !== "https:") {
    return { status: "blocked", reason: "unsupported_rpc_protocol" };
  }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    return {
      status: "blocked",
      reason: parsed.username || parsed.password ? "rpc_url_userinfo" : "invalid_rpc_url",
    };
  }

  const publicEndpoint = parsed.origin;
  const rawUrl = publicEndpoint === BASE_MAINNET_RPC_URL
    ? BASE_MAINNET_RPC_URL
    : parsed.toString();
  return {
    status: "ok",
    config: configWithPrivateUrl(
      rawUrl,
      publicEndpoint,
      "environment",
      publicEndpoint !== BASE_MAINNET_RPC_URL,
    ),
  };
}

const ACCOUNT_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const RAY = 1_000_000_000_000_000_000_000_000_000n;
const HALF_RAY = 500_000_000_000_000_000_000_000_000n;

const SELECTORS = {
  balanceOf: id("balanceOf(address)").slice(0, 10),
  scaledBalanceOf: id("scaledBalanceOf(address)").slice(0, 10),
  underlyingAsset: id("UNDERLYING_ASSET_ADDRESS()").slice(0, 10),
  decimals: id("decimals()").slice(0, 10),
  normalizedIncome: id("getReserveNormalizedIncome(address)").slice(0, 10),
};

type RpcJson = {
  result?: unknown;
  error?: unknown;
};

export type RpcFetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type BaseWstEthSnapshot = {
  block: { number: number; hash: string; timestamp: number };
  rpc_endpoint: string;
  contracts: {
    underlying: string;
    a_token: string;
    pool: string;
    a_token_underlying_matches: boolean;
    decimals_match: boolean;
  };
  direct_balance_raw: string;
  aave_scaled_supply_raw: string;
  normalized_income_raw: string;
  normalized_aave_supply_raw: string;
  aave_balance_raw: string;
  gaps: string[];
};

export type BaseWstEthResult =
  | { status: "ok"; snapshot: BaseWstEthSnapshot }
  | {
    status: "blocked";
    reason:
      | "invalid_account"
      | "unsupported_rpc_url"
      | "unsupported_underlying"
      | "unsupported_decimals"
      | "missing_graph_relation"
      | "missing_graph_supply"
      | "unsupported_pool";
  }
  | {
    status: "error";
    reason:
      | "rpc_error"
      | "rpc_rate_limited"
      | "rpc_http_error"
      | "rpc_timeout"
      | "invalid_rpc_response"
      | "rpc_wrong_chain"
      | "rpc_request_budget_exceeded"
      | "block_mismatch"
      | "a_token_underlying_mismatch"
      | "decimals_mismatch"
      | "missing_contract_code"
      | "scaled_supply_mismatch"
      | "aave_balance_mismatch";
  };

class RpcFailure extends Error {
  readonly reason:
    | "rpc_error"
    | "rpc_rate_limited"
    | "rpc_http_error"
    | "rpc_timeout"
    | "invalid_rpc_response"
    | "rpc_request_budget_exceeded";

  constructor(
    reason:
      | "rpc_error"
      | "rpc_rate_limited"
      | "rpc_http_error"
      | "rpc_timeout"
      | "invalid_rpc_response"
      | "rpc_request_budget_exceeded",
  ) {
    super(reason);
    this.reason = reason;
  }
}

function normalizeAddress(value: string | undefined): string | null {
  if (!value || !ACCOUNT_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function normalizeHash(value: string | undefined): string | null {
  if (!value || !HASH_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function parseUnsignedDecimal(value: string | null | undefined): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function parseGraphQuantity(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function hexQuantity(value: number | bigint): string {
  return `0x${BigInt(value).toString(16)}`;
}

function encodeAddressArgument(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function encodeCall(selector: string, address?: string): string {
  return `0x${selector.slice(2)}${address ? encodeAddressArgument(address) : ""}`;
}

function decodeHex(value: unknown, maxBytes = 32): string | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) return null;
  if (value.slice(2).length > maxBytes * 2) return null;
  return value.toLowerCase();
}

function decodeUint256(value: unknown): string | null {
  const hex = decodeHex(value, 32);
  if (!hex || hex === "0x") return null;
  try {
    return BigInt(hex).toString();
  } catch {
    return null;
  }
}

function decodeAddress(value: unknown): string | null {
  const hex = decodeHex(value, 32);
  if (!hex || hex.length !== 66) return null;
  return normalizeAddress(`0x${hex.slice(-40)}`);
}

function decodeCode(value: unknown): string | null {
  return decodeHex(value, 65_536);
}

function rpcReason(error: unknown): RpcFailure["reason"] {
  return error instanceof RpcFailure ? error.reason : "rpc_error";
}

function isRateLimitedRpcError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || Array.isArray(error)) return false;
  const value = error as { code?: unknown; message?: unknown };
  if (value.code === -32016 || value.code === 429) return true;
  return typeof value.message === "string"
    && /rate.?limit|too many requests/i.test(value.message);
}

async function rpcCall(
  fetchImpl: RpcFetchLike,
  url: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
  requestId: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Awaited<ReturnType<RpcFetchLike>>;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === "AbortError") {
      throw new RpcFailure("rpc_timeout");
    }
    throw new RpcFailure("rpc_error");
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new RpcFailure(response.status === 429 ? "rpc_rate_limited" : "rpc_http_error");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new RpcFailure("invalid_rpc_response");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new RpcFailure("invalid_rpc_response");
  }
  const rpc = payload as RpcJson;
  if (rpc.error !== undefined) {
    throw new RpcFailure(isRateLimitedRpcError(rpc.error) ? "rpc_rate_limited" : "rpc_error");
  }
  if (!("result" in rpc)) throw new RpcFailure("invalid_rpc_response");
  return rpc.result;
}

export function rayMul(scaled: string, normalizedIncome: string): string {
  const scaledValue = parseUnsignedDecimal(scaled);
  const incomeValue = parseUnsignedDecimal(normalizedIncome);
  if (scaledValue === null || incomeValue === null) throw new Error("invalid_ray_quantity");
  return ((scaledValue * incomeValue + HALF_RAY) / RAY).toString();
}

function graphObservationIsSupported(
  observation: GraphPositionObservation,
): BaseWstEthResult["status"] | null {
  if (normalizeAddress(observation.asset.address) !== BASE_WSTETH_ADDRESS) {
    return "blocked";
  }
  if (observation.asset.decimals !== 18) return "blocked";
  if (
    !observation.a_token
    || observation.a_token.address !== BASE_AAVE_WSTETH_ATOKEN_ADDRESS
    || observation.a_token.underlying_asset !== BASE_WSTETH_ADDRESS
    || observation.a_token.decimals !== 18
    || observation.pool_address !== BASE_AAVE_POOL_ADDRESS
  ) {
    return "blocked";
  }
  if (parseUnsignedDecimal(observation.scaled_supplied_raw) === null) return "blocked";
  return null;
}

export async function readBaseWstEthSnapshot(options: {
  account: string;
  graphBlock: { number: number; hash: string; timestamp: number };
  graphObservation: GraphPositionObservation;
  fetchImpl?: RpcFetchLike;
  timeoutMs?: number;
  rpcConfig?: BaseRpcConfig;
  rpcUrl?: string;
}): Promise<BaseWstEthResult> {
  const account = normalizeAddress(options.account);
  if (!account) return { status: "blocked", reason: "invalid_account" };

  const configResult = options.rpcConfig
    ? { status: "ok" as const, config: options.rpcConfig }
    : options.rpcUrl === undefined
      ? resolveBaseRpcConfig()
      : resolveBaseRpcConfig({ [BASE_RPC_URL_ENV]: options.rpcUrl });
  if (configResult.status !== "ok") {
    return {
      status: "blocked",
      reason: configResult.reason === "unsupported_rpc_protocol" || configResult.reason === "rpc_url_userinfo"
        ? "unsupported_rpc_url"
        : configResult.reason,
    };
  }
  const rpcUrl = privateRpcUrl(configResult.config);
  if (!rpcUrl) return { status: "blocked", reason: "unsupported_rpc_url" };

  const observationStatus = graphObservationIsSupported(options.graphObservation);
  if (observationStatus !== null) {
    if (normalizeAddress(options.graphObservation.asset.address) !== BASE_WSTETH_ADDRESS) {
      return { status: "blocked", reason: "unsupported_underlying" };
    }
    if (options.graphObservation.asset.decimals !== 18) {
      return { status: "blocked", reason: "unsupported_decimals" };
    }
    if (options.graphObservation.pool_address !== BASE_AAVE_POOL_ADDRESS) {
      return { status: "blocked", reason: "unsupported_pool" };
    }
    if (!options.graphObservation.a_token) {
      return { status: "blocked", reason: "missing_graph_relation" };
    }
    return { status: "blocked", reason: "missing_graph_supply" };
  }

  const graphBlockNumber = parseGraphQuantity(options.graphBlock.number);
  const graphHash = normalizeHash(options.graphBlock.hash);
  const graphTimestamp = parseGraphQuantity(options.graphBlock.timestamp);
  if (graphBlockNumber === null || graphHash === null || graphTimestamp === null) {
    return { status: "error", reason: "invalid_rpc_response" };
  }

  const fetchImpl = options.fetchImpl ?? (fetch as unknown as RpcFetchLike);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRequests = configResult.config.verify_chain_id ? 9 : 8;
  let requestCount = 0;
  let requestId = 1;
  const call = (method: string, params: unknown[]) => {
    requestCount += 1;
    if (requestCount > maxRequests) throw new RpcFailure("rpc_request_budget_exceeded");
    return rpcCall(fetchImpl, rpcUrl, method, params, timeoutMs, requestId++);
  };

  try {
    if (configResult.config.verify_chain_id) {
      const chainId = decodeUint256(await call("eth_chainId", []));
      if (chainId !== String(BASE_MAINNET_CHAIN_ID)) {
        return { status: "error", reason: "rpc_wrong_chain" };
      }
    }

    const blockResult = await call("eth_getBlockByNumber", [hexQuantity(graphBlockNumber), false]);
    if (typeof blockResult !== "object" || blockResult === null || Array.isArray(blockResult)) {
      throw new RpcFailure("invalid_rpc_response");
    }
    const block = blockResult as { number?: unknown; hash?: unknown; timestamp?: unknown };
    const rpcBlockNumber = typeof block.number === "string" ? decodeUint256(block.number) : null;
    const rpcBlockHash = typeof block.hash === "string" ? normalizeHash(block.hash) : null;
    const rpcBlockTimestamp = typeof block.timestamp === "string" ? decodeUint256(block.timestamp) : null;
    if (!rpcBlockNumber || !rpcBlockHash || !rpcBlockTimestamp) {
      throw new RpcFailure("invalid_rpc_response");
    }
    if (
      BigInt(rpcBlockNumber) !== BigInt(graphBlockNumber)
      || rpcBlockHash !== graphHash
      || BigInt(rpcBlockTimestamp) !== BigInt(graphTimestamp)
    ) {
      return { status: "error", reason: "block_mismatch" };
    }

    // The public Base endpoint has a shared request budget for one snapshot.
    // The aToken is validated by its block-tagged calls below; the underlying
    // code check and pool normalized-income call keep contract existence checks
    // without spending a redundant aToken code request.
    for (const address of [BASE_WSTETH_ADDRESS]) {
      const code = decodeCode(await call("eth_getCode", [address, hexQuantity(graphBlockNumber)]));
      if (!code || code === "0x") return { status: "error", reason: "missing_contract_code" };
    }

    const blockTag = hexQuantity(graphBlockNumber);
    const ethCall = (to: string, data: string) => call("eth_call", [{ to, data }, blockTag]);
    const directBalance = decodeUint256(await ethCall(
      BASE_WSTETH_ADDRESS,
      encodeCall(SELECTORS.balanceOf, account),
    ));
    const aaveBalance = decodeUint256(await ethCall(
      BASE_AAVE_WSTETH_ATOKEN_ADDRESS,
      encodeCall(SELECTORS.balanceOf, account),
    ));
    const scaledSupply = decodeUint256(await ethCall(
      BASE_AAVE_WSTETH_ATOKEN_ADDRESS,
      encodeCall(SELECTORS.scaledBalanceOf, account),
    ));
    const onChainUnderlying = decodeAddress(await ethCall(
      BASE_AAVE_WSTETH_ATOKEN_ADDRESS,
      encodeCall(SELECTORS.underlyingAsset),
    ));
    const onChainDecimals = decodeUint256(await ethCall(
      BASE_AAVE_WSTETH_ATOKEN_ADDRESS,
      encodeCall(SELECTORS.decimals),
    ));
    const normalizedIncome = decodeUint256(await ethCall(
      BASE_AAVE_POOL_ADDRESS,
      encodeCall(SELECTORS.normalizedIncome, BASE_WSTETH_ADDRESS),
    ));

    if (
      directBalance === null
      || aaveBalance === null
      || scaledSupply === null
      || onChainUnderlying === null
      || onChainDecimals === null
      || normalizedIncome === null
    ) {
      return { status: "error", reason: "invalid_rpc_response" };
    }
    if (onChainUnderlying !== options.graphObservation.a_token!.underlying_asset) {
      return { status: "error", reason: "a_token_underlying_mismatch" };
    }
    if (onChainDecimals !== String(options.graphObservation.a_token!.decimals)) {
      return { status: "error", reason: "decimals_mismatch" };
    }
    if (scaledSupply !== options.graphObservation.scaled_supplied_raw) {
      return { status: "error", reason: "scaled_supply_mismatch" };
    }

    const normalizedSupply = rayMul(scaledSupply, normalizedIncome);
    if (normalizedSupply !== aaveBalance) {
      return { status: "error", reason: "aave_balance_mismatch" };
    }

    return {
      status: "ok",
      snapshot: {
        block: { number: graphBlockNumber, hash: graphHash, timestamp: graphTimestamp },
        rpc_endpoint: configResult.config.public_endpoint,
        contracts: {
          underlying: BASE_WSTETH_ADDRESS,
          a_token: BASE_AAVE_WSTETH_ATOKEN_ADDRESS,
          pool: BASE_AAVE_POOL_ADDRESS,
          a_token_underlying_matches: onChainUnderlying === BASE_WSTETH_ADDRESS,
          decimals_match: onChainDecimals === "18",
        },
        direct_balance_raw: directBalance,
        aave_scaled_supply_raw: scaledSupply,
        normalized_income_raw: normalizedIncome,
        normalized_aave_supply_raw: normalizedSupply,
        aave_balance_raw: aaveBalance,
        gaps: [],
      },
    };
  } catch (error) {
    return { status: "error", reason: rpcReason(error) };
  }
}
