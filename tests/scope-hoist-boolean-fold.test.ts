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

test('scope hoist folds boolean AND operations', async () => {
  if (!native?.buildChunks) {
    expect(true).toBe(true);
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ionify-bool-and-'));
  const src = await writeSource(tmp, [
    'const a = true && false;',
    'const b = true && true;',
    'console.log(a, b);'
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
    const code = main!.code;
    expect(code).toMatch(/const a = false/);
    expect(code).toMatch(/const b = true/);
  } finally {
    process.env.IONIFY_SCOPE_HOIST = prev.HOIST;
    process.env.IONIFY_SCOPE_HOIST_CONST_FOLD = prev.FOLD;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('scope hoist folds boolean OR operations', async () => {
  if (!native?.buildChunks) {
    expect(true).toBe(true);
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ionify-bool-or-'));
  const src = await writeSource(tmp, [
    'const a = false || true;',
    'const b = false || false;',
    'console.log(a, b);'
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
    const code = main!.code;
    expect(code).toMatch(/const a = true/);
    expect(code).toMatch(/const b = false/);
  } finally {
    process.env.IONIFY_SCOPE_HOIST = prev.HOIST;
    process.env.IONIFY_SCOPE_HOIST_CONST_FOLD = prev.FOLD;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('scope hoist folds boolean NOT operations', async () => {
  if (!native?.buildChunks) {
    expect(true).toBe(true);
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ionify-bool-not-'));
  const src = await writeSource(tmp, [
    'const a = !true;',
    'const b = !false;',
    'console.log(a, b);'
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
    const code = main!.code;
    expect(code).toMatch(/const a = false/);
    expect(code).toMatch(/const b = true/);
  } finally {
    process.env.IONIFY_SCOPE_HOIST = prev.HOIST;
    process.env.IONIFY_SCOPE_HOIST_CONST_FOLD = prev.FOLD;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('scope hoist folds numeric comparisons', async () => {
  if (!native?.buildChunks) {
    expect(true).toBe(true);
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ionify-num-cmp-'));
  const src = await writeSource(tmp, [
    'const a = 1 < 2;',
    'const b = 5 > 10;',
    'const c = 3 === 3;',
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
    const code = main!.code;
    expect(code).toMatch(/const a = true/);
    expect(code).toMatch(/const b = false/);
    expect(code).toMatch(/const c = true/);
  } finally {
    process.env.IONIFY_SCOPE_HOIST = prev.HOIST;
    process.env.IONIFY_SCOPE_HOIST_CONST_FOLD = prev.FOLD;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
