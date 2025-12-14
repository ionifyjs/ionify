import path from 'path';
import fs from 'fs';
import type { IonifyPlugin } from '../../types/plugin';

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json'];

export interface ResolverOptions {
  alias?: Record<string, string>;
  extensions?: string[];
  fallback?: Record<string, string>;
  tsconfig?: string | boolean;
}

function loadTsConfig(root: string) {
  const tsconfigPath = path.resolve(root, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) return null;

  try {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
    return {
      baseUrl: tsconfig.compilerOptions?.baseUrl,
      paths: tsconfig.compilerOptions?.paths || {}
    };
  } catch (error) {
    console.warn('Failed to parse tsconfig.json:', error);
    return null;
  }
}

function tryResolveFile(file: string, extensions: string[]) {
  // 1. Try exact match first
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;

  // 2. Try with extensions
  for (const ext of extensions) {
    const withExt = file + ext;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) return withExt;
  }

  // 3. Try directory index files
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    // Try index files with extensions
    for (const ext of extensions) {
      const indexFile = path.join(file, 'index' + ext);
      if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) return indexFile;
    }
  }

  // 4. Try adding /index.* when file doesn't exist but could be a directory
  for (const ext of extensions) {
    const indexFile = path.join(file, 'index' + ext);
    if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) return indexFile;
  }

  return null;
}

export interface ResolveContext {
  baseDir?: string;
}

export function createResolver(options: ResolverOptions = {}): IonifyPlugin {
  const extensions = options.extensions || DEFAULT_EXTENSIONS;
  
  return {
    name: 'ionify:resolver',
    
    async onLoad(file: string, context?: ResolveContext) {
      const root = process.cwd();
      const tsconfig = options.tsconfig === false ? null : loadTsConfig(root);
      const baseDir = context?.baseDir || root;
      
      // Resolution order:
      // 1. Try relative path resolution first
      if (file.startsWith('./') || file.startsWith('../')) {
        const relativePath = path.resolve(baseDir, file);
        const resolvedRelative = tryResolveFile(relativePath, extensions);
        if (resolvedRelative) return { path: resolvedRelative };
      }
      
      // 2. Try absolute paths (from workspace root)
      let resolvedPath = tryResolveFile(path.resolve(root, file), extensions);
      if (resolvedPath) return { path: resolvedPath };
      
      // 3. Handle aliases from ionify.config.ts
      if (options.alias) {
        for (const [alias, target] of Object.entries(options.alias)) {
          if (file.startsWith(alias)) {
            const aliased = path.join(target, file.slice(alias.length));
            resolvedPath = tryResolveFile(path.resolve(root, aliased), extensions);
            if (resolvedPath) return { path: resolvedPath };
          }
        }
      }
      
      // 4. Handle tsconfig paths
      if (tsconfig?.paths) {
        for (const [pattern, targets] of Object.entries(tsconfig.paths) as [string, unknown][]) {
          const normalizedPattern = pattern.replace(/\*$/, '');
          if (file.startsWith(normalizedPattern)) {
            for (const target of (Array.isArray(targets) ? targets : [targets]).filter(
              (value): value is string => typeof value === 'string'
            )) {
              const normalized = target.replace(/\*$/, '');
              const tsconfigBaseDir = tsconfig.baseUrl ? path.resolve(root, tsconfig.baseUrl) : root;
              const aliased = path.join(tsconfigBaseDir, normalized, file.slice(normalizedPattern.length));
              resolvedPath = tryResolveFile(aliased, extensions);
              if (resolvedPath) return { path: resolvedPath };
            }
          }
        }
      }
      
      // 5. Try src-relative path (for projects following src/ convention)
      resolvedPath = tryResolveFile(path.resolve(root, 'src', file), extensions);
      if (resolvedPath) return { path: resolvedPath };
      
      // 6. Handle node_modules
      if (file.startsWith('@') || !file.startsWith('.')) {
        const nodeModulesPath = path.join(root, 'node_modules', file);
        resolvedPath = tryResolveFile(nodeModulesPath, extensions);
        if (resolvedPath) return { path: resolvedPath };
      }
      
      // 7. Handle fallbacks
      if (options.fallback) {
        for (const [from, to] of Object.entries(options.fallback)) {
          if (file === from) {
            resolvedPath = tryResolveFile(path.resolve(root, to), extensions);
            if (resolvedPath) return { path: resolvedPath };
          }
        }
      }
      
      return null;
    }
  };
}
