import type { IonModule, ModuleId, DependencyKind, IonDependency } from './ir';
import { native } from '../native';
import { createHash } from 'crypto';

/**
 * Parser backend interface for swappable parser implementations
 */
export interface ParserBackend {
  /**
   * Parse and transform a module, returning fully transformed code
   */
  parseModule(id: ModuleId, source: string): Promise<IonModule>;
}

/**
 * Native Rust-backed parser (canonical implementation)
 * Uses Rust parse_module_ir for dev, build, and test
 * Wave 7: Integrated with AST cache for faster parsing
 */
export class NativeParserBackend implements ParserBackend {
  async parseModule(id: ModuleId, source: string): Promise<IonModule> {
    if (!native?.parseModuleIr) {
      throw new Error('Native binding not available - use JsFallbackParserBackend');
    }
    
    try {
      // Wave 7: Try to get cached AST first
      if (native.getCachedAst) {
        try {
          const cached = native.getCachedAst(id.path, source);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed?.code) {
              const irDeps = Array.isArray(parsed.ir) ? parsed.ir as IonDependency[] : [];
              const stats = parsed.transform_stats as any;
              const transform_stats = stats && typeof stats === "object" ? stats : undefined;
              if (irDeps.length) {
                const hash =
                  typeof parsed.hash === "string"
                    ? parsed.hash
                    : createHash("sha256").update(source).digest("hex");
                return {
                  id,
                  code: parsed.code,
                  dependencies: irDeps,
                  hash,
                  transform_stats,
                };
              }
              // Fallback: parse with native on the original source if IR is missing
            }
          }
        } catch (err) {
          // Cache error - fall through to normal parsing
          console.warn(`[AST Cache] Error reading cache for ${id.path}:`, err);
        }
      }
      
      // Cache miss or unavailable - parse normally (Wave 2 in Rust handles caching)
      const result = native.parseModuleIr(id.path, source);
      return result as IonModule;
    } catch (error) {
      throw new Error(`Native parse error: ${error}`);
    }
  }
}

/**
 * JavaScript fallback parser for environments without native bindings
 * Uses basic import regex extraction (not recommended for production)
 */
export class JsFallbackParserBackend implements ParserBackend {
  async parseModule(id: ModuleId, source: string): Promise<IonModule> {
    // Basic import/export extraction with regex (simplified fallback)
    const importRegex = /(?:import|export)\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    
    const dependencies: IonDependency[] = [];
    const seenSpecifiers = new Set<string>();
    
    let match;
    while ((match = importRegex.exec(source)) !== null) {
      const specifier = match[1];
      if (!seenSpecifiers.has(specifier)) {
        seenSpecifiers.add(specifier);
        dependencies.push({
          specifier,
          kind: specifier.endsWith('.css') ? 'Css' as DependencyKind : 'Static' as DependencyKind,
          resolved_id: undefined,
        });
      }
    }
    
    while ((match = dynamicImportRegex.exec(source)) !== null) {
      const specifier = match[1];
      if (!seenSpecifiers.has(specifier)) {
        seenSpecifiers.add(specifier);
        dependencies.push({
          specifier,
          kind: 'Dynamic' as DependencyKind,
          resolved_id: undefined,
        });
      }
    }
    
    // Compute hash
    const hash = createHash('sha256').update(source).digest('hex');
    
    return {
      id,
      code: source, // No transformation in fallback
      dependencies,
      hash,
    };
  }
}

/**
 * Get the default parser backend (native with JS fallback)
 */
export function getParserBackend(): ParserBackend {
  if (native?.parseModuleIr) {
    return new NativeParserBackend();
  }
  console.warn('Native binding not available, using JS fallback parser (limited functionality)');
  return new JsFallbackParserBackend();
}
