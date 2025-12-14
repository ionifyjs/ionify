import { describe, it, expect, beforeEach } from 'vitest';
import { native } from '../src/native';
import fs from 'fs';
import path from 'path';

describe('AST Cache Wave 1', () => {
  const testDbPath = path.join(process.cwd(), '.ionify', 'test-ast-cache.db');
  
  beforeEach(() => {
    // Clean test database
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { recursive: true, force: true });
    }
  });

  it('should store and retrieve transformed code from cache', () => {
    if (!native?.graphInit || !native?.parseModuleIr || !native?.getCachedAst) {
      console.log('Native bindings not available, skipping test');
      return;
    }

    // Initialize graph (which initializes AST cache)
    native.graphInit(testDbPath, 'test-v1');

    const testSource = `
import { foo } from './foo';
export const bar = foo + 1;
    `.trim();

    const testId = '/test/module.ts';

    // First parse - should miss cache and populate it
    const result1 = native.parseModuleIr(testId, testSource);
    
    expect(result1).toBeDefined();
    expect(result1.code).toBeDefined();
    expect(result1.dependencies).toBeDefined();
    expect(result1.dependencies.length).toBeGreaterThan(0);

    // Second parse with getCachedAst - should hit cache
    const cached = native.getCachedAst(testId, testSource);
    
    expect(cached).toBeDefined();
    if (cached) {
      const parsed = JSON.parse(cached);
      expect(parsed.code).toBe(result1.code);
      expect(parsed.hash).toBeDefined();
      expect(parsed.ir).toBeDefined();
      expect(Array.isArray(parsed.ir)).toBe(true);
      expect(parsed.ir.length).toBeGreaterThan(0);
      expect(parsed.hits).toBeGreaterThan(0); // Hit counter incremented
    }
  });

  it('should invalidate cache when source changes', () => {
    if (!native?.graphInit || !native?.getCachedAst) {
      console.log('Native bindings not available, skipping test');
      return;
    }

    native.graphInit(testDbPath, 'test-v2');

    const source1 = `export const x = 1;`;
    const source2 = `export const x = 2;`; // Different content
    const testId = '/test/invalidate.ts';

    // Parse first version
    if (native.parseModuleIr) {
      native.parseModuleIr(testId, source1);
    }

    // Should hit cache with same source
    const hit1 = native.getCachedAst(testId, source1);
    expect(hit1).toBeDefined();

    // Should miss cache with different source
    const miss = native.getCachedAst(testId, source2);
    expect(miss).toBeNull();
  });

  it('should track cache hits correctly', () => {
    if (!native?.graphInit || !native?.getCachedAst || !native?.parseModuleIr) {
      console.log('Native bindings not available, skipping test');
      return;
    }

    native.graphInit(testDbPath, 'test-v3');

    const testSource = `export const test = true;`;
    const testId = '/test/hits.ts';

    // Populate cache
    native.parseModuleIr(testId, testSource);

    // First hit
    const hit1 = native.getCachedAst(testId, testSource);
    expect(hit1).toBeDefined();
    if (hit1) {
      const parsed1 = JSON.parse(hit1);
      expect(parsed1.hits).toBe(1);
    }

    // Second hit
    const hit2 = native.getCachedAst(testId, testSource);
    expect(hit2).toBeDefined();
    if (hit2) {
      const parsed2 = JSON.parse(hit2);
      expect(parsed2.hits).toBe(2);
    }
  });

  it('should store IR dependencies correctly', () => {
    if (!native?.graphInit || !native?.parseModuleIr || !native?.getCachedAst) {
      console.log('Native bindings not available, skipping test');
      return;
    }

    native.graphInit(testDbPath, 'test-v4');

    const testSource = `
import { a } from './a';
import { b } from './b';
import './c.css';
export const test = a + b;
    `.trim();

    const testId = '/test/deps.ts';

    // Parse to populate cache
    const result = native.parseModuleIr(testId, testSource);
    expect(result.dependencies.length).toBe(3);

    // Get from cache
    const cached = native.getCachedAst(testId, testSource);
    expect(cached).toBeDefined();
    
    if (cached) {
      const parsed = JSON.parse(cached);
      expect(parsed.ir).toBeDefined();
      expect(Array.isArray(parsed.ir)).toBe(true);
      expect(parsed.ir.length).toBe(3);
      
      // Verify dependency structure
      const cssImport = parsed.ir.find((dep: any) => dep.specifier === './c.css');
      expect(cssImport).toBeDefined();
      expect(cssImport.kind).toBe('css');
    }
  });
});
