import { normalizePositionEvidence } from "../api/app/position-evidence.ts";
import { runGraphPositionQuery } from "../api/app/graph-client.ts";
import { resolveGraphPositionOptions } from "./graph-position.ts";

const options = resolveGraphPositionOptions();
const result = await runGraphPositionQuery(options);

if (result.status !== "ok") {
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 2;
} else {
  const evidence = normalizePositionEvidence(result, {
    expected_account: options.account,
    expected_chain_id: Number(options.chainId),
    expected_subgraph_id: options.subgraphId,
  });
  console.log(JSON.stringify(evidence, null, 2));
}
