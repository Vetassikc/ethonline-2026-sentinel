export const EXPOSURE_GRAPH_SCHEMA_VERSION = "exposure_graph.v1" as const;
export const EXPOSURE_REQUEST_SCHEMA_VERSION = "sentinel-exposure-buy.v1" as const;
export const EXPOSURE_EVALUATION_SCHEMA_VERSION = "exposure_evaluation.v1" as const;
export const EXPOSURE_PERMIT_SCHEMA_VERSION = "sentinel-exposure-permit.v1" as const;

export type ExposureMode = "live" | "fixture" | "replay";
export type ExposureSourceStatus = "ok" | "blocked" | "error";
export type ExposureUnit = "wstETH";
export type ExposureNodeType =
  | "account"
  | "holding"
  | "protocol_position"
  | "asset"
  | "protocol";
export type ExposureEdgeType = "holds" | "supplied_claim_on" | "uses_pool";
export type ExposurePathKind = "direct_holding" | "aave_supply";

export type ExposureQuantity = {
  raw: string;
  decimal: string;
  decimals: number;
  unit: ExposureUnit;
};

export type ExposureProvenance = {
  source_kind: "thegraph" | "base_rpc" | "derived";
  source_path: string;
  contract: string | null;
  method: string | null;
  chain_id: number;
  deployment: string;
  block_number: number;
  block_hash: string;
  block_timestamp: number;
  transformation: string;
};

export type ExposureNode = {
  id: string;
  type: ExposureNodeType;
  label: string;
  chain_id: number;
  address: string | null;
  asset: string | null;
  quantity: ExposureQuantity | null;
};

export type ExposureEdge = {
  id: string;
  type: ExposureEdgeType;
  from: string;
  to: string;
  quantity: ExposureQuantity | null;
  provenance: ExposureProvenance;
};

export type ExposurePath = {
  id: string;
  kind: ExposurePathKind;
  unit: ExposureUnit;
  asset_id: string;
  raw_quantity: string;
  decimal_quantity: string;
  decimals: number;
  capital_contribution: boolean;
  representation_of: string;
  edge_ids: string[];
};

export type ExposureDebtObservation = {
  id: string;
  quantity: ExposureQuantity;
  source_path: string;
  block_number: number;
  block_hash: string;
};

export type ExposureGraphV1 = {
  schema_version: typeof EXPOSURE_GRAPH_SCHEMA_VERSION;
  mode: ExposureMode;
  source_status: ExposureSourceStatus;
  subject: { account: string; chain_id: number };
  source: {
    graph_subgraph_id: string;
    graph_endpoint: string;
    rpc_endpoint: string;
    block: { number: number; hash: string; timestamp: number };
  };
  nodes: ExposureNode[];
  edges: ExposureEdge[];
  paths: ExposurePath[];
  debt: ExposureDebtObservation[];
  gaps: string[];
  graph_hash: string;
};

export type ExposureRequest = {
  schema_version: typeof EXPOSURE_REQUEST_SCHEMA_VERSION;
  action: "BUY_EXPOSURE";
  asset: "wstETH";
  unit: "wstETH";
  requested_units: string;
};

export type ExposurePolicyConfig = {
  policy_version: string;
  dependency_cap_units: string;
  unit: ExposureUnit;
};

export type ExposurePolicyDecision = {
  verdict: "ALLOW" | "ALLOW_WITH_DOWNSIZE" | "DENY";
  requested_units: string;
  allowed_units: string;
  dependency_cap_units: string;
  gross_exposure_units: string | null;
  headroom_units: string | null;
  binding_constraint: "dependency_cap" | "source_quality" | "request" | "none";
  policy_version: string;
  unit: ExposureUnit;
  reason_codes: string[];
  debt_units: string | null;
};

export type ExposureEvaluation = {
  schema_version: typeof EXPOSURE_EVALUATION_SCHEMA_VERSION;
  mode: ExposureMode;
  request: ExposureRequest;
  graph: ExposureGraphV1;
  policy: ExposurePolicyDecision;
  created_at: string;
  expires_at: string;
};

export type ExposurePermitPayload = {
  schema_version: typeof EXPOSURE_PERMIT_SCHEMA_VERSION;
  action: "BUY_EXPOSURE";
  asset: "wstETH";
  unit: "wstETH";
  chain_id: number;
  account: string;
  authorized_units: string;
  dependency_cap_units: string;
  policy_version: string;
  graph_hash: string;
  snapshot_block: number;
  issued_at: number;
  expires_at: number;
  nonce: string;
  audience: string;
};
