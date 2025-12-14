/**
{
  "description": "Ionify Dev Server (Phase 1 Final). Integrates Graph, Cache, Resolver, Watcher, and Transform Engine. Performs incremental rebuilds and skips transforms on cache hits.",
  "phase": 1.5,
  "todo": [
    "Link watcher with graph invalidation.",
    "Perform incremental cache-aware transforms.",
    "Prepare live reload bridge (Phase 2)."
  ]
}
*/

/**
{
  "description": "Ionify Dev Server (Phase 2). Adds SSE-based HMR and CSS/asset loaders. Injects HMR client into HTML responses and broadcasts reload on changes.",
  "phase": 2,
  "todo": [
    "Serve /__ionify_hmr (SSE) and /__ionify_hmr_client.js",
    "Implement CSS '?inline' loader and asset '?import' loader",
    "Broadcast reload events on watcher changes"
  ]
}
*/

import type { IncomingMessage, ServerResponse } from "http";
import http from "http";
import url from "url";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { logInfo, logError, logWarn } from "@cli/utils/logger";
import { getCacheKey } from "@core/cache";
import { Graph } from "@core/graph";
import { extractImports, resolveImports } from "@core/resolver";
import { ModuleResolver } from "@core/resolver/module-resolver";
import { IonifyWatcher } from "@core/watcher";
import { TransformEngine, transformCache } from "@core/transform";
import { HMRServer, injectHMRClient, PendingHMRModule } from "@core/hmr";
import { compileCss, renderCssModule } from "@core/loaders/css";
import { isAssetExt, contentTypeForAsset, assetAsModule, normalizeUrlFromFs } from "@core/loaders/asset";
import { applyRegisteredLoaders } from "@core/loaders/registry";
import { loadIonifyConfig } from "@cli/utils/config";
import { resolveMinifier, applyMinifierEnv } from "@cli/utils/minifier";
import { loadEnv as loadIonifyEnv } from "@cli/utils/env";
import { resolveTreeshake, applyTreeshakeEnv } from "@cli/utils/treeshake";
import { resolveScopeHoist, applyScopeHoistEnv } from "@cli/utils/scope-hoist";
import { resolveParser, applyParserEnv } from "@cli/utils/parser";
import { decodePublicPath } from "@core/utils/public-path";
import { getCasArtifactPath } from "@core/utils/cas";
import { native, computeGraphVersion } from "@native/index";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// When running from dist/cli/index.js, __dirname is dist/cli
// We need to go up to dist, then into client: dist/cli -> dist -> dist/client
const CLIENT_DIR = path.resolve(__dirname, "../client");
const CLIENT_FALLBACK_DIR = path.resolve(process.cwd(), "src/client");

function readClientAssetFile(fileName: string): { filePath: string; code: string } {
  const primary = path.join(CLIENT_DIR, fileName);
  if (fs.existsSync(primary)) {
    return { filePath: primary, code: fs.readFileSync(primary, "utf8") };
  }
  const fallback = path.join(CLIENT_FALLBACK_DIR, fileName);
  if (fs.existsSync(fallback)) {
    return { filePath: fallback, code: fs.readFileSync(fallback, "utf8") };
  }
  throw new Error(`Missing Ionify client asset: ${fileName}`);
}

function readClientAsset(fileName: string): string {
  return readClientAssetFile(fileName).code;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if ([".mjs", ".js", ".ts", ".tsx", ".jsx", ".cjs", ".mts", ".cts"].includes(ext))
    return "application/javascript; charset=utf-8";
  // For binary files and other assets
  if ([".wasm"].includes(ext))
    return "application/wasm";
  if ([".map"].includes(ext))
    return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

type HMRModuleResponse =
  | {
      url: string;
      hash: string | null;
      deps: string[];
      reason: PendingHMRModule["reason"];
      status: "deleted";
    }
  | {
      url: string;
      hash: string;
      deps: string[];
      reason: PendingHMRModule["reason"];
      status: "updated";
      code: string;
    };

export interface StartDevServerOptions {
  port?: number;
  enableSignalHandlers?: boolean;
}

export interface DevServerHandle {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

export async function startDevServer({
  port = 5173,
  enableSignalHandlers = true,
}: StartDevServerOptions = {}): Promise<DevServerHandle> {
  const rootDir = process.cwd();
  const watcher = new IonifyWatcher(rootDir);
  const cacheDebug = process.env.IONIFY_DEV_TRANSFORM_CACHE_DEBUG === "1";
  const userConfig = await loadIonifyConfig();
  // Honor project/ENV minifier selection consistently in dev
  const minifier = resolveMinifier(userConfig, { envVar: process.env.IONIFY_MINIFIER });
  applyMinifierEnv(minifier);
  const parserMode = resolveParser(userConfig, { envMode: process.env.IONIFY_PARSER });
  applyParserEnv(parserMode);
  const treeshake = resolveTreeshake(userConfig?.treeshake, {
    envMode: process.env.IONIFY_TREESHAKE,
    includeEnv: process.env.IONIFY_TREESHAKE_INCLUDE,
    excludeEnv: process.env.IONIFY_TREESHAKE_EXCLUDE,
  });
  applyTreeshakeEnv(treeshake);
  const scopeHoist = resolveScopeHoist(userConfig?.scopeHoist, {
    envMode: process.env.IONIFY_SCOPE_HOIST,
    inlineEnv: process.env.IONIFY_SCOPE_HOIST_INLINE,
    constantEnv: process.env.IONIFY_SCOPE_HOIST_CONST,
    combineEnv: process.env.IONIFY_SCOPE_HOIST_COMBINE,
  });
  applyScopeHoistEnv(scopeHoist);

  // Resolve entry to absolute path BEFORE canonicalization
  // Handle paths starting with '/' using path.join, not path.resolve
  const resolvedEntry = userConfig?.entry 
    ? (userConfig.entry.startsWith('/') 
        ? path.join(rootDir, userConfig.entry)
        : path.resolve(rootDir, userConfig.entry))
    : undefined;

  // Create graph with version inputs for automatic cache invalidation
  // computeGraphVersion handles canonicalization internally to ensure consistency
  const pluginNames = Array.isArray(userConfig?.plugins)
    ? userConfig.plugins
        .map((p: any) => (typeof p === "string" ? p : p?.name))
        .filter((name): name is string => typeof name === "string" && name.length > 0)
    : undefined;
  const rawVersionInputs: Parameters<typeof computeGraphVersion>[0] = {
    parserMode,
    minifier,
    treeshake,
    scopeHoist,
    plugins: pluginNames,
    entry: resolvedEntry ? [resolvedEntry] : null,
    cssOptions: (userConfig as any)?.css,
    assetOptions: (userConfig as any)?.assets ?? (userConfig as any)?.asset,
  };
  const configHash = computeGraphVersion(rawVersionInputs);
  logInfo(`[Dev] Version hash: ${configHash}`);
  process.env.IONIFY_CONFIG_HASH = configHash;
  const casRoot = path.join(rootDir, ".ionify", "cas");
  
  // Initialize transformer with CAS after configHash is computed
  const transformer = new TransformEngine({ casRoot, versionHash: configHash });
  
  const graph = new Graph(rawVersionInputs);
  
  // Wave 5: Initialize AST cache with version hash
  if (native?.initAstCache) {
    const versionHash = JSON.stringify(rawVersionInputs);
    native.initAstCache(versionHash);
    logInfo(`AST cache initialized with version hash`);
    // Warm-up AST cache for recently modified files
    if (native?.astCacheWarmup) {
      try {
        native.astCacheWarmup();
      } catch (err) {
        logWarn(`AST cache warmup skipped: ${err}`);
      }
    }
    if (native?.astCacheStats) {
      try {
        const stats = native.astCacheStats();
        const entries = (stats as any).total_entries ?? (stats as any).totalEntries ?? 0;
        const sizeBytes = (stats as any).total_size_bytes ?? (stats as any).totalSizeBytes ?? 0;
        const hits = (stats as any).total_hits ?? (stats as any).totalHits ?? 0;
        const hitRate = (stats as any).hit_rate ?? (stats as any).hitRate ?? 0;
        logInfo(`[AST Cache] entries=${entries}, size=${sizeBytes} bytes, hits=${hits}, hitRate=${hitRate}`);
      } catch {
        // ignore stats errors
      }
    }
  }

  // Initialize module resolver with config
  const moduleResolver = new ModuleResolver(rootDir, {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs'],
    conditions: ['import', 'default'],
    mainFields: ['module', 'main'],
    ...(userConfig?.resolve || {})
  });
  // Built-in + user loaders (from ionify.config) are wired into the transform engine here.
  await applyRegisteredLoaders(transformer, userConfig);
  const hmr = new HMRServer();
  const envFromFiles = loadIonifyEnv("development", rootDir);
  process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
  process.env.MODE = process.env.MODE ?? "development";
  const envValues: Record<string, string> = {
    ...envFromFiles,
    NODE_ENV: process.env.NODE_ENV,
    MODE: process.env.MODE,
  };
  const envPlaceholderPattern = /%([A-Z0-9_]+)%/g;
  const envEnabledExts = new Set([
    ".html",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx",
  ]);
  const applyEnvPlaceholders = (input: string, extname: string): string => {
    if (!envEnabledExts.has(extname)) return input;
    return input.replace(envPlaceholderPattern, (match, key) => {
      if (
        key === "NODE_ENV" ||
        key === "MODE" ||
        key.startsWith("VITE_") ||
        key.startsWith("IONIFY_")
      ) {
        const replacement = envValues[key];
        return replacement !== undefined ? replacement : match;
      }
      return match;
    });
  };

  const parseJsonBody = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve());
      req.on("error", (err) => reject(err));
    });
    if (!chunks.length) return null;
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  };

  const sendJson = (res: ServerResponse, status: number, payload: unknown) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(body);
  };

  const buildUpdatePayload = async (
    modules: PendingHMRModule[],
  ): Promise<HMRModuleResponse[]> => {
    const updates: HMRModuleResponse[] = [];
    for (const mod of modules) {
      // Deleted files short-circuit: drop from graph + watcher.
      const exists = fs.existsSync(mod.absPath);
      if (mod.reason === "deleted" || !exists) {
        graph.removeFile(mod.absPath);
        watcher.unwatchFile(mod.absPath);
        updates.push({
          url: mod.url,
          hash: null,
          deps: [],
          reason: mod.reason,
          status: "deleted",
        });
        continue;
      }

      watcher.watchFile(mod.absPath);

      let code: string;
      try {
        code = fs.readFileSync(mod.absPath, "utf8");
      } catch (err) {
        logError("Failed to read module during HMR apply", err);
        throw err;
      }

      // Use new IR-based parser
      let hash: string;
      let specs: string[];
      if (native?.parseModuleIr) {
        try {
          const ir = native.parseModuleIr(mod.absPath, code);
          hash = ir.hash;
          specs = ir.dependencies.map((dep: any) => dep.specifier);
        } catch {
          hash = getCacheKey(code);
          specs = extractImports(code, mod.absPath);
        }
      } else {
        hash = getCacheKey(code);
        specs = extractImports(code, mod.absPath);
      }
      
      const depsAbs = resolveImports(specs, mod.absPath);
      graph.recordFile(mod.absPath, hash, depsAbs);
      for (const dep of depsAbs) {
        watcher.watchFile(dep);
      }

      const result = await transformer.run({
        path: mod.absPath,
        code,
        ext: path.extname(mod.absPath),
        moduleHash: hash,
      });

      const transformed = result.code;
      const envApplied = applyEnvPlaceholders(
        transformed,
        path.extname(mod.absPath),
      );

      updates.push({
        url: mod.url,
        hash,
        deps: depsAbs.map((dep) => normalizeUrlFromFs(rootDir, dep)),
        reason: mod.reason,
        status: "updated",
        code: envApplied,
      });
    }
    return updates;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const parsed = url.parse(req.url || "/", true);
      let reqPath = parsed.pathname || "/";
      try {
        reqPath = decodeURIComponent(reqPath);
      } catch {
        // leave as undecoded path to avoid crashing on malformed encodings
      }
      const q = parsed.query || {};

      // --- HMR endpoints ---
      if (reqPath === "/__ionify_hmr") {
        // Browser subscribes to this SSE channel for HMR summaries.
        hmr.handleSSE(req, res);
        return;
      }
      if (reqPath === "/__ionify_hmr_client.js") {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(readClientAsset("hmr.js"));
        return;
      }
      if (reqPath === "/__ionify_overlay.js") {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(readClientAsset("overlay.js"));
        return;
      }
      if (reqPath === "/__ionify_react_refresh.js") {
        try {
          const asset = readClientAssetFile("react-refresh-runtime.js");
          
          // Resolve react-refresh/runtime to actual node_modules path
          let reactRefreshPath: string;
          try {
            // Create a require function from the project root to resolve modules
            const projectRequire = createRequire(path.join(rootDir, "package.json"));
            reactRefreshPath = projectRequire.resolve("react-refresh/runtime");
          } catch (err) {
            logError("Failed to resolve react-refresh/runtime", err);
            res.statusCode = 500;
            res.end("Failed to resolve react-refresh/runtime. Make sure react-refresh is installed.");
            return;
          }
          
          const reactRefreshUrl = normalizeUrlFromFs(rootDir, reactRefreshPath);
          
          // Replace the import with the resolved path
          let code = asset.code.replace(
            'import RefreshRuntime from "react-refresh/runtime"',
            `import RefreshRuntime from "${reactRefreshUrl}"`
          );
          
          res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
          res.end(code);
        } catch (err) {
          logError("Failed to serve react refresh runtime", err);
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
        return;
      }
      if (reqPath === "/__ionify_hmr/apply") {
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST" });
          res.end("Method Not Allowed");
          return;
        }
        let body: any;
        try {
          body = await parseJsonBody(req);
        } catch (err) {
          logError("Invalid JSON body for HMR apply", err);
          sendJson(res, 400, { error: "Invalid JSON body" });
          return;
        }
        const id = typeof body?.id === "string" ? body.id : null;
        if (!id) {
          sendJson(res, 400, { error: "Missing update id" });
          return;
        }
        const pending = hmr.consumeUpdate(id);
        if (!pending) {
          sendJson(res, 404, { error: "Update not found", id });
          return;
        }
        try {
          const modules = await buildUpdatePayload(pending.modules);
          sendJson(res, 200, {
            type: "update",
            id: pending.summary.id,
            timestamp: Date.now(),
            modules,
          });
        } catch (err) {
          logError("Failed to build HMR update payload", err);
          hmr.broadcastError({
            id,
            message: "Failed to compile update; falling back to full reload",
          });
          sendJson(res, 500, { error: "Failed to compile update", id });
        }
        return;
      }
      if (reqPath === "/__ionify_hmr/error") {
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST" });
          res.end("Method Not Allowed");
          return;
        }
        let body: any;
        try {
          body = await parseJsonBody(req);
        } catch {
          body = null;
        }
        const id = typeof body?.id === "string" ? body.id : undefined;
        const message =
          typeof body?.message === "string"
            ? body.message
            : "Unknown HMR error";
        logError(`[HMR] client reported error${id ? ` ${id}` : ""}: ${message}`);
        hmr.broadcastError({ id, message });
        sendJson(res, 200, { ok: true });
        return;
      }

      // Resolve to FS path
      const fsPath = decodePublicPath(rootDir, reqPath);
      if (!fsPath) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      let effectiveFsPath = fsPath;
      let effectiveUrlPath = reqPath;
      if (fs.existsSync(effectiveFsPath) && fs.statSync(effectiveFsPath).isDirectory()) {
        // Try index files with various extensions
        const indexExtensions = ['.html', '.js', '.ts', '.tsx', '.jsx'];
        let found = false;
        
        for (const ext of indexExtensions) {
          const indexFile = path.join(effectiveFsPath, `index${ext}`);
          if (fs.existsSync(indexFile)) {
            effectiveFsPath = indexFile;
            effectiveUrlPath = effectiveUrlPath.endsWith("/")
              ? `${effectiveUrlPath}index${ext}`
              : `${effectiveUrlPath}/index${ext}`;
            found = true;
            break;
          }
        }

        if (!found) {
          // Look for module resolution in directory
          const packageJson = path.join(effectiveFsPath, "package.json");
          if (fs.existsSync(packageJson)) {
            try {
              const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
              if (pkg.main) {
                const mainFile = path.join(effectiveFsPath, pkg.main);
                if (fs.existsSync(mainFile)) {
                  effectiveFsPath = mainFile;
                  found = true;
                }
              }
            } catch (e) {
              // Ignore package.json parsing errors
            }
          }
        }

        if (!found) {
          // Try resolving as a module directory
          for (const ext of indexExtensions) {
            const moduleFile = path.join(effectiveFsPath, `module${ext}`);
            if (fs.existsSync(moduleFile)) {
              effectiveFsPath = moduleFile;
              found = true;
              break;
            }
          }
        }

        if (!found) {
          res.statusCode = 404;
          res.end("Module not found");
          return;
        }
      }
      if (!fs.existsSync(effectiveFsPath)) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      // Assets: static files or `?import` JS shims.
      const ext = path.extname(effectiveFsPath);
      if (isAssetExt(ext)) {
        try {
          const data = fs.readFileSync(effectiveFsPath);
          const assetHash = crypto.createHash("sha256").update(data).digest("hex");
          const kind = "asset";
          const changed = graph.recordFile(effectiveFsPath, assetHash, [], [], kind);
          watcher.watchFile(effectiveFsPath);
          if (changed) {
            logInfo(`[Graph] Asset updated: ${effectiveFsPath}`);
          }
        } catch {
          // ignore hashing errors; still serve
        }
        if ("import" in q) {
          const js = assetAsModule(normalizeUrlFromFs(rootDir, effectiveFsPath));
          res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
          res.end(js);
          return;
        } else {
          res.writeHead(200, { "Content-Type": contentTypeForAsset(ext) });
          fs.createReadStream(effectiveFsPath).pipe(res);
          return;
        }
      }

      // CSS loader: ?inline or .module.css => JS module via PostCSS pipeline
      if (ext === ".css") {
        try {
          const cssSource = fs.readFileSync(effectiveFsPath, "utf8");
          const isModule = "module" in q || /\.module\.css$/i.test(effectiveFsPath);
          const isInline = "inline" in q;
          const mode = isModule ? "css:module" : isInline ? "css:inline" : "css:raw";

          const contentHash = getCacheKey(cssSource);
          watcher.watchFile(effectiveFsPath);
          const kind = isModule ? "css-module" : "css";
          const changed = graph.recordFile(effectiveFsPath, contentHash, [], [], kind);

          const casDir = getCasArtifactPath(casRoot, configHash, contentHash);
          const casFile = path.join(casDir, "transformed.js");
          let finalBuffer: Buffer | null = null;
          if (fs.existsSync(casFile)) {
            try {
              finalBuffer = fs.readFileSync(casFile);
              res.setHeader("X-Ionify-Cache", "HIT");
            } catch {
              finalBuffer = null;
            }
          }

          if (!finalBuffer) {
            // Run PostCSS + (optional) modules pipeline.
            const { css: compiledCss, tokens } = await compileCss({
              code: cssSource,
              filePath: effectiveFsPath,
              rootDir,
              modules: isModule,
            });
            const body =
              isModule || isInline
                ? renderCssModule({
                    css: compiledCss,
                    filePath: effectiveFsPath,
                    tokens: isModule ? tokens ?? {} : undefined,
                  })
                : compiledCss;
            finalBuffer = Buffer.from(body, "utf8");
            res.setHeader("X-Ionify-Cache", "MISS");
            try {
              fs.mkdirSync(casDir, { recursive: true });
              fs.writeFileSync(casFile, finalBuffer);
            } catch {
              // ignore CAS write errors
            }
          }

          if (isModule || isInline) {
            res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
          } else {
            res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
          }
          res.end(finalBuffer);
          logInfo(`Served: ${effectiveUrlPath} deps:0 ${changed ? "(updated)" : "(cached)"}`);
          return;
        } catch (err) {
          logError("Failed to process CSS", err);
          res.statusCode = 500;
          res.end("Failed to process CSS");
          return;
        }
      }

      // Default: HTML/JS/TS handling
      const code = fs.readFileSync(effectiveFsPath, "utf8");
      
      // Use new IR-based parser
      let hash: string;
      let specs: string[];
      if (native?.parseModuleIr) {
        try {
          const ir = native.parseModuleIr(effectiveFsPath, code);
          hash = ir.hash;
          specs = ir.dependencies.map((dep: any) => dep.specifier);
        } catch {
          hash = getCacheKey(code);
          specs = extractImports(code, effectiveFsPath);
        }
      } else {
        hash = getCacheKey(code);
        specs = extractImports(code, effectiveFsPath);
      }
      
      const depsAbs = resolveImports(specs, effectiveFsPath);
      const changed = graph.recordFile(effectiveFsPath, hash, depsAbs);

      watcher.watchFile(effectiveFsPath);
      for (const dep of depsAbs) {
        watcher.watchFile(dep);
      }

      const result = await transformer.run({
        path: effectiveFsPath,
        code,
        ext,
        moduleHash: hash,
      });
      const transformedCode = result.code;
      res.setHeader("X-Ionify-Cache", changed ? "MISS" : "HIT");

      const envApplied = applyEnvPlaceholders(transformedCode, ext);

      // HTML: inject HMR client
      if (path.extname(effectiveFsPath) === ".html") {
        const injected = injectHMRClient(envApplied);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(injected);
      } else {
        const finalBuffer = Buffer.from(envApplied);
        res.setHeader("Content-Type", guessContentType(effectiveFsPath));
        res.end(finalBuffer);
      }

      logInfo(`Served: ${effectiveUrlPath} deps:${depsAbs.length} ${changed ? "(updated)" : "(cached)"}`);
      if (cacheDebug) {
        const m = transformCache.metrics();
        logInfo(`[Ionify][Dev Cache] hits:${m.hits} misses:${m.misses} size:${m.size}`);
      }
    } catch (err) {
      logError("Error serving request:", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  // Broadcast HMR reload on changes
  watcher.on("change", (file, status) => {
    logInfo(`[Watcher] ${status}: ${file}`);
    const affected = graph.collectAffected([file]);
    if (!affected.includes(file)) {
      affected.unshift(file);
    }
    const modules: PendingHMRModule[] = [];
    for (const absPath of affected) {
      const reason: PendingHMRModule["reason"] =
        absPath === file
          ? status === "deleted"
            ? "deleted"
            : "changed"
          : "dependent";
      let hash: string | null = null;
      if (reason !== "deleted") {
        if (absPath === file) {
          try {
            const code = fs.readFileSync(absPath, "utf8");
            hash = getCacheKey(code);
          } catch {
            hash = graph.getNode(absPath)?.hash ?? null;
          }
        } else {
          hash = graph.getNode(absPath)?.hash ?? null;
        }
      }
      modules.push({
        absPath,
        url: normalizeUrlFromFs(rootDir, absPath),
        hash,
        reason,
      });
    }
    const summary = hmr.queueUpdate(modules);
    if (summary) {
      logInfo(
        `[HMR] update ${summary.id} -> ${summary.modules.length} module(s) queued`,
      );
    }
    if (status === "deleted") {
      graph.removeFile(file);
      watcher.unwatchFile(file);
    }
  });

  let closingPromise: Promise<void> | null = null;
  let cleanedUp = false;
  const signalHandlers: Array<{ event: NodeJS.Signals; handler: () => void }> = [];

  const cleanup = (force: boolean = false) => {
    if (cleanedUp) return;
    cleanedUp = true;

    // Force close any hanging connections if in force mode
    if (force) {
      server.getConnections((err, count) => {
        if (!err && count > 0) {
          server.closeAllConnections();
        }
      });
    }

    try {
      watcher.closeAll();
    } catch (err) {
      logError("Error closing watcher:", err);
    }

    try {
      hmr.close();
    } catch (err) {
      logError("Error closing HMR:", err);
    }

    graph.flush();
    
    for (const { event, handler } of signalHandlers) {
      process.off(event, handler);
    }
  };

  server.on("close", () => cleanup(false));

  const shutdown = async (exitProcess: boolean) => {
    if (!closingPromise) {
      closingPromise = new Promise<void>((resolve, reject) => {
        // Add a timeout to force cleanup after 3 seconds
        const timeoutId = setTimeout(() => {
          logInfo("Server shutdown taking too long, forcing cleanup...");
          cleanup(true);
          resolve();
        }, 3000);

        server.close((err) => {
          clearTimeout(timeoutId);
          if (err) {
            logError("Error during server shutdown:", err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    try {
      await Promise.race([
        closingPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Shutdown timeout")), 5000)
        )
      ]);
    } catch (err) {
      logError("Shutdown error:", err);
      cleanup(true); // Force cleanup on timeout
    }

    if (exitProcess) {
      // Give a small grace period for cleanup to finish
      setTimeout(() => process.exit(0), 100);
    }
  };

  if (enableSignalHandlers) {
    const onSignal = () => {
      void shutdown(true);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    signalHandlers.push({ event: "SIGINT", handler: onSignal });
    signalHandlers.push({ event: "SIGTERM", handler: onSignal });
  }

  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve());
  });

  const address = server.address();
  const actualPort =
    address && typeof address === "object" && address?.port
      ? address.port
      : port;

  logInfo(`Ionify Dev Server (Phase 2) at http://localhost:${actualPort}`);
  logInfo(`HMR listening at /__ionify_hmr (SSE)`);

  return {
    server,
    port: actualPort,
    close: async () => {
      await shutdown(false);
    },
  };
}


// ===== Next Phase TODOs =====
// Phase 3: live HMR channel + web client bridge.
