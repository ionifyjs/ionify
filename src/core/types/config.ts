export interface IonifyResolveConfig {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  alias?: Record<string, string>;
  extensions?: string[];
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
  root?: string;
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
    include?: string[];
    exclude?: string[];
  };
  plugins?: any[];
  define?: Record<string, any>;
}
