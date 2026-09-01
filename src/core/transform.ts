/**
{
  "description": "Ionify Transform Engine (optimized). Executes transform plugins only when file hash differs from cached entry. Supports plugin chaining.",
  "phase": 1.5,
  "todo": [
    "Integrate SWC/ESBuild in next phase.",
    "Implement thread-based transform workers."
  ]
}
*/

import type { CachedDepRegistration } from "@core/deps/registry";
import { restoreCachedDepRegistrations } from "@core/deps/registry";

export interface TransformContext {
  path: string;
  code: string;
  ext: string;
  /**
   * Optional Ionify config for loaders that need it (e.g. React Refresh entry detection).
   * Type-only to avoid runtime coupling.
   */
  config?: import("../types/config").IonifyConfig | null;
  /**
   * Optional precomputed module hash (IR hash). When provided, CAS + cache will
   * be keyed on this hash to stay aligned with the bundler/graph.
   */
  moduleHash?: string;
}

export interface TransformResult {
  code: string;
  map?: string;
  dependencyEntries?: CachedDepRegistration[];
  runtimeDependencies?: RuntimeDependencyFact[];
}

export interface RuntimeDependencyFact {
  specifier: string;
  kind: "static" | "dynamic";
}

export type LoaderTransform = (
  ctx: TransformContext
) => Promise<TransformResult | null> | TransformResult | null;

export interface Loader {
  name: string;
  test: (ctx: TransformContext) => boolean;
  transform: LoaderTransform;
  order?: number;
}

export interface TransformCacheEntry {
  hash: string;
  loaderHash: string;
  transformed: string;
  map?: any;
  dependencyEntries: CachedDepRegistration[];
  runtimeDependencies: RuntimeDependencyFact[];
  timestamp: number;
}

class TransformCache {
  private store = new Map<string, TransformCacheEntry>();
  private hits = 0;
  private misses = 0;
  private maxEntries: number;

  constructor(maxEntries?: number) {
    const envMax = process.env.IONIFY_DEV_TRANSFORM_CACHE_MAX;
    const parsedEnv = envMax ? parseInt(envMax, 10) : NaN;
    this.maxEntries = Number.isFinite(parsedEnv) ? parsedEnv : maxEntries ?? 5000;
  }

  setMaxEntries(maxEntries: number) {
    this.maxEntries = maxEntries;
    this.prune();
  }

  get(key: string): TransformCacheEntry | null {
    const entry = this.store.get(key);
    if (entry) {
      this.hits += 1;
      entry.timestamp = Date.now();
      return entry;
    }
    this.misses += 1;
    return null;
  }

  set(key: string, entry: TransformCacheEntry) {
    this.store.set(key, { ...entry, timestamp: Date.now() });
    this.prune();
  }

  prune(maxEntries?: number) {
    const limit = maxEntries ?? this.maxEntries;
    if (this.store.size <= limit) return;
    const sorted = Array.from(this.store.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    );
    const removeCount = this.store.size - limit;
    for (let i = 0; i < removeCount; i++) {
      this.store.delete(sorted[i][0]);
    }
  }

  metrics() {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      max: this.maxEntries,
    };
  }
}

export const transformCache = new TransformCache();

export class TransformEngine {
  private loaders: Loader[] = [];
  private readonly cacheEnabled: boolean;
  // Bump when the on-disk transform output format or semantics change.
  // Included in CAS paths so restarts never serve stale transformed output.
  private readonly cacheVersion = "v6";
  private readonly casRoot?: string;
  private readonly versionHash?: string;

  constructor(options?: { cache?: boolean; casRoot?: string; versionHash?: string }) {
    this.cacheEnabled = options?.cache ?? true;
    this.casRoot = options?.casRoot;
    this.versionHash = options?.versionHash;
  }

  useLoader(loader: Loader) {
    // Registry is kept sorted to provide deterministic execution for built-ins/user loaders.
    this.loaders.push(loader);
    this.loaders.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async run(ctx: TransformContext): Promise<TransformResult> {
    const { getCacheKey } = await import("@core/cache");
    const path = await import("path");
    const fs = await import("fs");
    const moduleHash = ctx.moduleHash || getCacheKey(ctx.code);
    const loaderSig = `${this.cacheVersion}|${this.loaders.map((l) => l.name || "loader").join("|")}`;
    const loaderHash = getCacheKey(loaderSig);
    const memKey = `${moduleHash}-${loaderHash}`;
    const casDir =
      this.casRoot && this.versionHash
        ? path.join(this.casRoot, this.versionHash, this.cacheVersion, loaderHash, moduleHash)
        : null;
    const casFile = casDir ? path.join(casDir, "transformed.js") : null;
    const casMapFile = casDir ? path.join(casDir, "transformed.js.map") : null;
    const casMetaFile = casDir ? path.join(casDir, "transform.meta.json") : null;
    const workspaceRoot = ctx.config?.root ? path.resolve(ctx.config.root) : process.cwd();

    const debug = process.env.IONIFY_DEV_TRANSFORM_CACHE_DEBUG === "1";

    if (this.cacheEnabled) {
      const memHit = transformCache.get(memKey);
      if (
        memHit &&
        restoreCachedDepRegistrations(memHit.dependencyEntries, workspaceRoot)
      ) {
        if (debug) {
          // eslint-disable-next-line no-console
          console.log(`[Dev Cache] HIT mem key=${memKey} size=${transformCache.metrics().size}`);
        }
        return {
          code: memHit.transformed,
          map: memHit.map,
          dependencyEntries: memHit.dependencyEntries,
          runtimeDependencies: memHit.runtimeDependencies,
        };
      }
      if (casFile && casMetaFile && fs.existsSync(casFile) && fs.existsSync(casMetaFile)) {
        try {
          const code = fs.readFileSync(casFile, "utf8");
          const meta = JSON.parse(fs.readFileSync(casMetaFile, "utf8")) as {
            version?: unknown;
            codeHash?: unknown;
            hasMap?: unknown;
            dependencyEntries?: unknown;
            runtimeDependencies?: unknown;
          };
          if (
            meta.version !== 2 ||
            meta.codeHash !== getCacheKey(code) ||
            typeof meta.hasMap !== "boolean" ||
            !Array.isArray(meta.dependencyEntries) ||
            !Array.isArray(meta.runtimeDependencies) ||
            !meta.runtimeDependencies.every(
              (dependency) =>
                dependency !== null &&
                typeof dependency === "object" &&
                typeof (dependency as any).specifier === "string" &&
                (dependency as any).specifier.length > 0 &&
                ((dependency as any).kind === "static" ||
                  (dependency as any).kind === "dynamic"),
            )
          ) {
            throw new Error("incomplete transform metadata");
          }
          const map = meta.hasMap
            ? casMapFile && fs.existsSync(casMapFile)
              ? fs.readFileSync(casMapFile, "utf8")
              : (() => {
                  throw new Error("missing transform source map");
                })()
            : undefined;
          const dependencyEntries = meta.dependencyEntries as CachedDepRegistration[];
          const runtimeDependencies = meta.runtimeDependencies as RuntimeDependencyFact[];
          if (!restoreCachedDepRegistrations(dependencyEntries, workspaceRoot)) {
            throw new Error("unrestorable transform dependency metadata");
          }
          const parsed: TransformResult = { code, map, dependencyEntries, runtimeDependencies };
          transformCache.set(memKey, {
            hash: moduleHash,
            loaderHash,
            transformed: parsed.code,
            map: parsed.map,
            dependencyEntries,
            runtimeDependencies,
            timestamp: Date.now(),
          });
          if (debug) {
            // eslint-disable-next-line no-console
            console.log(`[Dev Cache] HIT cas key=${memKey} size=${transformCache.metrics().size}`);
          }
          return parsed;
        } catch {
          // ignore CAS read errors
        }
      }
    }

    let working: TransformContext = { ...ctx };
    let result: TransformResult = {
      code: ctx.code,
      dependencyEntries: [],
      runtimeDependencies: [],
    };
    for (const loader of this.loaders) {
      if (!loader.test(working)) continue;
      // Each loader sees the latest code emitted by previous loaders.
      const output = await loader.transform({ ...working, code: result.code });
      if (output && output.code !== undefined) {
        const dependencyEntries = [
          ...(result.dependencyEntries ?? []),
          ...(output.dependencyEntries ?? []),
        ];
        const uniqueDependencyEntries = Array.from(
          new Map(dependencyEntries.map((entry) => [entry.fileName, entry])).values(),
        ).sort((a, b) => a.fileName.localeCompare(b.fileName));
        const runtimeDependencies = [
          ...(result.runtimeDependencies ?? []),
          ...(output.runtimeDependencies ?? []),
        ];
        const uniqueRuntimeDependencies = Array.from(
          new Map(
            runtimeDependencies.map((dependency) => [
              `${dependency.kind}:${dependency.specifier}`,
              dependency,
            ]),
          ).values(),
        ).sort((a, b) =>
          a.kind === b.kind
            ? a.specifier.localeCompare(b.specifier)
            : a.kind.localeCompare(b.kind),
        );
        result = {
          ...result,
          ...output,
          dependencyEntries: uniqueDependencyEntries,
          runtimeDependencies: uniqueRuntimeDependencies,
        };
        working = { ...working, code: result.code };
      }
    }

    if (this.cacheEnabled) {
      transformCache.set(memKey, {
        hash: moduleHash,
        loaderHash,
        transformed: result.code,
        map: result.map,
        dependencyEntries: result.dependencyEntries ?? [],
        runtimeDependencies: result.runtimeDependencies ?? [],
        timestamp: Date.now(),
      });
      if (casFile && casMetaFile) {
        const tempFiles: string[] = [];
        try {
          fs.mkdirSync(path.dirname(casFile), { recursive: true });
          const suffix = `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const codeTmp = `${casFile}${suffix}`;
          const metaTmp = `${casMetaFile}${suffix}`;
          tempFiles.push(codeTmp, metaTmp);
          fs.writeFileSync(codeTmp, result.code, "utf8");
          let mapTmp: string | null = null;
          if (result.map && casMapFile) {
            mapTmp = `${casMapFile}${suffix}`;
            tempFiles.push(mapTmp);
            fs.writeFileSync(mapTmp, typeof result.map === "string" ? result.map : JSON.stringify(result.map), "utf8");
          }
          fs.writeFileSync(
            metaTmp,
            JSON.stringify({
              version: 2,
              codeHash: getCacheKey(result.code),
              hasMap: Boolean(result.map),
              dependencyEntries: result.dependencyEntries ?? [],
              runtimeDependencies: result.runtimeDependencies ?? [],
            }),
            "utf8",
          );
          fs.renameSync(codeTmp, casFile);
          if (mapTmp && casMapFile) fs.renameSync(mapTmp, casMapFile);
          // The metadata marker is published last. A partial write is a cache miss.
          fs.renameSync(metaTmp, casMetaFile);
        } catch {
          // ignore CAS write errors
        } finally {
          for (const tempFile of tempFiles) {
            try {
              if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            } catch {
              // ignore temp cleanup errors
            }
          }
        }
      }
      if (debug) {
        const m = transformCache.metrics();
        // eslint-disable-next-line no-console
        console.log(`[Dev Cache] MISS stored key=${memKey} size=${m.size} hits=${m.hits} misses=${m.misses}`);
      }
    }
    return result;
  }
}

// ===== Next Phase TODOs =====
// Phase 2: integrate SWC for TS/JSX transforms + source maps.
// Phase 3: plugin loader from ionify.config.ts for user extensions.
