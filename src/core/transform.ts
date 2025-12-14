export interface TransformContext {
  path: string;
  code: string;
  ext: string;
  /**
   * Optional precomputed module hash (IR hash). When provided, CAS + cache will
   * be keyed on this hash to stay aligned with the bundler/graph.
   */
  moduleHash?: string;
}

export interface TransformResult {
  code: string;
  map?: string;
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
  private readonly cacheVersion = "v1";
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
    const { getCasArtifactPath } = await import("@core/utils/cas");
    const moduleHash = ctx.moduleHash || getCacheKey(ctx.code);
    const loaderSig = this.loaders.map((l) => l.name || "loader").join("|");
    const loaderHash = getCacheKey(loaderSig);
    const memKey = `${moduleHash}-${loaderHash}`;
    const casDir =
      this.casRoot && this.versionHash
        ? getCasArtifactPath(this.casRoot, this.versionHash, moduleHash)
        : null;
    const casFile = casDir ? path.join(casDir, "transformed.js") : null;
    const casMapFile = casDir ? path.join(casDir, "transformed.js.map") : null;

    const debug = process.env.IONIFY_DEV_TRANSFORM_CACHE_DEBUG === "1";

    if (this.cacheEnabled) {
      const memHit = transformCache.get(memKey);
      if (memHit) {
        if (debug) {
          // eslint-disable-next-line no-console
          console.log(`[Dev Cache] HIT mem key=${memKey} size=${transformCache.metrics().size}`);
        }
        return { code: memHit.transformed, map: memHit.map };
      }
      if (casFile && fs.existsSync(casFile)) {
        try {
          const code = fs.readFileSync(casFile, "utf8");
          const map =
            casMapFile && fs.existsSync(casMapFile)
              ? fs.readFileSync(casMapFile, "utf8")
              : undefined;
          const parsed: TransformResult = { code, map };
          transformCache.set(memKey, {
            hash: moduleHash,
            loaderHash,
            transformed: parsed.code,
            map: parsed.map,
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
    let result: TransformResult = { code: ctx.code };
    for (const loader of this.loaders) {
      if (!loader.test(working)) continue;
      // Each loader sees the latest code emitted by previous loaders.
      const output = await loader.transform({ ...working, code: result.code });
      if (output && output.code !== undefined) {
        result = { ...result, ...output };
        working = { ...working, code: result.code };
      }
    }

    if (this.cacheEnabled) {
      transformCache.set(memKey, {
        hash: moduleHash,
        loaderHash,
        transformed: result.code,
        map: result.map,
        timestamp: Date.now(),
      });
      if (casFile) {
        try {
          fs.mkdirSync(path.dirname(casFile), { recursive: true });
          fs.writeFileSync(casFile, result.code, "utf8");
          if (result.map && casMapFile) {
            fs.writeFileSync(casMapFile, typeof result.map === "string" ? result.map : JSON.stringify(result.map), "utf8");
          }
        } catch {
          // ignore CAS write errors
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

