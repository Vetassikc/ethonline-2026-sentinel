import {
  buildPositionEvidenceEvaluation,
  type PositionEvidenceRequestDependencies,
} from "./server.ts";
import {
  isScenarioName,
  loadScenarioIntent,
  type ScenarioName,
} from "./scenarios.ts";

export const POSITION_EVIDENCE_TOOL_NAME = "sentinel_position_evidence";
export const POSITION_EVIDENCE_TOOL_SCHEMA_VERSION = "position-evidence-tool.v1";

export const POSITION_EVIDENCE_TOOL_DEFINITION = {
  name: POSITION_EVIDENCE_TOOL_NAME,
  description:
    "Read-only, source-attributed position evidence for one canonical Sentinel trade scenario.",
  readOnly: true,
  capabilities: ["position_observation", "evidence_normalization", "policy_evaluation"] as const,
  inputSchema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["scenario"] as const,
    properties: {
      scenario: {
        type: "string" as const,
        enum: [
          "allow-btc-buy",
          "deny-oversize-eth",
          "downsize-eth-buy",
          "fail-closed-oracle",
        ] as const,
        description: "Canonical trade scenario selected by the AI client.",
      },
    },
  },
} as const;

type PositionEvidenceToolRequest = {
  scenario: ScenarioName;
};

type PositionEvidenceToolValidation =
  | { ok: true; value: PositionEvidenceToolRequest }
  | {
      ok: false;
      error: {
        error: "invalid_tool_request";
        details: string[];
      };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validatePositionEvidenceToolRequest(
  input: unknown,
): PositionEvidenceToolValidation {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: {
        error: "invalid_tool_request",
        details: ["Tool input must be a JSON object."],
      },
    };
  }

  if (Object.keys(input).some((key) => key !== "scenario")) {
    return {
      ok: false,
      error: {
        error: "invalid_tool_request",
        details: ["Only the scenario field is accepted."],
      },
    };
  }

  if (typeof input.scenario !== "string" || !isScenarioName(input.scenario)) {
    return {
      ok: false,
      error: {
        error: "invalid_tool_request",
        details: [
          "scenario must be one of: allow-btc-buy, deny-oversize-eth, downsize-eth-buy, fail-closed-oracle.",
        ],
      },
    };
  }

  return {
    ok: true,
    value: { scenario: input.scenario },
  };
}

export async function runPositionEvidenceTool(
  input: unknown,
  dependencies: PositionEvidenceRequestDependencies = {},
): Promise<{ statusCode: number; payload: unknown }> {
  const validation = validatePositionEvidenceToolRequest(input);
  if (!validation.ok) {
    return {
      statusCode: 400,
      payload: validation.error,
    };
  }

  const intent = await loadScenarioIntent(validation.value.scenario);
  const evaluation = await buildPositionEvidenceEvaluation(intent, dependencies);

  return {
    statusCode: evaluation.statusCode,
    payload: {
      tool_name: POSITION_EVIDENCE_TOOL_NAME,
      schema_version: POSITION_EVIDENCE_TOOL_SCHEMA_VERSION,
      request: validation.value,
      query_plan: {
        provider: "thegraph",
        template_id: "aave-v3-user-reserves",
        template_version: "1",
        account_source: "server_configuration",
        chain_source: "server_configuration",
        max_pages: 10,
        read_only: true,
      },
      result: evaluation.payload,
    },
  };
}
