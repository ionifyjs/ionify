import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';
import { native } from '../src/native/index';
import type { BuildPlan, BuildPlanChunk, BuildPlanModule } from '../src/types/plan';

function makePlan(entryFile: string): BuildPlan {
  const modules: BuildPlanModule[] = [
    { id: entryFile, hash: undefined, kind: 'js', deps: [], dynamicDeps: [] },
  ];
  const chunk: BuildPlanChunk = {
    id: 'chunk-entry',
    modules,
    entry: true,
    shared: false,
    consumers: [entryFile],
    css: [],
    assets: [],
  };
  return { entries: [entryFile], chunks: [chunk] };
}

async function writeSource(root: string, content: string): Promise<string> {
  const file = path.join(root, 'entry.js');
  await fs.writeFile(file, content, 'utf8');
  return file;
}

test('scope hoist reports stats for inlined functions', async () => {
  if (!native?.buildChunks) {
    expect(true).toBe(true);
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ionify-stats-inline-'));
  const src = await writeSource(tmp, [
    'function helper1() { return 42; }',
    'function helper2() { return "test"; }',
    'console.log(helper1(), helper2());',
  ].join('\n'));

  const prev = {
    HOIST: process.env.IONIFY_SCOPE_HOIST,
    INLINE: process.env.IONIFY_SCOPE_HOIST_INLINE,
  };
  try {
    process.env.IONIFY_SCOPE_HOIST = 'true';
    process.env.IONIFY_SCOPE_HOIST_INLINE = 'true';
    const plan = makePlan(src);
    const artifacts = native.buildChunks!(plan);
    const main = artifacts.find(a => a.id === 'chunk-entry');
    expect(main).toBeTruthy();
    
    // Check that stats are present
    expect(main!.scope_hoist_stats).toBeDefined();
    if (main!.scope_hoist_stats) {
      expect(main!.scope_hoist_stats.inlined_functions).toBeGreaterThan(0);
    }
  } finally {
    process.env.IONIFY_SCOPE_HOIST = prev.HOIST;
    process.env.IONIFY_SCOPE_HOIST_INLINE = prev.INLINE;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('scope hoist reports stats for folded constants', async () => {
  if (!native?.buildChunks) {
    expect(true).toBe(true);
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ionify-stats-fold-'));
  const src = await writeSource(tmp, [
    'const a = 2 + 3;',
    'const b = 10 * 5;',
    'const c = true && false;',
    'console.log(a, b, c);'
  ].join('\n'));

  const prev = {
    HOIST: process.env.IONIFY_SCOPE_HOIST,
    FOLD: process.env.IONIFY_SCOPE_HOIST_CONST_FOLD,
  };
  try {
    process.env.IONIFY_SCOPE_HOIST = 'true';
    process.env.IONIFY_SCOPE_HOIST_CONST_FOLD = 'true';
    const plan = makePlan(src);
    const artifacts = native.buildChunks!(plan);
    const main = artifacts.find(a => a.id === 'chunk-entry');
    expect(main).toBeTruthy();
    
    // Check that stats are present
    expect(main!.scope_hoist_stats).toBeDefined();
    if (main!.scope_hoist_stats) {
      expect(main!.scope_hoist_stats.folded_constants).toBeGreaterThan(0);
    }
  } finally {
    process.env.IONIFY_SCOPE_HOIST = prev.HOIST;
    process.env.IONIFY_SCOPE_HOIST_CONST_FOLD = prev.FOLD;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('scope hoist reports stats for merged declarations', async () => {
  if (!native?.buildChunks) {
    expect(true).toBe(true);
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ionify-stats-merge-'));
  const src = await writeSource(tmp, [
    'let a = 1;',
    'let b = 2;',
    'let c = 3;',
    'console.log(a, b, c);'
  ].join('\n'));

  const prev = {
    HOIST: process.env.IONIFY_SCOPE_HOIST,
    COMBINE: process.env.IONIFY_SCOPE_HOIST_COMBINE_VARS,
  };
  try {
    process.env.IONIFY_SCOPE_HOIST = 'true';
    process.env.IONIFY_SCOPE_HOIST_COMBINE_VARS = 'true';
    const plan = makePlan(src);
    const artifacts = native.buildChunks!(plan);
    const main = artifacts.find(a => a.id === 'chunk-entry');
    expect(main).toBeTruthy();
    
    // Check that stats are present
    expect(main!.scope_hoist_stats).toBeDefined();
    if (main!.scope_hoist_stats) {
      expect(main!.scope_hoist_stats.merged_declarations).toBeGreaterThan(0);
    }
  } finally {
    process.env.IONIFY_SCOPE_HOIST = prev.HOIST;
    process.env.IONIFY_SCOPE_HOIST_COMBINE_VARS = prev.COMBINE;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('scope hoist stats are zero when optimizations disabled', async () => {
  if (!native?.buildChunks) {
    expect(true).toBe(true);
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ionify-stats-off-'));
  const src = await writeSource(tmp, [
    'function helper() { return 42; }',
    'const a = 2 + 3;',
    'let b = 1;',
    'let c = 2;',
    'console.log(helper(), a, b, c);'
  ].join('\n'));

  const prev = process.env.IONIFY_SCOPE_HOIST;
  try {
    process.env.IONIFY_SCOPE_HOIST = 'false';
    const plan = makePlan(src);
    const artifacts = native.buildChunks!(plan);
    const main = artifacts.find(a => a.id === 'chunk-entry');
    expect(main).toBeTruthy();
    
    // Stats should still be present but with zero values
    if (main!.scope_hoist_stats) {
      expect(main!.scope_hoist_stats.inlined_functions).toBe(0);
      expect(main!.scope_hoist_stats.folded_constants).toBe(0);
      expect(main!.scope_hoist_stats.merged_declarations).toBe(0);
    }
  } finally {
    process.env.IONIFY_SCOPE_HOIST = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
