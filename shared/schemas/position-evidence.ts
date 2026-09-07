import type { VerdictAction } from "./sentinel.ts";

export type PositionEvidenceMode = "live" | "fixture";
export type EvidenceQualityDecision = "ACCEPT" | "DENY";

export interface PositionEvidenceObservation {
  position_id: string;
  account: string;
  asset: {
    address: string;
    symbol: string;
    name: string;
    decimals: number | null;
  };
  supplied: {
    raw: string | null;
    decimal: string | null;
    unit: string;
  };
  debt: {
    raw: string | null;
    decimal: string | null;
    unit: string;
  };
  stable_debt: {
    raw: string | null;
    decimal: string | null;
    unit: string;
  };
  variable_debt: {
    raw: string | null;
    decimal: string | null;
    unit: string;
  };
  collateral_enabled: boolean;
  position_updated_at: number | null;
  price_in_eth: {
    raw: string | null;
    source: string | null;
    updated_at: number | null;
    age_seconds: number | null;
    unit: "ETH";
  };
  source_paths: {
    position: string;
    account: string;
    asset: string;
    supplied: string;
    debt: string;
    price: string;
  };
}

export interface PositionEvidenceV1 {
  schema_version: "position_evidence.v1";
  mode: PositionEvidenceMode;
  subject: {
    chain_id: number;
    account: string;
    protocol: "aave-v3";
    deployment: {
      subgraph_id: string;
    };
  };
  query: {
    template_id: string;
    template_version: string;
    variables_hash: string;
  };
  source: {
    provider: "thegraph";
    subgraph_id: string;
    fetched_at: string;
    indexed_block: {
      number: number;
      hash: string | null;
      timestamp: number | null;
    };
    has_indexing_errors: boolean;
    index_age_seconds: number | null;
  };
  observations: PositionEvidenceObservation[];
  valuation: {
    unit: "ETH";
    usd_available: boolean;
    note: string;
  };
  pagination: {
    page_size: number;
    pages: number;
    complete: boolean;
  };
  gaps: string[];
  quality: {
    decision: EvidenceQualityDecision;
    reason_codes: string[];
  };
  evidence_hash: string;
}

export interface PositionEvidencePolicyDecision {
  policy_version: string;
  evidence_hash: string;
  evidence_quality: EvidenceQualityDecision;
  baseline_verdict: VerdictAction;
  verdict: VerdictAction;
  reason_code: string;
  reason_detail: string[];
  requested_notional_usd: string;
  allowed_notional_usd: string;
}

export interface EvidencePermitPayload {
  schema_version: "position-evidence-permit.v1";
  policy_version: string;
  intent_hash: string;
  evidence_hash: string;
  subject_chain_id: number;
  subject_account: string;
  verdict: VerdictAction;
  authorized_notional_usd: string;
  issued_at: string;
  expires_at: string;
  nonce: string;
  audience: string;
}

export interface EvidencePermitTypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  primaryType: "PositionEvidencePermit";
  types: {
    PositionEvidencePermit: Array<{ name: string; type: string }>;
  };
  message: {
    schemaVersion: string;
    policyVersion: string;
    intentHash: string;
    evidenceHash: string;
    subjectChainId: string;
    subjectAccount: string;
    verdict: string;
    authorizedNotionalUsd: string;
    issuedAt: string;
    expiresAt: string;
    nonce: string;
    audience: string;
  };
}

export interface SignedEvidencePermit {
  schema_version: "position-evidence-permit.v1";
  payload: EvidencePermitPayload;
  typed_data: EvidencePermitTypedData;
  permit_hash: string;
  signature: string;
  signer: string;
  demo_only: true;
}
