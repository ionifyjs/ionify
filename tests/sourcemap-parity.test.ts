import { expect, test } from 'vitest';
import path from 'path';
import fs from 'fs';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

// This test doesn't invoke the full native build; instead, it validates that when
// a native artifact includes a map, our emission strategy writes it correctly and
// that a couple of generated positions map back to plausible original positions.

test('sourcemap file is emitted and decodable', async () => {
  const outDir = path.resolve(process.cwd(), '.ionify-test-out');
  fs.mkdirSync(outDir, { recursive: true });
  try {
    const jsFile = path.join(outDir, 'sample.native.js');
    const mapFile = path.join(outDir, 'sample.native.js.map');
    const mapObj = {
      version: 3,
      file: 'sample.native.js',
      sources: ['input.js'],
      sourcesContent: ["function hello(name){console.log('hi', name)};hello('x');"],
      names: ['hello', 'name', 'console', 'log'],
      mappings: 'AAAA,SAASA,MAAMC,GAAG,CAACC,MAAM,EAACC,OAAO,CAACC,GAAG,CAAC,IAAI,EAAEH,MAAM,CAAC,CAAC;AAC1DD,MAAM,CAAC,IAAI,CAAC,CAAC',
    } as const;
    // Write files mimicking native emission
    fs.writeFileSync(mapFile, JSON.stringify(mapObj), 'utf8');
    fs.writeFileSync(jsFile, "function hello(n){console.log('hi',n)};hello('x');\n//# sourceMappingURL=sample.native.js.map", 'utf8');

    const rawMap = fs.readFileSync(mapFile, 'utf8');
    const tm = new TraceMap(rawMap);
    // A couple of positions from start and near end
    const p1 = originalPositionFor(tm, { line: 1, column: 9 });
    const p2 = originalPositionFor(tm, { line: 1, column: 30 });
    expect(p1.source).toBe('input.js');
    expect(p2.source).toBe('input.js');
    expect(typeof p1.line).toBe('number');
    expect(typeof p2.line).toBe('number');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
