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

test('scope hoist folds string concatenation', async () => {
  if (!native?.buildChunks) {
    expect(true).toBe(true);
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ionify-str-concat-'));
  const src = await writeSource(tmp, [
    'const greeting = "Hello" + " " + "World";',
    'const name = "Ion" + "ify";',
    'console.log(greeting, name);'
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
    // After folding, should have concatenated strings
    expect(code).toMatch(/Hello World/);
    expect(code).toMatch(/Ionify/);
  } finally {
    process.env.IONIFY_SCOPE_HOIST = prev.HOIST;
    process.env.IONIFY_SCOPE_HOIST_CONST_FOLD = prev.FOLD;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
