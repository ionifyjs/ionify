import path from 'path';
import fs from 'fs';

export interface ResolveOptions {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  extensions?: string[];
  alias?: Record<string, string | string[]>;
  conditions?: string[];
  mainFields?: string[];
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs'];
const DEFAULT_CONDITIONS = ['import', 'default'];
const DEFAULT_MAIN_FIELDS = ['module', 'main'];

export class ModuleResolver {
  private options: Required<ResolveOptions>;
  private rootDir: string;

  constructor(rootDir: string, options: ResolveOptions = {}) {
    this.rootDir = rootDir;
    this.options = {
      baseUrl: options.baseUrl || '.',
      paths: options.paths || {},
      extensions: options.extensions || DEFAULT_EXTENSIONS,
      alias: options.alias || {},
      conditions: options.conditions || DEFAULT_CONDITIONS,
      mainFields: options.mainFields || DEFAULT_MAIN_FIELDS
    };
  }

  resolve(importSpecifier: string, importer: string): string | null {
    // Handle absolute paths
    if (path.isAbsolute(importSpecifier)) {
      return this.tryResolveFile(importSpecifier);
    }

    // Handle alias paths
    const aliasResolved = this.resolveAlias(importSpecifier);
    if (aliasResolved) {
      return this.tryResolveFile(aliasResolved);
    }

    // Handle relative paths
    if (importSpecifier.startsWith('.')) {
      const resolvedPath = path.resolve(path.dirname(importer), importSpecifier);
      return this.tryResolveFile(resolvedPath);
    }

    // Handle bare module specifiers
    return this.resolveBareModule(importSpecifier, importer);
  }

  private resolveAlias(specifier: string): string | null {
    for (const [alias, target] of Object.entries(this.options.alias)) {
      if (specifier === alias || specifier.startsWith(`${alias}/`)) {
        const relativePath = specifier.slice(alias.length);
        const targets = Array.isArray(target) ? target : [target];
        
        for (const t of targets) {
          const resolved = path.join(this.rootDir, t, relativePath);
          if (fs.existsSync(resolved)) {
            return resolved;
          }
        }
      }
    }

    // Check tsconfig paths
    for (const [pattern, targets] of Object.entries(this.options.paths)) {
      const wildcardIndex = pattern.indexOf('*');
      if (wildcardIndex === -1) {
        if (specifier === pattern) {
          return path.join(this.rootDir, this.options.baseUrl, targets[0]);
        }
      } else {
        const prefix = pattern.slice(0, wildcardIndex);
        const suffix = pattern.slice(wildcardIndex + 1);
        if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
          const matchedPortion = specifier.slice(prefix.length, -suffix.length || undefined);
          for (const target of targets) {
            const resolved = path.join(
              this.rootDir,
              this.options.baseUrl,
              target.replace('*', matchedPortion)
            );
            if (fs.existsSync(resolved)) {
              return resolved;
            }
          }
        }
      }
    }

    return null;
  }

  private resolveBareModule(specifier: string, importer: string): string | null {
    // Try node_modules resolution
    const parts = specifier.split('/');
    const packageName = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
    const subpath = parts.slice(packageName.startsWith('@') ? 2 : 1).join('/');

    let dir = path.dirname(importer);
    while (dir !== '/') {
      const nodeModulesPath = path.join(dir, 'node_modules', packageName);
      if (fs.existsSync(nodeModulesPath)) {
        if (subpath) {
          return this.tryResolveFile(path.join(nodeModulesPath, subpath));
        }
        return this.resolvePackageMain(nodeModulesPath);
      }
      dir = path.dirname(dir);
    }

    return null;
  }

  private resolvePackageMain(packageDir: string): string | null {
    const pkgJsonPath = path.join(packageDir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        
        // Check exports field first
        if (pkg.exports) {
          const resolved = this.resolveExports(pkg.exports, packageDir);
          if (resolved) return resolved;
        }

        // Then try main fields
        for (const field of this.options.mainFields) {
          if (pkg[field]) {
            const resolved = this.tryResolveFile(path.join(packageDir, pkg[field]));
            if (resolved) return resolved;
          }
        }
      } catch {
        // Ignore package.json parsing errors
      }
    }

    // Try index files
    return this.tryResolveFile(path.join(packageDir, 'index'));
  }

  private resolveExports(exports: any, packageDir: string): string | null {
    if (typeof exports === 'string') {
      return this.tryResolveFile(path.join(packageDir, exports));
    }

    if (Array.isArray(exports)) {
      for (const exp of exports) {
        const resolved = this.resolveExports(exp, packageDir);
        if (resolved) return resolved;
      }
      return null;
    }

    if (typeof exports === 'object') {
      // Handle conditional exports
      for (const condition of this.options.conditions) {
        if (condition in exports) {
          const resolved = this.resolveExports(exports[condition], packageDir);
          if (resolved) return resolved;
        }
      }

      // Try default condition
      if ('default' in exports) {
        return this.resolveExports(exports.default, packageDir);
      }
    }

    return null;
  }

  private tryResolveFile(filepath: string): string | null {
    // Try exact match
    if (fs.existsSync(filepath) && fs.statSync(filepath).isFile()) {
      return filepath;
    }

    // Try with extensions
    for (const ext of this.options.extensions) {
      const withExt = `${filepath}${ext}`;
      if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
        return withExt;
      }
    }

    // Try as a directory with index files
    if (fs.existsSync(filepath) && fs.statSync(filepath).isDirectory()) {
      for (const ext of this.options.extensions) {
        const indexFile = path.join(filepath, `index${ext}`);
        if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
          return indexFile;
        }
      }
    }

    return null;
  }
}