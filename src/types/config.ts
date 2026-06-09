/**
{
  "description": "Type definitions for ionify.config.ts user configuration including entry, output, alias, and plugin arrays.",
  "phase": 2.5,
  "todo": [
    "Extend config schema for build planner options in Phase 3.",
    "Add validation helpers for plugin ecosystems."
  ]
}
*/

import type { IonifyLoader, IonifyPlugin } from "./plugin";

export interface IonifyResolveConfig {
  alias?: Record<string, string | string[]>;
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
  [key: string]: unknown;
}

export interface IonifyServerConfig {
  port?: number;
  host?: string;
  https?: boolean | Record<string, unknown>;
  strictPort?: boolean;
  cors?: boolean | Record<string, unknown>;
  /**
   * SPA document fallback policy for the dev server.
   * - `"auto"` (default): enable when a root HTML document exists
   * - `true`: force enable using `entry` or `/index.html`
   * - `false`: disable
   * - object: configure the fallback entry and dot-rule behavior
   */
  spaFallback?:
    | "auto"
    | boolean
    | {
        enabled?: boolean;
        entry?: string;
        disableDotRule?: boolean;
        [key: string]: unknown;
      };
  hmr?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface IonifyBuildConfig {
  target?: string | string[];
  sourcemap?: boolean | "inline" | "hidden";
  minify?: boolean | "esbuild" | "terser";
  /**
   * Preserve matching specifiers as external runtime imports.
   * These modules are recorded as graph edges and emitted unchanged in production output.
   */
  external?: string[];
  commonjsOptions?: Record<string, unknown>;
  dropConsole?: boolean;
  dropDebugger?: boolean;
  [key: string]: unknown;
}

export interface IonifyFederationRemoteConfig {
  entry: string;
  external?: string | string[];
  version?: string;
  integrity?: string;
  hash?: string;
  [key: string]: unknown;
}

export interface IonifyFederationSharedConfig {
  singleton?: boolean;
  requiredVersion?: string;
  version?: string;
  strictVersion?: boolean;
  eager?: boolean;
  shareScope?: string;
  [key: string]: unknown;
}

export interface IonifyFederationConfig {
  host?: string;
  remotes?: Record<string, string | IonifyFederationRemoteConfig>;
  exposes?: Record<string, string>;
  shared?: Record<string, boolean | IonifyFederationSharedConfig>;
  [key: string]: unknown;
}

export type IonifyTreeShakeMode = "safe" | "aggressive";

export interface IonifyTreeShakeConfig {
  mode?: IonifyTreeShakeMode;
  include?: string[];
  exclude?: string[];
}

export interface IonifyScopeHoistConfig {
  inlineFunctions?: boolean;
  constantFolding?: boolean;
  combineVariables?: boolean;
}

/**
 * Optimization levels provide presets that map to all optimization features.
 * - 0: No optimizations (for debugging)
 * - 1: Safe optimizations (inline + treeshake safe + minify)
 * - 2: Balanced (+ combine vars + const fold)
 * - 3: Aggressive (+ aggressive treeshake + expanded folding)
 */
export type IonifyOptimizationLevel = 0 | 1 | 2 | 3;

export interface IonifyOptimizeDepsConfig {
  /**
   * Dependencies to pre-optimize on server start.
   * Useful for ensuring common dependencies are bundled before first request.
   * @example ['react', 'react-dom', 'lodash']
   */
  include?: string[];
  /**
   * Dependencies to skip optimizing (kept as-is in dev).
   * Useful for large libs you want to debug or packages that are already browser-ready ESM.
   */
  exclude?: string[];
  /**
   * Generate sourcemaps for optimized dependencies.
   * Disabled by default to speed up dependency optimization.
   */
  sourcemap?: boolean;
  /**
   * Bundle ESM dependencies instead of serving proxy modules.
   * When `true` (default), ESM deps are bundled into self-contained files
   * to eliminate request waterfalls. Set to `false` for debugging.
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
   * Builds usage-minimized variants of vendor packs/chunks in the background,
   * then applies on next reload via deterministic routing.
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
  [key: string]: unknown;
}

export type IonifyStartupPolicyMode = "auto" | "observe" | "enforce" | "off";

export interface IonifyStartupPolicyConfig {
  /**
   * Dev startup policy mode.
   * - "auto" (default): observe startup history and enforce only bounded, stable eager closures.
   * - "observe": collect policy evidence without making HTML preloads authoritative.
   * - "enforce": same policy path as auto, useful for experiments with custom budgets.
   * - "off": disable startup policy collection and enforcement.
   */
  mode?: IonifyStartupPolicyMode;
  /**
   * Record module evaluation timing by injecting a tiny marker into JS responses.
   * Disabled by default because it changes served module bytes and can affect startup metrics.
   */
  observeEvaluations?: boolean;
  minRouteDocuments?: number;
  maxEagerDepAssets?: number;
  maxEagerSourceAssets?: number;
  maxEagerTotalAssets?: number;
  maxEagerDepBytes?: number;
  maxEagerSourceBytes?: number;
  maxEagerTotalBytes?: number;
}

export interface IonifyConfig {
  /**
   * Project root directory. All paths are resolved relative to root.
   * Affects: module resolution, watcher, public URLs, CAS location.
   * @default process.cwd()
   */
  root?: string;
  /**
   * Entry point for the application (relative to root or absolute).
    * Used for entry module detection and tooling (dev server, planner).
   * @example './src/main.tsx'
   * @example 'src/index.ts'
    * @example ['src/main.tsx', 'src/admin.tsx']
   */
  entry?: string | string[];
  outDir?: string;
  loaders?: IonifyLoader[];
  plugins?: IonifyPlugin[];
  resolve?: IonifyResolveConfig;
  server?: IonifyServerConfig;
  build?: IonifyBuildConfig;
  federation?: IonifyFederationConfig;
  startupPolicy?: boolean | IonifyStartupPolicyMode | IonifyStartupPolicyConfig;
  /**
   * Select which minifier to use for production output.
   * - 'auto' (default): let Ionify choose (prefers oxc when available)
   * - 'oxc': force oxc minifier
   * - 'swc': force swc minifier
   */
  minifier?: 'oxc' | 'swc' | 'auto';
  /**
   * Tree-shaking strategy (defaults to "safe").
   * - boolean enables/disables safe mode
   * - string selects built-in modes ("safe" or "aggressive")
   * - object allows include/exclude overrides
   */
  treeshake?: boolean | IonifyTreeShakeMode | IonifyTreeShakeConfig;
  /**
   * Scope hoisting toggles:
   * - boolean enables/disables all passes
   * - object allows enabling inline/constant folding/variable combine individually
   */
  scopeHoist?: boolean | IonifyScopeHoistConfig;
  /**
   * Parser + transform stack selection.
   * 
   * @default "hybrid"
   * 
   * - **"oxc"**: Fastest Rust-native parser + transform (requires native binding, fail-fast if unavailable)
   * - **"swc"**: Rust-native SWC parser + transform (slower than oxc, more battle-tested)
   * - **"hybrid"**: Try oxc first, silently fallback to SWC on error (recommended for production)
   * 
   * All modes use native Rust transforms via NAPI - no npm oxc/swc packages.
   * Mode can also be set via IONIFY_PARSER environment variable.
   * 
   * **Note**: Parser mode selection is a temporary migration feature.
   * Once oxc is proven stable (v0.5+), only oxc will be supported.
   * This matches Vite's approach with Rollup → Rolldown migration.
   * 
   * @see https://ionify.dev/docs/config#parser
   */
  parser?: "oxc" | "swc" | "hybrid";
  /**
   * Optimization level preset (0-3).
   * When specified, overrides individual minifier/treeshake/scopeHoist settings.
   * - 0: No optimizations
   * - 1: Safe optimizations
   * - 2: Balanced
   * - 3: Aggressive
   */
  optimizationLevel?: IonifyOptimizationLevel;
  optimizeDeps?: IonifyOptimizeDepsConfig;
  /**
   * Define global constant replacements.
   * Values are JSON-stringified and replaced at compile time using AST transformation.
   */
  define?: Record<string, unknown>;
  /**
   * Environment variables to expose to the client.
   */
  envPrefix?: string | string[];
  /**
   * Ionify Cloud settings. Token is resolved separately — do NOT store it here.
   * Set IONIFY_CLOUD_TOKEN env var (CI/CD) or run `ionify login` (developer machines).
   */
  cloud?: IonifyCloudConfig;
  [key: string]: unknown;
}

/**
 * ionify-cloud connection and push/hydrate settings.
 * All fields are safe to commit to source control — the token lives in the
 * IONIFY_CLOUD_TOKEN env var or ~/.ionify/credentials (written by `ionify login`).
 */
export interface IonifyCloudConfig {
  /** Base URL of the ionify-cloud API. @default "https://api.ionify.cloud" */
  apiUrl?: string;
  /** Project UUID from the ionify-cloud dashboard. Required for push/hydrate. */
  projectId?: string;
  /**
   * Namespace name for Tier-1 (source transform) uploads.
   * Falls back to the current git branch name if not set.
   * Scope is always "branch". Required when using `ionify push` with Tier-1.
   */
  namespace?: string;
  /**
   * Maximum number of artifact uploads to run in parallel.
   * @default 8
   */
  uploadConcurrency?: number;
}

export type IonifyConfigExport = IonifyConfig | Promise<IonifyConfig>;
