import test from "node:test";
import assert from "node:assert/strict";

import { id } from "ethers";

import type { GraphPositionObservation } from "../app/graph-client.ts";
import {
  BASE_MAINNET_RPC_URL,
  BASE_WSTETH_ADDRESS,
  resolveBaseRpcConfig,
  rayMul,
  readBaseWstEthSnapshot,
} from "../app/base-rpc.ts";

const ACCOUNT = "0x42bc857b5751126a71d203bde38ee8243b3ad1ed";
const A_TOKEN = "0x99cbc45ea5bb7ef3a5bc08fb1b7e56bb2442ef0d";
const AAVE_POOL = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5";
const BLOCK_HASH = "0x181bf855f6981c23116dc0b982f3bcd5698d792eaab82c080d81cb818e0e95b9";
const BLOCK_NUMBER = 123;
const BLOCK_TIMESTAMP = 1_788_790_000;
const RAY = "1000000000000000000000000000";
const DIRECT_BALANCE = "20000000000000000";
const SCALED_SUPPLY = "30000000000000000";

const SELECTORS = {
  balanceOf: id("balanceOf(address)").slice(0, 10),
  scaledBalanceOf: id("scaledBalanceOf(address)").slice(0, 10),
  underlyingAsset: id("UNDERLYING_ASSET_ADDRESS()").slice(0, 10),
  decimals: id("decimals()").slice(0, 10),
  normalizedIncome: id("getReserveNormalizedIncome(address)").slice(0, 10),
};

const WSTETH_GRAPH_OBSERVATION: GraphPositionObservation = {
  id: `${ACCOUNT}${BASE_WSTETH_ADDRESS}`,
  account: ACCOUNT,
  asset: {
    address: BASE_WSTETH_ADDRESS,
    symbol: "wstETH",
    name: "Wrapped liquid staked Ether 2.0",
    decimals: 18,
    price_in_eth_raw: null,
    price_source: null,
    price_updated_at: null,
    price_age_seconds: null,
  },
  supplied_raw: DIRECT_BALANCE,
  scaled_supplied_raw: SCALED_SUPPLY,
  a_token: {
    address: A_TOKEN,
    underlying_asset: BASE_WSTETH_ADDRESS,
    decimals: 18,
  },
  pool_address: AAVE_POOL,
  supply_index_raw: RAY,
  debt_raw: "0",
  stable_debt_raw: "0",
  variable_debt_raw: "0",
  collateral_enabled: false,
  position_updated_at: BLOCK_TIMESTAMP,
};

function quantity(value: number | bigint): string {
  return `0x${BigInt(value).toString(16)}`;
}

function word(value: number | bigint): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressWord(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

type FakeRpcOptions = {
  blockHash?: string;
  code?: string;
  chainId?: string;
  httpStatus?: number;
  malformedSelector?: string;
  rpcError?: boolean;
};

function fakeRpcFetch(options: FakeRpcOptions = {}) {
  const urls: string[] = [];
  const requests: Array<{ method: string; params: unknown[] }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    urls.push(url);
    const request = JSON.parse(String(init?.body)) as {
      method: string;
      params: unknown[];
    };
    requests.push(request);

    if (options.rpcError) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "provider secret" } };
        },
      };
    }

    if (options.httpStatus !== undefined) {
      return {
        ok: false,
        status: options.httpStatus,
        async json() {
          return { jsonrpc: "2.0", id: 1, error: { code: -32016, message: "rate limited fixture" } };
        },
      };
    }

    if (request.method === "eth_chainId") {
      return {
        ok: true,
        status: 200,
        async json() {
          return { jsonrpc: "2.0", id: 1, result: options.chainId ?? "0x2105" };
        },
      };
    }

    if (request.method === "eth_getBlockByNumber") {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            jsonrpc: "2.0",
            id: 1,
            result: {
              number: quantity(BLOCK_NUMBER),
              hash: options.blockHash ?? BLOCK_HASH,
              timestamp: quantity(BLOCK_TIMESTAMP),
            },
          };
        },
      };
    }

    if (request.method === "eth_getCode") {
      return {
        ok: true,
        status: 200,
        async json() {
          return { jsonrpc: "2.0", id: 1, result: options.code ?? "0x60016000" };
        },
      };
    }

    if (request.method === "eth_call") {
      const call = request.params[0] as { to: string; data: string };
      const selector = call.data.slice(0, 10);
      if (selector === options.malformedSelector) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { jsonrpc: "2.0", id: 1, result: "not-hex" };
          },
        };
      }

      let result: string;
      if (selector === SELECTORS.balanceOf && call.to.toLowerCase() === BASE_WSTETH_ADDRESS) {
        result = `0x${word(DIRECT_BALANCE)}`;
      } else if (selector === SELECTORS.balanceOf && call.to.toLowerCase() === A_TOKEN) {
        result = `0x${word(SCALED_SUPPLY)}`;
      } else if (selector === SELECTORS.scaledBalanceOf) {
        result = `0x${word(SCALED_SUPPLY)}`;
      } else if (selector === SELECTORS.underlyingAsset) {
        result = `0x${addressWord(BASE_WSTETH_ADDRESS)}`;
      } else if (selector === SELECTORS.decimals) {
        result = `0x${word(18)}`;
      } else if (selector === SELECTORS.normalizedIncome) {
        result = `0x${word(RAY)}`;
      } else {
        throw new Error(`unexpected_selector:${selector}`);
      }

      return {
        ok: true,
        status: 200,
        async json() {
          return { jsonrpc: "2.0", id: 1, result };
        },
      };
    }

    throw new Error(`unexpected_method:${request.method}`);
  };

  return { fetchImpl, urls, requests };
}

test("readBaseWstEthSnapshot validates the same block and contract relation", async () => {
  const fake = fakeRpcFetch();
  const result = await readBaseWstEthSnapshot({
    account: ACCOUNT,
    graphBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    graphObservation: WSTETH_GRAPH_OBSERVATION,
    rpcUrl: "https://mainnet.base.org/custom-path",
    fetchImpl: fake.fetchImpl,
  });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.snapshot.direct_balance_raw, DIRECT_BALANCE);
    assert.equal(result.snapshot.aave_scaled_supply_raw, SCALED_SUPPLY);
    assert.equal(result.snapshot.normalized_aave_supply_raw, SCALED_SUPPLY);
    assert.equal(result.snapshot.block.hash, BLOCK_HASH);
    assert.equal(result.snapshot.contracts.a_token_underlying_matches, true);
    assert.equal(result.snapshot.contracts.decimals_match, true);
    assert.deepEqual(result.snapshot.gaps, []);
  }
  assert.deepEqual([...new Set(fake.urls)], [BASE_MAINNET_RPC_URL]);
  const calls = fake.requests.filter((request) => request.method === "eth_call");
  assert.ok(calls.length >= 5);
  assert.equal(calls.every((request) => request.params[1] === quantity(BLOCK_NUMBER)), true);
});

test("rayMul rounds Aave Ray multiplication with integer arithmetic", () => {
  assert.equal(rayMul("1", "500000000000000000000000000"), "1");
  assert.equal(rayMul(SCALED_SUPPLY, RAY), SCALED_SUPPLY);
});

test("resolveBaseRpcConfig keeps the default and redacts configured endpoint details", () => {
  const defaultConfig = resolveBaseRpcConfig({});
  assert.equal(defaultConfig.status, "ok");
  if (defaultConfig.status === "ok") {
    assert.equal(defaultConfig.config.public_endpoint, BASE_MAINNET_RPC_URL);
    assert.equal(defaultConfig.config.chain_id, 8453);
    assert.equal(defaultConfig.config.verify_chain_id, false);
  }

  const configured = resolveBaseRpcConfig({
    BASE_RPC_URL: "https://rpc.example.test/v2/fixture-token?query=fixture",
  });
  assert.equal(configured.status, "ok");
  if (configured.status === "ok") {
    assert.equal(configured.config.public_endpoint, "https://rpc.example.test");
    assert.equal(configured.config.chain_id, 8453);
    assert.equal(configured.config.verify_chain_id, true);
    assert.equal(JSON.stringify(configured).includes("fixture-token"), false);
    assert.equal(JSON.stringify(configured).includes("query=fixture"), false);
  }
});

test("resolveBaseRpcConfig rejects non-HTTPS endpoints before network access", () => {
  assert.deepEqual(
    resolveBaseRpcConfig({ BASE_RPC_URL: "http://rpc.example.test" }),
    { status: "blocked", reason: "unsupported_rpc_protocol" },
  );
  assert.deepEqual(
    resolveBaseRpcConfig({ BASE_RPC_URL: "https://user:pass@rpc.example.test" }),
    { status: "blocked", reason: "rpc_url_userinfo" },
  );
});

test("custom Base RPC is chain-checked and exposes only a safe endpoint label", async () => {
  const config = resolveBaseRpcConfig({ BASE_RPC_URL: "https://rpc.example.test/v2/fixture-token" });
  assert.equal(config.status, "ok");
  if (config.status !== "ok") return;

  const fake = fakeRpcFetch({ chainId: "0x2105" });
  const result = await readBaseWstEthSnapshot({
    account: ACCOUNT,
    graphBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    graphObservation: WSTETH_GRAPH_OBSERVATION,
    rpcConfig: config.config,
    fetchImpl: fake.fetchImpl,
  });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.snapshot.rpc_endpoint, "https://rpc.example.test");
    assert.equal(JSON.stringify(result).includes("fixture-token"), false);
  }
  assert.equal(fake.requests[0]?.method, "eth_chainId");
});

test("custom Base RPC rejects a provider on the wrong chain", async () => {
  const config = resolveBaseRpcConfig({ BASE_RPC_URL: "https://rpc.example.test/v2/fixture-token" });
  assert.equal(config.status, "ok");
  if (config.status !== "ok") return;

  const result = await readBaseWstEthSnapshot({
    account: ACCOUNT,
    graphBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    graphObservation: WSTETH_GRAPH_OBSERVATION,
    rpcConfig: config.config,
    fetchImpl: fakeRpcFetch({ chainId: "0x1" }).fetchImpl,
  });

  assert.deepEqual(result, { status: "error", reason: "rpc_wrong_chain" });
});

test("Base RPC classifies HTTP 429 as sanitized rate limiting", async () => {
  const result = await readBaseWstEthSnapshot({
    account: ACCOUNT,
    graphBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    graphObservation: WSTETH_GRAPH_OBSERVATION,
    fetchImpl: fakeRpcFetch({ httpStatus: 429 }).fetchImpl,
  });

  assert.deepEqual(result, { status: "error", reason: "rpc_rate_limited" });
});

test("readBaseWstEthSnapshot rejects invalid subjects and unsupported RPC origins before network access", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    throw new Error("must not call provider");
  };

  const invalidAccount = await readBaseWstEthSnapshot({
    account: "not-an-address",
    graphBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    graphObservation: WSTETH_GRAPH_OBSERVATION,
    fetchImpl,
  });
  assert.deepEqual(invalidAccount, { status: "blocked", reason: "invalid_account" });

  const invalidUrl = await readBaseWstEthSnapshot({
    account: ACCOUNT,
    graphBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    graphObservation: WSTETH_GRAPH_OBSERVATION,
    rpcUrl: "http://evil.example/rpc",
    fetchImpl,
  });
  assert.deepEqual(invalidUrl, { status: "blocked", reason: "unsupported_rpc_url" });
  assert.equal(called, false);
});

test("readBaseWstEthSnapshot rejects a non-wstETH Graph observation", async () => {
  let called = false;
  const result = await readBaseWstEthSnapshot({
    account: ACCOUNT,
    graphBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    graphObservation: {
      ...WSTETH_GRAPH_OBSERVATION,
      asset: { ...WSTETH_GRAPH_OBSERVATION.asset, address: "0x0000000000000000000000000000000000000001" },
    },
    fetchImpl: async () => {
      called = true;
      throw new Error("must not call provider");
    },
  });

  assert.deepEqual(result, { status: "blocked", reason: "unsupported_underlying" });
  assert.equal(called, false);
});

test("readBaseWstEthSnapshot fails closed on block mismatch, empty code and malformed hex", async () => {
  const mismatch = await readBaseWstEthSnapshot({
    account: ACCOUNT,
    graphBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    graphObservation: WSTETH_GRAPH_OBSERVATION,
    fetchImpl: fakeRpcFetch({ blockHash: `0x${"ab".repeat(32)}` }).fetchImpl,
  });
  assert.deepEqual(mismatch, { status: "error", reason: "block_mismatch" });

  const noCode = await readBaseWstEthSnapshot({
    account: ACCOUNT,
    graphBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    graphObservation: WSTETH_GRAPH_OBSERVATION,
    fetchImpl: fakeRpcFetch({ code: "0x" }).fetchImpl,
  });
  assert.deepEqual(noCode, { status: "error", reason: "missing_contract_code" });

  const malformed = await readBaseWstEthSnapshot({
    account: ACCOUNT,
    graphBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    graphObservation: WSTETH_GRAPH_OBSERVATION,
    fetchImpl: fakeRpcFetch({ malformedSelector: SELECTORS.balanceOf }).fetchImpl,
  });
  assert.deepEqual(malformed, { status: "error", reason: "invalid_rpc_response" });
});

test("readBaseWstEthSnapshot sanitizes RPC errors", async () => {
  const result = await readBaseWstEthSnapshot({
    account: ACCOUNT,
    graphBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    graphObservation: WSTETH_GRAPH_OBSERVATION,
    fetchImpl: fakeRpcFetch({ rpcError: true }).fetchImpl,
  });

  assert.deepEqual(result, { status: "error", reason: "rpc_error" });
  assert.equal(JSON.stringify(result).includes("provider secret"), false);
});

test("readBaseWstEthSnapshot stays within the public Base RPC request budget", async () => {
  const fake = fakeRpcFetch();
  let calls = 0;
  const budgetedFetch = async (url: string, init?: RequestInit) => {
    calls += 1;
    if (calls > 8) {
      return {
        ok: false,
        status: 429,
        async json() {
          return { jsonrpc: "2.0", id: calls, error: { code: -32016, message: "over rate limit" } };
        },
      };
    }
    return fake.fetchImpl(url, init);
  };
  const result = await readBaseWstEthSnapshot({
    account: ACCOUNT,
    graphBlock: { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    graphObservation: WSTETH_GRAPH_OBSERVATION,
    fetchImpl: budgetedFetch,
  });

  assert.equal(result.status, "ok");
  assert.equal(calls, 8);
});
