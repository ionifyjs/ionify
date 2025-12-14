import type { IonifyLoader, IonifyPlugin } from "./plugin";

export interface IonifyResolveConfig {
  alias?: Record<string, string | string[]>;
  extensions?: string[];
  [key: string]: unknown;
}

export interface IonifyServerConfig {
  port?: number;
  host?: string;
  https?: boolean | Record<string, unknown>;
  strictPort?: boolean;
  cors?: boolean | Record<string, unknown>;
  hmr?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface IonifyBuildConfig {
  target?: string | string[];
  sourcemap?: boolean | "inline" | "hidden";
  minify?: boolean | "esbuild" | "terser";
  rollupOptions?: Record<string, unknown>;
  commonjsOptions?: Record<string, unknown>;
  dropConsole?: boolean;
  dropDebugger?: boolean;
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
  include?: string[];
  esbuildOptions?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface IonifyConfig {
  root?: string;
  entry?: string;
  outDir?: string;
  loaders?: IonifyLoader[];
  plugins?: IonifyPlugin[];
  resolve?: IonifyResolveConfig;
  server?: IonifyServerConfig;
  build?: IonifyBuildConfig;
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
  define?: Record<string, unknown>;
  [key: string]: unknown;
}

export type IonifyConfigExport = IonifyConfig | Promise<IonifyConfig>;
