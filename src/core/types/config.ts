export interface IonifyResolveConfig {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  alias?: Record<string, string>;
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

export interface IonifyServerConfig {
  port?: number;
  host?: string;
  https?: boolean;
  cors?: boolean;
  hmr?: {
    timeout?: number;
    overlay?: boolean;
  };
  watch?: {
    ignored?: string[];
  };
}

export interface IonifyBuildConfig {
  target?: string;
  outDir?: string;
  sourcemap?: boolean;
  minify?: boolean;
  rollupOptions?: {
    input?: string | string[] | Record<string, string>;
    external?: string[];
    output?: {
      format?: 'es' | 'cjs' | 'umd' | 'iife';
      dir?: string;
      globals?: Record<string, string>;
    };
  };
}

export interface IonifyCSSConfig {
  modules?: {
    localsConvention?: 'camelCase' | 'camelCaseOnly' | 'dashes' | 'dashesOnly';
    generateScopedName?: string | ((name: string, filename: string, css: string) => string);
  };
  preprocessorOptions?: Record<string, any>;
}

export type IonifyTreeShakeMode = 'safe' | 'aggressive';

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

export interface IonifyConfig {
  /**
   * Project root directory. All paths are resolved relative to root.
   * Affects: module resolution, watcher, public URLs, CAS location.
   * @default process.cwd()
   */
  root?: string;
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
}
