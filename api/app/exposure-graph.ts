import { keccak256, toUtf8Bytes } from "ethers";

import {
  BASE_AAVE_POOL_ADDRESS,
  BASE_AAVE_WSTETH_ATOKEN_ADDRESS,
  BASE_MAINNET_CHAIN_ID,
  BASE_WSTETH_ADDRESS,
  type BaseWstEthSnapshot,
} from "./base-rpc.ts";
import type { GraphPositionEvidence, GraphPositionObservation } from "./graph-client.ts";
import { canonicalStringify, rawIntegerToDecimal } from "./position-evidence.ts";
import type {
  ExposureDebtObservation,
  ExposureEdge,
  ExposureGraphV1,
  ExposureMode,
  ExposureNode,
  ExposurePath,
  ExposureProvenance,
  ExposureQuantity,
} from "../../shared/schemas/exposure-graph.ts";

const DECIMALS = 18;
const UNIT = "wstETH" as const;

export type ExposureGraphBuildResult =
  | { status: "ok"; graph: ExposureGraphV1 }
  | {
    status: "error";
    reason:
      | "invalid_graph"
      | "invalid_source"
      | "block_mismatch"
      | "unsupported_asset"
      | "missing_wsteth_observation"
      | "duplicate_path_id"
      | "malformed_quantity"
      | "missing_required_source"
      | "a_token_underlying_mismatch"
      | "contract_relation_failed"
      | "scaled_supply_mismatch";
  };

function normalizeAddress(value: string | null | undefined): string | null {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) return null;
  return value.toLowerCase();
}

function isRawQuantity(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function quantity(raw: string): ExposureQuantity | null {
  if (!isRawQuantity(raw)) return null;
  try {
    return {
      raw,
      decimal: rawIntegerToDecimal(raw, DECIMALS),
      decimals: DECIMALS,
      unit: UNIT,
    };
  } catch {
    return null;
  }
}

function provenance(
  sourceKind: ExposureProvenance["source_kind"],
  sourcePath: string,
  deployment: string,
  block: { number: number; hash: string; timestamp: number },
  transformation: string,
  contract: string | null = null,
  method: string | null = null,
): ExposureProvenance {
  return {
    source_kind: sourceKind,
    source_path: sourcePath,
    contract,
    method,
    chain_id: BASE_MAINNET_CHAIN_ID,
    deployment,
    block_number: block.number,
    block_hash: block.hash,
    block_timestamp: block.timestamp,
    transformation,
  };
}

function baseNode(
  id: string,
  type: ExposureNode["type"],
  label: string,
  address: string | null,
  asset: string | null,
  nodeQuantity: ExposureQuantity | null = null,
): ExposureNode {
  return {
    id,
    type,
    label,
    chain_id: BASE_MAINNET_CHAIN_ID,
    address,
    asset,
    quantity: nodeQuantity,
  };
}

function findCandidate(
  observations: GraphPositionObservation[],
): { status: "ok"; observation: GraphPositionObservation } | ExposureGraphBuildResult {
  const ids = new Set<string>();
  for (const observation of observations) {
    if (ids.has(observation.id)) return { status: "error", reason: "duplicate_path_id" };
    ids.add(observation.id);
  }

  const wstEthSymbolRows = observations.filter(
    (observation) => observation.asset.symbol.toLowerCase() === "wsteth",
  );
  if (wstEthSymbolRows.some((observation) => normalizeAddress(observation.asset.address) !== BASE_WSTETH_ADDRESS)) {
    return { status: "error", reason: "unsupported_asset" };
  }
  const candidates = observations.filter(
    (observation) => normalizeAddress(observation.asset.address) === BASE_WSTETH_ADDRESS,
  );
  if (candidates.length === 0) return { status: "error", reason: "missing_wsteth_observation" };
  if (candidates.length > 1) return { status: "error", reason: "duplicate_path_id" };
  return { status: "ok", observation: candidates[0]! };
}

function buildDebt(
  observation: GraphPositionObservation,
  block: { number: number; hash: string },
): ExposureDebtObservation[] | null {
  if (observation.debt_raw === null) return [];
  const debtQuantity = quantity(observation.debt_raw);
  if (!debtQuantity) return null;
  return [{
    id: `debt:aave:${observation.id.toLowerCase()}`,
    quantity: debtQuantity,
    source_path: "userReserves[].currentTotalDebt",
    block_number: block.number,
    block_hash: block.hash,
  }];
}

export function buildExposureGraph(options: {
  graph: GraphPositionEvidence;
  rpc: BaseWstEthSnapshot;
  mode?: ExposureMode;
}): ExposureGraphBuildResult {
  const graph = options.graph;
  const rpc = options.rpc;
  if (!graph || graph.status !== "ok") return { status: "error", reason: "invalid_graph" };

  const graphBlock = graph.source.indexed_block;
  if (
    graph.subject.chain_id !== BASE_MAINNET_CHAIN_ID
    || graphBlock.number <= 0
    || !graphBlock.hash
    || graphBlock.timestamp === null
    || rpc.block.number <= 0
    || !rpc.block.hash
  ) {
    return { status: "error", reason: "invalid_source" };
  }
  if (
    graphBlock.number !== rpc.block.number
    || graphBlock.hash.toLowerCase() !== rpc.block.hash.toLowerCase()
    || graphBlock.timestamp !== rpc.block.timestamp
  ) {
    return { status: "error", reason: "block_mismatch" };
  }
  if (
    rpc.contracts.underlying !== BASE_WSTETH_ADDRESS
    || rpc.contracts.a_token !== BASE_AAVE_WSTETH_ATOKEN_ADDRESS
    || rpc.contracts.pool !== BASE_AAVE_POOL_ADDRESS
    || !rpc.contracts.a_token_underlying_matches
    || !rpc.contracts.decimals_match
    || rpc.gaps.length > 0
  ) {
    return { status: "error", reason: "contract_relation_failed" };
  }

  const candidateResult = findCandidate(graph.observations);
  if (candidateResult.status !== "ok") return candidateResult;
  const observation = candidateResult.observation;
  if (
    normalizeAddress(observation.asset.address) !== BASE_WSTETH_ADDRESS
    || observation.asset.symbol.toLowerCase() !== "wsteth"
    || observation.asset.decimals !== DECIMALS
  ) {
    return { status: "error", reason: "unsupported_asset" };
  }
  if (!observation.a_token || observation.a_token.underlying_asset !== BASE_WSTETH_ADDRESS) {
    return { status: "error", reason: "a_token_underlying_mismatch" };
  }
  if (
    observation.a_token.address !== BASE_AAVE_WSTETH_ATOKEN_ADDRESS
    || observation.a_token.decimals !== DECIMALS
    || observation.pool_address !== BASE_AAVE_POOL_ADDRESS
  ) {
    return { status: "error", reason: "contract_relation_failed" };
  }
  if (!isRawQuantity(observation.scaled_supplied_raw) || observation.scaled_supplied_raw !== rpc.aave_scaled_supply_raw) {
    return { status: "error", reason: "scaled_supply_mismatch" };
  }

  const directQuantity = quantity(rpc.direct_balance_raw);
  const aaveQuantity = quantity(rpc.normalized_aave_supply_raw);
  const scaledQuantity = quantity(rpc.aave_scaled_supply_raw);
  if (!directQuantity || !aaveQuantity || !scaledQuantity) {
    return { status: "error", reason: "malformed_quantity" };
  }
  const debt = buildDebt(observation, { number: graphBlock.number, hash: graphBlock.hash });
  if (debt === null) return { status: "error", reason: "malformed_quantity" };

  const account = graph.subject.account.toLowerCase();
  const assetId = `asset:base:${BASE_WSTETH_ADDRESS}`;
  const holdingId = `holding:direct:${BASE_WSTETH_ADDRESS}`;
  const protocolPositionId = `protocol-position:aave:${BASE_AAVE_WSTETH_ATOKEN_ADDRESS}`;
  const protocolId = `protocol:aave-v3:base`;
  const block = {
    number: graphBlock.number,
    hash: graphBlock.hash.toLowerCase(),
    timestamp: graphBlock.timestamp,
  };
  const graphDeployment = graph.source.subgraph_id;
  const rpcDeployment = "base-mainnet";
  const derivedTransformation = "rayMul(scaledATokenBalance, getReserveNormalizedIncome)";

  const directProvenance = provenance(
    "base_rpc",
    "eth_call:balanceOf(address)",
    rpcDeployment,
    block,
    "identity",
    BASE_WSTETH_ADDRESS,
    "balanceOf(address)",
  );
  const aaveProvenance = provenance(
    "derived",
    "userReserves[].scaledATokenBalance + eth_call:getReserveNormalizedIncome(address)",
    `${graphDeployment}+${rpcDeployment}`,
    block,
    derivedTransformation,
    BASE_AAVE_POOL_ADDRESS,
    "getReserveNormalizedIncome(address)",
  );
  const relationProvenance = provenance(
    "thegraph",
    "userReserves[].reserve.aToken.underlyingAssetAddress",
    graphDeployment,
    block,
    "relation_validation",
    BASE_AAVE_WSTETH_ATOKEN_ADDRESS,
    "UNDERLYING_ASSET_ADDRESS()",
  );
  const poolProvenance = provenance(
    "base_rpc",
    "eth_getCode + Graph reserve.pool.pool",
    `${graphDeployment}+${rpcDeployment}`,
    block,
    "relation_validation",
    BASE_AAVE_POOL_ADDRESS,
    null,
  );

  const edges: ExposureEdge[] = [
    {
      id: `edge:holds:${account}:${holdingId}`,
      type: "holds",
      from: `account:${account}`,
      to: holdingId,
      quantity: directQuantity,
      provenance: directProvenance,
    },
    {
      id: `edge:holds:${account}:${protocolPositionId}`,
      type: "holds",
      from: `account:${account}`,
      to: protocolPositionId,
      quantity: aaveQuantity,
      provenance: aaveProvenance,
    },
    {
      id: `edge:supplied_claim_on:${protocolPositionId}:${assetId}`,
      type: "supplied_claim_on",
      from: protocolPositionId,
      to: assetId,
      quantity: aaveQuantity,
      provenance: relationProvenance,
    },
    {
      id: `edge:uses_pool:${protocolPositionId}:${protocolId}`,
      type: "uses_pool",
      from: protocolPositionId,
      to: protocolId,
      quantity: null,
      provenance: poolProvenance,
    },
  ];
  const paths: ExposurePath[] = [
    {
      id: `path:direct:${BASE_WSTETH_ADDRESS}`,
      kind: "direct_holding",
      unit: UNIT,
      asset_id: assetId,
      raw_quantity: directQuantity.raw,
      decimal_quantity: directQuantity.decimal,
      decimals: DECIMALS,
      capital_contribution: true,
      representation_of: assetId,
      edge_ids: [edges[0]!.id],
    },
    {
      id: `path:aave:${BASE_AAVE_WSTETH_ATOKEN_ADDRESS}`,
      kind: "aave_supply",
      unit: UNIT,
      asset_id: assetId,
      raw_quantity: aaveQuantity.raw,
      decimal_quantity: aaveQuantity.decimal,
      decimals: DECIMALS,
      capital_contribution: true,
      representation_of: assetId,
      edge_ids: [edges[1]!.id, edges[2]!.id, edges[3]!.id],
    },
  ];
  const nodes: ExposureNode[] = [
    baseNode(`account:${account}`, "account", "Observed account", account, null),
    baseNode(holdingId, "holding", "Direct wstETH holding", BASE_WSTETH_ADDRESS, assetId, directQuantity),
    baseNode(
      protocolPositionId,
      "protocol_position",
      "Aave V3 wstETH supply claim",
      BASE_AAVE_WSTETH_ATOKEN_ADDRESS,
      assetId,
      aaveQuantity,
    ),
    baseNode(assetId, "asset", "Base bridged wstETH", BASE_WSTETH_ADDRESS, assetId),
    baseNode(protocolId, "protocol", "Aave V3 Base", BASE_AAVE_POOL_ADDRESS, null),
  ];

  const graphWithoutHash: Omit<ExposureGraphV1, "graph_hash"> = {
    schema_version: "exposure_graph.v1",
    mode: options.mode ?? graph.mode,
    source_status: "ok",
    subject: { account, chain_id: BASE_MAINNET_CHAIN_ID },
    source: {
      graph_subgraph_id: graph.source.subgraph_id,
      graph_endpoint: graph.source.endpoint,
      rpc_endpoint: rpc.rpc_endpoint,
      block,
    },
    nodes,
    edges,
    paths,
    debt,
    gaps: [...new Set(graph.gaps)],
  };

  return {
    status: "ok",
    graph: {
      ...graphWithoutHash,
      graph_hash: keccak256(toUtf8Bytes(canonicalStringify(graphWithoutHash))),
    },
  };
}
