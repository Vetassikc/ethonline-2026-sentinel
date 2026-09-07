import { runGraphPositionQuery } from "../api/app/graph-client.ts";

export function resolveGraphPositionOptions(env: Record<string, string | undefined> = process.env) {
  return {
    apiKey: env.GRAPH_API_KEY,
    subgraphId: env.GRAPH_SUBGRAPH_ID,
    chainId: env.GRAPH_CHAIN_ID,
    account: env.GRAPH_DEMO_ACCOUNT,
  };
}

if (process.argv[1]?.endsWith("/scripts/graph-position.ts")) {
  const result = await runGraphPositionQuery(resolveGraphPositionOptions());
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "ok") process.exitCode = 2;
}
