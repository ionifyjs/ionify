
import { defineConfig } from "tsup";
import { readFileSync, mkdirSync, copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// read tsconfig paths
const tsconfig = JSON.parse(
  readFileSync(resolve("tsconfig.json"), "utf8")
);

const paths = (tsconfig.compilerOptions?.paths ?? {}) as Record<string, string[]>;
const baseUrl = tsconfig.compilerOptions?.baseUrl ?? ".";
const projectRoot = dirname(fileURLToPath(import.meta.url));
const baseDir = resolve(projectRoot, baseUrl);

export default defineConfig({
  entry: {
    "cli/index": "src/cli/index.ts",
    "index": "src/index.ts"
  },
  format: ["esm", "cjs"],
  dts: {
    entry: {
      "index": "src/index.ts",
      "cli/index": "src/cli/index.ts"
    }
  },
  outDir: "dist",
  shims: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  esbuildOptions(options) {
    options.alias = { ...(options.alias ?? {}) };
    for (const [key, values] of Object.entries(paths) as [string, string[]][]) {
      const aliasKey = key.replace("/*", "");
      const aliasValue = values[0].replace("/*", "");
      options.alias[aliasKey] = resolve(baseDir, aliasValue);
    }
  },
  onSuccess: async () => {
    console.log("✅ Aliases resolved in build output");
    
    // Copy worker.cjs to dist/core/worker and dist/cli (for both contexts)
    const workerSrc = resolve("src/core/worker/worker.cjs");
    const workerDestDir = resolve("dist/core/worker");
    const workerDest = resolve(workerDestDir, "worker.cjs");
    mkdirSync(workerDestDir, { recursive: true });
    copyFileSync(workerSrc, workerDest);
    
    // Also copy to dist/cli for CLI bundle context
    const cliWorkerDest = resolve("dist/cli/worker.cjs");
    copyFileSync(workerSrc, cliWorkerDest);
    console.log("✅ Copied worker.cjs to dist/core/worker and dist/cli");
    
    // Copy client runtime files to dist/client
    const clientSrc = resolve("src/client");
    const clientDest = resolve("dist/client");
    mkdirSync(clientDest, { recursive: true });
    
    const clientFiles = ["hmr.js", "overlay.js", "react-refresh-runtime.js"];
    for (const file of clientFiles) {
      const src = resolve(clientSrc, file);
      const dest = resolve(clientDest, file);
      copyFileSync(src, dest);
      console.log(`✅ Copied ${file} to dist/client`);
    }
  },
});
