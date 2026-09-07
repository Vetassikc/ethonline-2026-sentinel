import {
  EXPOSURE_GRAPH_TOOL_DEFINITION,
  runExposureGraphTool,
} from "../api/app/exposure-tool.ts";

const MAX_INPUT_BYTES = 32 * 1024;

async function readBoundedStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_INPUT_BYTES) throw new Error("input_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--describe")) {
    printJson(EXPOSURE_GRAPH_TOOL_DEFINITION);
    return;
  }

  let input: unknown;
  try {
    const raw = await readBoundedStdin();
    input = raw.length === 0 ? {} : JSON.parse(raw);
  } catch {
    printJson({ error: "invalid_tool_request", details: ["Tool input must be one JSON object within the 32768-byte limit."] });
    process.exitCode = 2;
    return;
  }

  try {
    const result = await runExposureGraphTool(input);
    printJson(result.payload);
    if (result.statusCode >= 400) process.exitCode = 2;
  } catch {
    printJson({ error: "tool_failed", details: ["The restricted exposure graph tool could not complete."] });
    process.exitCode = 2;
  }
}

await main();
