interface IonifyResolveConfig {
    baseUrl?: string;
    paths?: Record<string, string[]>;
    alias?: Record<string, string>;
    /** Browser replacements for Node builtins. DPL resolves string targets; false emits an empty module. */
    builtinFallback?: Record<string, string | false>;
    /**
     * Browser runtime globals published as real DPL dependency edges.
     * A string consumes the provider module value; a tuple consumes one named export.
     */
    runtimeGlobals?: Record<string, string | [string, string]>;
    /**
     * File extensions to try when resolving imports.
     * @default ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']
     */
    extensions?: string[];
    /**
     * Conditions to use when resolving package.json "exports" field.
     * @default ['import', 'module', 'browser', 'default']
     */
    conditions?: string[];
    /**
     * Fields to check in package.json for entry point resolution.
     * @default ['module', 'jsnext:main', 'jsnext', 'main']
     */
    mainFields?: string[];
}
interface IonifyServerConfig {
    port?: number;
    host?: string;
    https?: boolean;
    cors?: boolean;
    /**
     * SPA document fallback policy for the dev server.
     *
     * - `"auto"` (default): if a root HTML document exists, missing document navigations
     *   fall back to that document.
     * - `true`: enable fallback using `entry` or `/index.html`.
     * - `false`: disable fallback entirely.
     * - object: configure the fallback document and dot-rule behavior.
     *
     * This applies only to browser-document navigations. Ionify never rewrites
     * `/@deps/*`, HMR endpoints, explicit assets, or existing filesystem paths.
     */
    spaFallback?: "auto" | boolean | {
        enabled?: boolean;
        /**
         * HTML document served when a navigation route misses the filesystem.
         * Relative paths are resolved from project root.
         * @default '/index.html'
         */
        entry?: string;
        /**
         * When `false` (default), paths whose basename contains `.` never fall back.
         * This keeps missing assets/scripts/styles strict.
         */
        disableDotRule?: boolean;
    };
    hmr?: {
        timeout?: number;
        overlay?: boolean;
    };
    watch?: {
        ignored?: string[];
    };
}
interface IonifyBuildConfig {
    target?: string;
    outDir?: string;
    sourcemap?: boolean;
    minify?: boolean;
    /**
     * Preserve matching specifiers as external runtime imports.
     * These modules are recorded as graph edges, excluded from bundling,
     * and emitted unchanged in production output.
     *
     * Supports direct entries (`remote-app/widget.js`) and prefix entries (`remote-app/`).
     */
    external?: string[];
    /**
     * Phase 13: Emit precompressed sidecars (`.br` / `.gz`) during `ionify build`.
     * - `true` (default): enable with defaults (threshold 1KB, brotli q=11, gzip level=9)
     * - `false`: disable
     * - object: override compression defaults
     */
    precompress?: boolean | {
        /**
         * Only precompress assets at or above this size (in bytes).
         * @default 1024
         */
        thresholdBytes?: number;
        /**
         * Gzip compression level.
         * @default 9
         */
        gzipLevel?: number;
        /**
         * Brotli quality (0-11).
         * @default 11
         */
        brotliQuality?: number;
        /**
         * Write `dist/manifest.compression.json` (useful for CI/CD checks).
         * @default true
         */
        manifest?: boolean;
        /**
         * Max number of files compressed concurrently during the post-build compression phase.
         * Compression remains in-process, but is measured separately from core build completion.
         * @default os.availableParallelism() / os.cpus().length
         */
        concurrency?: number;
    };
    /**
     * Maximum estimated dependency artifact bytes per production vendor chunk.
     *
     * The planner uses this only for executable vendor chunk topology; DPL still
     * owns dependency artifact identity. Set to `false` to force the legacy single
     * vendor chunk topology.
     *
     * @default 4194304 (4 MiB)
     */
    vendorChunkMaxBytes?: number | false;
}
interface IonifyFederationRemoteConfig {
    entry: string;
    /**
     * External specifier(s) preserved in source and build output for this remote.
     * Defaults to the remote name when omitted.
     */
    external?: string | string[];
    version?: string;
    integrity?: string;
    hash?: string;
}
interface IonifyFederationSharedConfig {
    singleton?: boolean;
    requiredVersion?: string;
    version?: string;
    strictVersion?: boolean;
    eager?: boolean;
    shareScope?: string;
}
interface IonifyFederationConfig {
    /**
     * Stable host identity written into `dist/manifest.json`.
     * Defaults to `package.json#name` or the project directory name.
     */
    host?: string;
    remotes?: Record<string, string | IonifyFederationRemoteConfig>;
    exposes?: Record<string, string>;
    shared?: Record<string, boolean | IonifyFederationSharedConfig>;
}
interface IonifyCSSConfig {
    modules?: {
        localsConvention?: 'camelCase' | 'camelCaseOnly' | 'dashes' | 'dashesOnly';
        generateScopedName?: string | ((name: string, filename: string, css: string) => string);
    };
    preprocessorOptions?: Record<string, any>;
}
type IonifyTreeShakeMode = 'safe' | 'aggressive';
interface IonifyTreeShakeConfig {
    mode?: IonifyTreeShakeMode;
    include?: string[];
    exclude?: string[];
}
interface IonifyScopeHoistConfig {
    inlineFunctions?: boolean;
    constantFolding?: boolean;
    combineVariables?: boolean;
}
type IonifyStartupPolicyMode = "auto" | "observe" | "enforce" | "off";
interface IonifyStartupPolicyConfig {
    mode?: IonifyStartupPolicyMode;
    observeEvaluations?: boolean;
    minRouteDocuments?: number;
    maxEagerDepAssets?: number;
    maxEagerSourceAssets?: number;
    maxEagerTotalAssets?: number;
    maxEagerDepBytes?: number;
    maxEagerSourceBytes?: number;
    maxEagerTotalBytes?: number;
}
type IonifyProductionPublishingLevel = "auto" | "contracts" | "artifacts";
interface IonifyProductionPublishingConfig {
    /**
     * Publication depth for the dev lifecycle.
     * - `"auto"` (default): publish Production Contracts first, then Production Artifacts during deeper idle.
     * - `"contracts"`: publish only graph/plan/dependency contracts and Transform Artifacts.
     * - `"artifacts"`: publish contracts plus Chunk Artifacts.
     */
    level?: IonifyProductionPublishingLevel;
    /**
     * Idle delay before Production Contracts publication starts.
     * @default 2500
     */
    idleDelayMs?: number;
    /**
     * Deeper idle delay before Production Artifacts publication starts.
     * @default idleDelayMs * 4
     */
    artifactsIdleDelayMs?: number;
    /**
     * Alias for artifactsIdleDelayMs.
     */
    deepIdleDelayMs?: number;
    /**
     * Delay Production Artifacts when 1-minute load average is above
     * availableParallelism * cpuLoadFactor.
     * @default 1.5
     */
    cpuLoadFactor?: number;
    /**
     * Build mode used by automatic Production Publishing from dev.
     * Defaults to `"production"` so `ionify dev` publishes artifacts that the
     * default `ionify build` can verify/materialize. Set this only when your
     * build command also uses the same mode, e.g. `ionify build --mode staging`.
     * @default "production"
     */
    mode?: string;
}
interface IonifyConfigEnv {
    /**
     * Application mode selected by CLI/config env loading.
     *
     * Examples:
     * - `ionify dev --mode staging` => `mode: "staging"`
     * - `ionify build --mode staging` => `mode: "staging"` while `NODE_ENV`
     *   remains `"production"` for production transforms.
     */
    mode: string;
    /**
     * Environment values loaded from `.env`, `.env.local`, `.env.<mode>`, and
     * `.env.<mode>.local`, plus explicit shell-provided `VITE_`/`IONIFY_` vars.
     */
    env: Record<string, string>;
}
interface IonifyConfig {
    /**
     * Project root directory. All paths are resolved relative to root.
     * Affects: module resolution, watcher, public URLs, CAS location.
     * @default process.cwd()
     */
    root?: string;
    /**
     * Static public directory.
     * - Served at `/` in dev (no transforms).
     * - Copied into `build.outDir` on `ionify build`.
     * - Set to `false` to disable.
     *
     * @default 'public'
     */
    publicDir?: string | false;
    /**
     * Entry point(s) for the application (relative to root or project-relative with leading '/').
     * Accepts a single entry or multiple entries.
     * @example '/src/main.tsx'
     * @example ['src/main.tsx', 'src/admin.tsx']
     */
    entry?: string | string[];
    base?: string;
    mode?: string;
    /** Runtime-resolved minifier selection ('auto' by default). */
    minifier?: 'oxc' | 'swc' | 'auto';
    /**
     * Tree-shaking strategy (defaults to "safe").
     * - boolean toggles the default safe strategy.
     * - string selects built-in modes ("safe" or "aggressive").
     * - object allows fine grained include/exclude overrides.
     */
    treeshake?: boolean | IonifyTreeShakeMode | IonifyTreeShakeConfig;
    /**
     * Scope hoisting optimization toggles.
     * - boolean enables/disables all passes.
     * - object allows granular control of inline/constant folding/variable combining.
     */
    scopeHoist?: boolean | IonifyScopeHoistConfig;
    resolve?: IonifyResolveConfig;
    server?: IonifyServerConfig;
    build?: IonifyBuildConfig;
    federation?: IonifyFederationConfig;
    startupPolicy?: boolean | IonifyStartupPolicyMode | IonifyStartupPolicyConfig;
    /**
     * Production Publishing is enabled by default in dev.
     * Set to `false` to disable, `"auto"` to keep the default, or an object to tune idle/backpressure.
     */
    productionArtifactPublishing?: IonifyProductionPublishingLevel | false | IonifyProductionPublishingConfig;
    css?: IonifyCSSConfig;
    optimizeDeps?: {
        /**
         * Dependencies to pre-optimize on server start.
         * Useful for ensuring common dependencies are bundled before first request.
         * @example ['react', 'react-dom', 'lodash']
         */
        include?: string[];
        exclude?: string[];
        /**
         * Generate sourcemaps for optimized dependencies.
         * Disabled by default to speed up dependency optimization.
         */
        sourcemap?: boolean;
        /**
         * Bundle ESM dependencies instead of serving them as-is with proxies.
         * When `true` (default), ESM deps are bundled into single self-contained
         * files with synthesized named exports, eliminating request waterfalls.
         * Set to `false` for debugging (to inspect original package source).
         * @default true
         */
        bundleEsm?: boolean;
        /**
         * Phase 6.0: Enable shared-chunk prebundle for multi-entry deps sets (Ionify-native).
         * - `"auto"` (default): enable when supported (native binding, `bundleEsm=true`, `sourcemap=false`)
         * - `true`: force enable
         * - `false`: disable
         */
        sharedChunks?: "auto" | boolean;
        /**
         * Phase 6.1: Vendor packs (few-request mode).
         * Builds a larger shared-chunk group (the "app vendor pack") to collapse transitive `/@deps/*` waterfalls.
         * - `"auto"`: select members via deterministic heuristics (requestCount/size/complexity) + persisted history
         * - `true`: force pack building when supported
         * - `{ [packName]: string[] }`: manual pack definitions (Phase 6.3)
         * - `false`: disable (default)
         *
         * Note: vendor packs require Phase 6.0 shared chunking (`sharedChunks !== false`) to be effective.
         */
        vendorPacks?: "auto" | boolean | Record<string, string[]>;
        /**
         * Phase 5.5: Usage-driven pack slimming (Tree-Shaking v1).
         * Builds usage-minimized variants of vendor packs/chunks in the background
         * (no startup blocking), then applies on next reload via deterministic routing.
         *
         * - `"auto"` (default): enable when vendor packs are active and native chunking is available
         * - `true`: force enable
         * - `false`: disable
         */
        packSlimming?: "auto" | boolean;
        /**
         * Phase 6.1: Cap auto-selected vendor pack size (uncompressed, in bytes).
         * @default 614400 (600KB)
         */
        vendorPackMaxBytes?: number;
        /**
         * Phase 6.1: Cap auto-selected vendor pack members.
         * @default 25
         */
        vendorPackMaxMembers?: number;
        /**
         * Build a framework "vendor preloader" module in dev to reduce cold-start waterfalls.
         * - `'auto'` (default): detect framework deps from package.json and generate `vendor.<depsHash>.js`
         * - `string[]`: explicit vendor specifiers (e.g. ['react','react-dom/client'])
         * - `false`: disable vendor preloading
         */
        vendor?: "auto" | string[] | false;
        /**
         * @deprecated esbuildOptions are not supported in Ionify.
         * Ionify uses native Rust optimizer. This option is ignored with a warning.
         */
        esbuildOptions?: Record<string, unknown>;
    };
    plugins?: any[];
    /**
     * Define global constant replacements.
     * Values are JSON-stringified and replaced at compile time using AST transformation.
     * @example
     * define: {
     *   __APP_VERSION__: JSON.stringify('1.0.0'),
     *   __API_URL__: JSON.stringify('https://api.example.com'),
     *   'process.env.NODE_ENV': JSON.stringify('production')
     * }
     */
    define?: Record<string, any>;
    /**
     * Environment variables to expose to the client.
     * All variables starting with VITE_ or IONIFY_ are automatically exposed as import.meta.env.*
     */
    envPrefix?: string | string[];
    /**
     * Ionify Cloud connection and push/hydrate settings.
     * Token must NOT be placed here — use IONIFY_CLOUD_TOKEN env var or `ionify login`.
     */
    cloud?: {
        apiUrl?: string;
        projectId?: string;
        namespace?: string;
        uploadConcurrency?: number;
    };
}

interface BuildChunkAsset {
    source: string;
    fileName: string;
}
interface BuildChunkArtifact {
    id: string;
    fileName: string;
    code: string;
    map?: string;
    assets: BuildChunkAsset[];
    code_bytes: number;
    map_bytes: number;
}
interface BuildPlanModule {
    id: string;
    hash?: string;
    kind: string;
    deps: string[];
    dynamicDeps: string[];
    fsPath?: string | null;
    dependencyFormat?: "esm" | "cjs" | "unknown" | null;
    usedExports?: string[] | null;
    dependencyAbiHash?: string | null;
    sideEffects?: "none" | "present" | "unknown" | null;
    artifactTopology?: "wrapper" | "esm-native" | "esm-native-slim" | null;
}
interface BuildPlanChunk {
    id: string;
    modules: BuildPlanModule[];
    entry: boolean;
    shared: boolean;
    consumers: string[];
    css: string[];
    assets: string[];
}
interface BuildPlan {
    entries: string[];
    chunks: BuildPlanChunk[];
}

type IonifyChunkFiles = {
    js: string[];
    css: string[];
    assets: string[];
};
type IonifyFederationExposeEntry = {
    source: string;
    id: string;
    artifactHash?: string;
    entryChunkId?: string;
    entryFile?: string;
    entryNamespace?: string;
    chunkIds: string[];
    files: IonifyChunkFiles;
    contractHash: string;
};
type IonifyFederationRemoteEntry = {
    entry: string;
    external: string[];
    format: "esm";
    version?: string;
    integrity?: string;
    hash: string;
    contractHash: string;
};
type IonifyFederationSharedEntry = {
    singleton: boolean;
    requiredVersion?: string;
    providedVersion?: string;
    strictVersion: boolean;
    eager: boolean;
    shareScope: string;
    contractHash: string;
};
type IonifyFederationBuildSection = {
    version: 1;
    host: {
        name: string;
        entryIds: string[];
        entryChunkIds: string[];
        contractHash: string;
    };
    container?: {
        entry: string;
        format: "esm";
        exposes: string[];
        shareScopes: string[];
        contractHash: string;
    };
    remotes: Record<string, IonifyFederationRemoteEntry>;
    exposes: Record<string, IonifyFederationExposeEntry>;
    shared: Record<string, IonifyFederationSharedEntry>;
};
type IonifyBuildManifest = {
    entries: string[];
    chunks: Array<{
        id: string;
        entry: boolean;
        shared: boolean;
        consumers: string[];
        modules: Array<{
            id: string;
            kind: string;
            deps: string[];
            dynamicDeps: string[];
            artifactHash?: string;
        }>;
        files: IonifyChunkFiles;
    }>;
    federation?: IonifyFederationBuildSection;
};
type IonifyRemoteManifestHandle = {
    entryUrl: string;
    manifestUrl: string;
    baseUrl: string;
    manifest: IonifyBuildManifest;
};
type IonifyRemoteExposeHandle = {
    remote: IonifyRemoteManifestHandle;
    exposeKey: string;
    expose: IonifyFederationExposeEntry;
    urls: IonifyChunkFiles;
};
type IonifyFederationSharedModule = {
    version?: string;
    singleton?: boolean;
    eager?: boolean;
    get?: () => Promise<unknown> | unknown;
    module?: unknown;
};
type IonifyFederationSharedRegistration = IonifyFederationSharedModule | IonifyFederationSharedModule[];
type IonifyFederationShareScopes = Record<string, Record<string, IonifyFederationSharedRegistration>>;
type IonifyFederationContainerModule = {
    init?: (sharedScopes?: IonifyFederationShareScopes) => Promise<void> | void;
    get: (exposeKey: string) => Promise<() => Promise<unknown>> | (() => Promise<unknown>);
    describe?: () => unknown;
};
type IonifyRemoteContainerHandle = {
    remote: IonifyRemoteManifestHandle;
    entryUrl: string;
    container: IonifyFederationContainerModule;
};
interface IonifyFederationFetchOptions {
    signal?: AbortSignal;
    headers?: Record<string, string>;
    fetchImpl?: typeof fetch;
    cache?: boolean;
}
interface IonifyFederationContainerLoadOptions extends IonifyFederationFetchOptions {
    sharedScopes?: IonifyFederationShareScopes;
}
interface IonifyFederationHostRuntime {
    getRemoteManifest(remote: string | {
        entry: string;
    }, options?: IonifyFederationFetchOptions): Promise<IonifyRemoteManifestHandle>;
    resolveRemoteExpose(remote: IonifyRemoteManifestHandle, exposeKey: string): IonifyRemoteExposeHandle;
    preloadRemoteExpose(remote: IonifyRemoteManifestHandle, exposeKey: string): Promise<IonifyRemoteExposeHandle>;
    getRemoteContainer(remote: string | {
        entry: string;
    } | IonifyRemoteManifestHandle, options?: IonifyFederationContainerLoadOptions): Promise<IonifyRemoteContainerHandle>;
    loadRemoteExposeModule<TModule = Record<string, unknown>>(remote: string | {
        entry: string;
    } | IonifyRemoteManifestHandle, exposeKey: string, options?: IonifyFederationContainerLoadOptions): Promise<TModule>;
    loadRemoteModule<TModule = Record<string, unknown>>(moduleUrl: string): Promise<TModule>;
    clear(): void;
}
type RuntimeCache = {
    manifests: Map<string, Promise<IonifyRemoteManifestHandle>>;
    containers: Map<string, Promise<IonifyRemoteContainerHandle>>;
    modules: Map<string, Promise<unknown>>;
};
declare global {
    var __IONIFY_FEDERATION_RUNTIME_CACHE__: RuntimeCache | undefined;
    var __IONIFY_FEDERATION_CONTAINER_BASE_URLS__: Record<string, string> | undefined;
}
declare function createFederationHostRuntime(): IonifyFederationHostRuntime;
declare function fetchRemoteManifest(remote: string | {
    entry: string;
}, options?: IonifyFederationFetchOptions): Promise<IonifyRemoteManifestHandle>;
declare function resolveRemoteExpose(remote: IonifyRemoteManifestHandle, exposeKey: string): IonifyRemoteExposeHandle;
declare function preloadRemoteExpose(remote: IonifyRemoteManifestHandle, exposeKey: string): Promise<IonifyRemoteExposeHandle>;
declare function fetchRemoteContainer(remote: string | {
    entry: string;
} | IonifyRemoteManifestHandle, options?: IonifyFederationContainerLoadOptions): Promise<IonifyRemoteContainerHandle>;
declare function loadRemoteExposeModule<TModule = Record<string, unknown>>(remote: string | {
    entry: string;
} | IonifyRemoteManifestHandle, exposeKey: string, options?: IonifyFederationContainerLoadOptions): Promise<TModule>;
declare function loadRemoteModule<TModule = Record<string, unknown>>(moduleUrl: string): Promise<TModule>;

declare function defineConfig(config: IonifyConfig): IonifyConfig;
declare function defineConfig(config: (env: IonifyConfigEnv) => IonifyConfig | Promise<IonifyConfig>): (env: IonifyConfigEnv) => IonifyConfig | Promise<IonifyConfig>;

export { type BuildChunkArtifact, type BuildChunkAsset, type BuildPlan, type BuildPlanChunk, type BuildPlanModule, type IonifyBuildConfig, type IonifyBuildManifest, type IonifyCSSConfig, type IonifyChunkFiles, type IonifyConfig, type IonifyConfigEnv, type IonifyFederationBuildSection, type IonifyFederationConfig, type IonifyFederationContainerLoadOptions, type IonifyFederationContainerModule, type IonifyFederationExposeEntry, type IonifyFederationFetchOptions, type IonifyFederationHostRuntime, type IonifyFederationRemoteConfig, type IonifyFederationRemoteEntry, type IonifyFederationShareScopes, type IonifyFederationSharedConfig, type IonifyFederationSharedEntry, type IonifyFederationSharedModule, type IonifyFederationSharedRegistration, type IonifyProductionPublishingConfig, type IonifyProductionPublishingLevel, type IonifyRemoteContainerHandle, type IonifyRemoteExposeHandle, type IonifyRemoteManifestHandle, type IonifyResolveConfig, type IonifyScopeHoistConfig, type IonifyServerConfig, type IonifyStartupPolicyConfig, type IonifyStartupPolicyMode, type IonifyTreeShakeConfig, type IonifyTreeShakeMode, createFederationHostRuntime, defineConfig, fetchRemoteContainer, fetchRemoteManifest, loadRemoteExposeModule, loadRemoteModule, preloadRemoteExpose, resolveRemoteExpose };
