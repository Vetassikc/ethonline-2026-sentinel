import {
  evaluateExposureRequest,
  type ExposureServiceDependencies,
} from "./exposure-service.ts";
import { validateExposureRequest } from "./exposure-request.ts";
import type { ExposureRequest } from "../../shared/schemas/exposure-graph.ts";

export const EXPOSURE_GRAPH_TOOL_NAME = "sentinel_exposure_graph";
export const EXPOSURE_GRAPH_TOOL_SCHEMA_VERSION = "exposure-graph-tool.v1";

export const EXPOSURE_GRAPH_TOOL_DEFINITION = {
  name: EXPOSURE_GRAPH_TOOL_NAME,
  description:
    "Read-only, source-attributed wstETH exposure graph and bounded paper-purchase policy evaluation.",
  readOnly: true,
  capabilities: ["exposure_graph", "source_attribution", "policy_evaluation"] as const,
  inputSchema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["schema_version", "action", "asset", "unit", "requested_units"] as const,
    properties: {
      schema_version: {
        type: "string" as const,
        const: "sentinel-exposure-buy.v1",
      },
      action: {
        type: "string" as const,
        const: "BUY_EXPOSURE",
      },
      asset: {
        type: "string" as const,
        const: "wstETH",
      },
      unit: {
        type: "string" as const,
        const: "wstETH",
      },
      requested_units: {
        type: "string" as const,
        description: "Non-negative wstETH amount with at most 18 decimal places.",
      },
    },
  },
} as const;

type ExposureGraphToolValidation =
  | { ok: true; request: ExposureRequest }
  | {
    ok: false;
    error: { error: "invalid_tool_request"; details: string[] };
  };

function invalid(details: string[]): ExposureGraphToolValidation {
  return { ok: false, error: { error: "invalid_tool_request", details } };
}

export function validateExposureGraphToolRequest(input: unknown): ExposureGraphToolValidation {
  const validation = validateExposureRequest(input);
  if (!validation.ok) return invalid(validation.error.details);
  return { ok: true, request: validation.request };
}

export async function runExposureGraphTool(
  input: unknown,
  dependencies: ExposureServiceDependencies = {},
): Promise<{ statusCode: number; payload: unknown }> {
  const validation = validateExposureGraphToolRequest(input);
  if (!validation.ok) return { statusCode: 400, payload: validation.error };

  const result = await evaluateExposureRequest(validation.request, dependencies);
  return {
    statusCode: result.status === "ok" ? 200 : 503,
    payload: {
      tool_name: EXPOSURE_GRAPH_TOOL_NAME,
      schema_version: EXPOSURE_GRAPH_TOOL_SCHEMA_VERSION,
      request: validation.request,
      query_plan: {
        provider: "thegraph+base-rpc",
        graph_template_id: "aave-v3-user-reserves-exposure",
        graph_template_version: "2",
        rpc_host: "https://mainnet.base.org",
        account_source: "server_configuration",
        chain_source: "server_configuration",
        policy_source: "server_configuration",
        max_pages: 10,
        read_only: true,
      },
      result,
    },
  };
}
