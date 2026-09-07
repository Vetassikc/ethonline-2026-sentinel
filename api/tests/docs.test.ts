import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(TEST_DIR, "../..");

test("proof and launch docs exist", () => {
  assert.equal(existsSync(resolve(ROOT_DIR, "docs/PROOF_INDEX.md")), true);
  assert.equal(existsSync(resolve(ROOT_DIR, "docs/SOCIAL_POST_FINAL.md")), true);
  assert.equal(existsSync(resolve(ROOT_DIR, "docs/ethonline-2026/GRAPH_SOURCE_MANIFEST.md")), true);
});
