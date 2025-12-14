import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tsconfig = JSON.parse(readFileSync(resolve(__dirname, "tsconfig.json"), "utf8"));
const baseUrl = tsconfig.compilerOptions?.baseUrl ?? ".";
const paths = (tsconfig.compilerOptions?.paths ?? {}) as Record<string, string[]>;
const alias: Record<string, string> = {};

for (const [key, values] of Object.entries(paths)) {
  const aliasKey = key.replace(/\/\*$/, "");
  const target = values[0]?.replace(/\/\*$/, "");
  if (target) {
    alias[aliasKey] = resolve(__dirname, baseUrl, target);
  }
}

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
  },
});
