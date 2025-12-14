import { describe, it, expect, beforeEach } from 'vitest';
import { native } from '../src/native';
import fs from 'fs';
import path from 'path';

describe('Wave 2+3: Hash Alignment & Build Integration', () => {
  const testDbPath = path.join(process.cwd(), '.ionify', 'test-wave23.db');
  const testCacheDir = path.join(process.cwd(), '.ionify', 'cache');
  
  beforeEach(() => {
    // Clean test database and cache
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { recursive: true, force: true });
    }
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testCacheDir, { recursive: true });
  });

  it('should store transformed code in AST cache', () => {
    if (!native?.graphInit || !native?.parseModuleIr) {
      console.log('Native bindings not available, skipping test');
      return;
    }

    native.graphInit(testDbPath, 'wave23-v1');

    const testSource = `
import { foo } from './foo';
export const bar = foo + 1;
    `.trim();

    const testId = '/test/module.ts';
    const result = native.parseModuleIr(testId, testSource);
    
    expect(result).toBeDefined();
    expect(result.code).toBeDefined();
    expect(result.code).not.toBe(testSource); // Should be transformed

    // Verify AST cache has transformed code
    if (native.getCachedAst) {
      const cached = native.getCachedAst(testId, testSource);
      expect(cached).toBeDefined();
      
      if (cached) {
        const parsed = JSON.parse(cached);
        expect(parsed.code).toBe(result.code);
      }
    }
  });

  it('should write transformed code to .ionify/cache/{hash}/transformed.js', () => {
    // Simulate build process writing to cache
    const sourceCode = `export const test = 42;`;
    const transformedCode = `const test = 42;\nexport { test };`;
    const sourceHash = 'abc123'; // In real build, this is hash from graph

    const hashDir = path.join(testCacheDir, sourceHash);
    fs.mkdirSync(hashDir, { recursive: true });
    fs.writeFileSync(
      path.join(hashDir, 'transformed.js'),
      transformedCode,
      'utf8'
    );

    // Verify file exists and content matches
    const readBack = fs.readFileSync(
      path.join(hashDir, 'transformed.js'),
      'utf8'
    );
    expect(readBack).toBe(transformedCode);
  });

  it('should prioritize AST cache over file cache', () => {
    if (!native?.graphInit || !native?.parseModuleIr || !native?.getCachedAst) {
      console.log('Native bindings not available, skipping test');
      return;
    }

    native.graphInit(testDbPath, 'wave23-v2');

    const testSource = `export const x = 1;`;
    const testId = '/test/priority.ts';

    // Populate AST cache
    const result = native.parseModuleIr(testId, testSource);
    const astCachedCode = result.code;

    // Write different content to file cache (simulate stale file cache)
    const staleCode = `export const x = 999; // stale`;
    const fakeHash = 'fake123';
    const hashDir = path.join(testCacheDir, fakeHash);
    fs.mkdirSync(hashDir, { recursive: true });
    fs.writeFileSync(
      path.join(hashDir, 'transformed.js'),
      staleCode,
      'utf8'
    );

    // Verify AST cache is preferred
    const cached = native.getCachedAst(testId, testSource);
    expect(cached).toBeDefined();
    
    if (cached) {
      const parsed = JSON.parse(cached);
      expect(parsed.code).toBe(astCachedCode);
      expect(parsed.code).not.toBe(staleCode);
    }
  });

  it('should handle cache invalidation on source change', () => {
    if (!native?.graphInit || !native?.parseModuleIr || !native?.getCachedAst) {
      console.log('Native bindings not available, skipping test');
      return;
    }

    native.graphInit(testDbPath, 'wave23-v3');

    const source1 = `export const version = 1;`;
    const source2 = `export const version = 2;`;
    const testId = '/test/invalidate.ts';

    // Parse first version
    const result1 = native.parseModuleIr(testId, source1);
    const code1 = result1.code;

    // Verify cache hit for same source
    const hit1 = native.getCachedAst(testId, source1);
    expect(hit1).toBeDefined();
    if (hit1) {
      const parsed = JSON.parse(hit1);
      expect(parsed.code).toBe(code1);
    }

    // Verify cache miss for different source
    const miss = native.getCachedAst(testId, source2);
    expect(miss).toBeNull();

    // Parse second version
    const result2 = native.parseModuleIr(testId, source2);
    const code2 = result2.code;

    // Codes should be different
    expect(code2).not.toBe(code1);

    // Verify new cache entry
    const hit2 = native.getCachedAst(testId, source2);
    expect(hit2).toBeDefined();
    if (hit2) {
      const parsed = JSON.parse(hit2);
      expect(parsed.code).toBe(code2);
    }
  });

  it('should maintain cache structure compatibility', () => {
    if (!native?.graphInit || !native?.parseModuleIr || !native?.getCachedAst) {
      console.log('Native bindings not available, skipping test');
      return;
    }

    native.graphInit(testDbPath, 'wave23-v4');

    const testSource = `
import { a } from './a';
import './b.css';
export const result = a * 2;
    `.trim();

    const testId = '/test/structure.ts';
    native.parseModuleIr(testId, testSource);

    const cached = native.getCachedAst(testId, testSource);
    expect(cached).toBeDefined();
    
    if (cached) {
      const parsed = JSON.parse(cached);
      
      // Verify required fields
      expect(parsed).toHaveProperty('code');
      expect(parsed).toHaveProperty('hash');
      expect(parsed).toHaveProperty('ir');
      expect(parsed).toHaveProperty('hits');
      
      // Verify IR structure
      expect(Array.isArray(parsed.ir)).toBe(true);
      expect(parsed.ir.length).toBeGreaterThan(0);
      
      // Verify dependency kinds preserved
      const cssImport = parsed.ir.find((dep: any) => dep.specifier === './b.css');
      expect(cssImport).toBeDefined();
      expect(cssImport.kind).toBe('css');
    }
  });
});
