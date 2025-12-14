/**
{
  "description": "Handles Ionify's production build command. Invokes Rust bundler, reads cached graph, and generates optimized bundles and manifest output.",
  "phase": 0,
  "todo": [
    "Implement buildCommand() entry.",
    "Load graph and cached module info.",
    "Invoke Rust bundler via napi bridge.",
    "Emit output files to /dist with manifest.json.",
    "Display build progress using spinner and logger."
  ]
}
*/

import fs from "fs";
import path from "path";
import { logInfo, logError } from "@cli/utils/logger";
import { loadIonifyConfig } from "@cli/utils/config";
import { resolveMinifier, applyMinifierEnv, type MinifierChoice } from "@cli/utils/minifier";
import { resolveTreeshake, applyTreeshakeEnv } from "@cli/utils/treeshake";
import { native, computeGraphVersion } from "@native/index";
import { getCasArtifactPath } from "@core/utils/cas";
import { resolveScopeHoist, applyScopeHoistEnv } from "@cli/utils/scope-hoist";
import { resolveOptimizationLevel, getOptimizationPreset } from "@cli/utils/optimization-level";
import { resolveParser, applyParserEnv } from "@cli/utils/parser";
import { generateBuildPlan, writeBuildManifest, emitChunks, writeAssetsManifest } from "@core/bundler";
import { TransformWorkerPool } from "@core/worker/pool";
import { getCacheKey, writeCache, readCache } from "@core/cache";

interface BuildOptions {
  outDir?: string;
  level?: number;
}

export async function runBuildCommand(options: BuildOptions = {}) {
  try {
    const config = await loadIonifyConfig();
    
    // Check if optimization level is specified (overrides individual settings)
    const optLevel = resolveOptimizationLevel(config?.optimizationLevel, {
      cliLevel: options.level,
      envLevel: process.env.IONIFY_OPTIMIZATION_LEVEL,
    });
    
    let minifier: MinifierChoice;
    const parserMode = resolveParser(config, { envMode: process.env.IONIFY_PARSER });
    let treeshake: ReturnType<typeof resolveTreeshake>;
    let scopeHoist: ReturnType<typeof resolveScopeHoist>;

    if (optLevel !== null) {
      // Use preset
      const preset = getOptimizationPreset(optLevel);
      minifier = preset.minifier;
      treeshake = preset.treeshake;
      scopeHoist = preset.scopeHoist;
      logInfo(`Using optimization level ${optLevel} (preset)`);
    } else {
      // Resolve individual settings
      minifier = resolveMinifier(config, { envVar: process.env.IONIFY_MINIFIER });
      treeshake = resolveTreeshake(config?.treeshake, {
        envMode: process.env.IONIFY_TREESHAKE,
        includeEnv: process.env.IONIFY_TREESHAKE_INCLUDE,
        excludeEnv: process.env.IONIFY_TREESHAKE_EXCLUDE,
      });
      scopeHoist = resolveScopeHoist(config?.scopeHoist, {
        envMode: process.env.IONIFY_SCOPE_HOIST,
        inlineEnv: process.env.IONIFY_SCOPE_HOIST_INLINE,
        constantEnv: process.env.IONIFY_SCOPE_HOIST_CONST,
        combineEnv: process.env.IONIFY_SCOPE_HOIST_COMBINE,
      });
    }

    applyMinifierEnv(minifier);
    applyParserEnv(parserMode);
    applyTreeshakeEnv(treeshake);
    applyScopeHoistEnv(scopeHoist);
    
    // Get entries from config and resolve to absolute paths BEFORE canonicalization
    const entries = config?.entry 
      ? [config.entry.startsWith('/') 
          ? path.join(process.cwd(), config.entry)
          : path.resolve(process.cwd(), config.entry)]
      : undefined;
    
    if (entries) {
      logInfo(`Build entries: ${entries.join(", ")}`);
    } else {
      logInfo(`No entries in config, planner will infer from graph`);
    }
    
    // Create version inputs for automatic cache invalidation
    // computeGraphVersion handles canonicalization internally to ensure consistency
    const pluginNames = Array.isArray(config?.plugins)
      ? config.plugins
          .map((p: any) => (typeof p === "string" ? p : p?.name))
          .filter((name): name is string => typeof name === "string" && name.length > 0)
      : undefined;
    const rawVersionInputs: Parameters<typeof computeGraphVersion>[0] = {
      parserMode,
      minifier,
      treeshake,
      scopeHoist,
      plugins: pluginNames,
      entry: entries ?? null,
      cssOptions: (config as any)?.css,
      assetOptions: (config as any)?.assets ?? (config as any)?.asset,
    };
    // Propagate config hash to native for AST/cache invalidation
    const configHash = computeGraphVersion(rawVersionInputs);
    logInfo(`[Build] Version hash: ${configHash}`);
    process.env.IONIFY_CONFIG_HASH = configHash;
    
    // Wave 5: Initialize AST cache with version hash
    if (native?.initAstCache) {
      const versionHash = JSON.stringify(rawVersionInputs);
      native.initAstCache(versionHash);
      logInfo(`AST cache initialized with version hash`);
    }
    
    const plan = await generateBuildPlan(entries, rawVersionInputs);
    const outDir = options.outDir || "dist";

    const moduleHashes = new Map<string, string>();
    for (const chunk of plan.chunks) {
      for (const mod of chunk.modules) {
        if (mod.hash) {
          moduleHashes.set(mod.id, mod.hash);
        }
      }
    }

    const uniqueModules = new Set<string>();
    for (const chunk of plan.chunks) {
      for (const mod of chunk.modules) uniqueModules.add(mod.id);
    }

    const moduleOutputs = new Map<string, { code: string; type: "js" | "css" | "asset" }>();

    const pool = new TransformWorkerPool();
    try {
      const jobs = Array.from(uniqueModules)
        .filter((filePath) => fs.existsSync(filePath))
        .map((filePath) => {
          const code = fs.readFileSync(filePath, "utf8");
          const sourceHash = getCacheKey(code);
          const moduleHash = moduleHashes.get(filePath) ?? sourceHash;
          const cacheKey = getCacheKey(`build-worker:v1:${path.extname(filePath)}:${moduleHash}:${filePath}`);
          const cached = readCache(cacheKey);
          if (cached) {
            try {
              const parsed = JSON.parse(cached.toString("utf8")) as { code: string; map?: string; type: "js" | "css" | "asset" };
              if (parsed?.code) {
                const transformedHash = getCacheKey(parsed.code);
                moduleHashes.set(filePath, transformedHash);
                // Ensure CAS has the cached transform so native bundler can read it.
                const casRoot = path.join(process.cwd(), ".ionify", "cas");
                const cacheDir = getCasArtifactPath(casRoot, configHash, transformedHash);
                if (!fs.existsSync(path.join(cacheDir, "transformed.js"))) {
                  fs.mkdirSync(cacheDir, { recursive: true });
                  fs.writeFileSync(path.join(cacheDir, "transformed.js"), parsed.code, "utf8");
                  if (parsed.map) {
                    fs.writeFileSync(path.join(cacheDir, "transformed.js.map"), parsed.map, "utf8");
                  }
                }
                moduleOutputs.set(filePath, { code: parsed.code, type: parsed.type ?? "js" });
                return null;
              }
            } catch {
              // ignore cache parse failure and schedule job
            }
          }
          return {
            id: filePath,
            filePath,
            ext: path.extname(filePath),
            code,
            cacheKey,
          };
        })
        .filter((job): job is { id: string; filePath: string; ext: string; code: string; cacheKey: string } => !!job);

      const results = await pool.runMany(
        jobs.map((job) => ({
          id: job.id,
          filePath: job.filePath,
          ext: job.ext,
          code: job.code,
        }))
      );
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const job = jobs[i];
        if (result.error) {
          throw new Error(`Transform failed for ${result.filePath}: ${result.error}`);
        }
        const payload = JSON.stringify({ code: result.code, map: result.map, type: result.type });
        writeCache(job.cacheKey, Buffer.from(payload));
        
        // Wave U1: write transformed code under unified CAS layout
        const transformedHash = getCacheKey(result.code);
        const moduleHash = transformedHash;
        const casRoot = path.join(process.cwd(), ".ionify", "cas");
        const versionHash = configHash;
        const cacheDir = getCasArtifactPath(casRoot, versionHash, moduleHash);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDir, "transformed.js"), result.code, "utf8");
        if (result.map) {
          fs.writeFileSync(path.join(cacheDir, "transformed.js.map"), result.map, "utf8");
        }
        moduleHashes.set(job.filePath, moduleHash);

        // Align plan hash with CAS folder hash for this module
        for (const chunk of plan.chunks) {
          for (const mod of chunk.modules) {
            if (mod.id === job.filePath) {
              mod.hash = moduleHash;
            }
          }
        }
        
        moduleOutputs.set(result.filePath, { code: result.code, type: result.type });
      }
    } finally {
      await pool.close();
    }

    // Align plan hashes with transformed CAS folder hashes so native bundler reads existing CAS.
    for (const chunk of plan.chunks) {
      for (const mod of chunk.modules) {
        const updatedHash = moduleHashes.get(mod.id);
        if (updatedHash) {
          mod.hash = updatedHash;
        }
      }
    }

    const absOutDir = path.resolve(outDir);

    const casRoot = path.join(process.cwd(), ".ionify", "cas");
    const { artifacts, stats } = await emitChunks(absOutDir, plan, moduleOutputs, {
      casRoot,
      versionHash: configHash,
    });
    await writeBuildManifest(absOutDir, plan, artifacts);
    await writeAssetsManifest(absOutDir, artifacts);
    await fs.promises.writeFile(
      path.join(absOutDir, "build.stats.json"),
      JSON.stringify(stats, null, 2),
      "utf8"
    );

    logInfo(`Build plan generated → ${path.join(absOutDir, "manifest.json")}`);
    logInfo(`Entries: ${plan.entries.length}, Chunks: ${plan.chunks.length}`);
    logInfo(`Modules transformed: ${moduleOutputs.size}`);
  } catch (err) {
    logError("ionify build failed", err);
    throw err;
  }
}



// ===== Next Phase TODOs =====
// Phase 3: Add parallel chunk planner.
// Phase 4: Integrate Vite/Rollup plugin compatibility.
// Phase 5: Include Analyzer summary after build.
