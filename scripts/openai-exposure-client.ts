import { runOpenAIExposureClient } from "../api/app/openai-exposure-client.ts";

const naturalLanguageRequest = process.argv.slice(2).join(" ").trim();
const result = await runOpenAIExposureClient({ naturalLanguageRequest });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.status !== "ok") process.exitCode = 2;
