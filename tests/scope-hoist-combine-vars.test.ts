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

test('scope hoist combines adjacent variable declarations', async () => {
  if (!native?.buildChunks) {
    expect(true).toBe(true); // skip if native not present
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ionify-scope-vars-'));
  const src = await writeSource(tmp, [
    'let a = 1;',
    'let b = 2;',
    'console.log(a + b);'
  ].join('\n'));

  const prev = {
    HOIST: process.env.IONIFY_SCOPE_HOIST,
    COMBINE: process.env.IONIFY_SCOPE_HOIST_COMBINE_VARS,
  };
  try {
    process.env.IONIFY_SCOPE_HOIST = 'true';
    process.env.IONIFY_SCOPE_HOIST_COMBINE_VARS = 'true';
    const plan = makePlan(src);
    const artifactsOn = native.buildChunks!(plan);
    const mainOn = artifactsOn.find(a => a.id === 'chunk-entry');
    expect(mainOn).toBeTruthy();
    const codeOn = mainOn!.code;
    // Single 'let' with comma separation
    expect(codeOn).toMatch(/let a = 1, b = 2/);

    process.env.IONIFY_SCOPE_HOIST = 'false';
    process.env.IONIFY_SCOPE_HOIST_COMBINE_VARS = 'false';
    const artifactsOff = native.buildChunks!(plan);
    const mainOff = artifactsOff.find(a => a.id === 'chunk-entry');
    expect(mainOff).toBeTruthy();
    const codeOff = mainOff!.code;
    expect(codeOff).toMatch(/let a = 1;\s*let b = 2;/);
  } finally {
    process.env.IONIFY_SCOPE_HOIST = prev.HOIST;
    process.env.IONIFY_SCOPE_HOIST_COMBINE_VARS = prev.COMBINE;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
