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

test('scope hoist inlines single-use zero-arg function', async () => {
  if (!native?.buildChunks) {
    expect(true).toBe(true); // skip if native not present
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ionify-scope-inline-'));
  const src = await writeSource(tmp, [
    'function helper(){ return 5 }',
    'console.log(helper());',
  ].join('\n'));

  const prev = {
    HOIST: process.env.IONIFY_SCOPE_HOIST,
    INLINE: process.env.IONIFY_SCOPE_HOIST_INLINE,
  };
  try {
    // Enabled
    process.env.IONIFY_SCOPE_HOIST = 'true';
    process.env.IONIFY_SCOPE_HOIST_INLINE = 'true';
    const plan = makePlan(src);
    const artifactsOn = native.buildChunks!(plan);
    const mainOn = artifactsOn.find(a => a.id === 'chunk-entry');
    expect(mainOn).toBeTruthy();
    const codeOn = mainOn!.code;
    expect(codeOn).not.toMatch(/function\s+helper/);
    expect(codeOn).toMatch(/console\.log\(5\)/);

    // Disabled
    process.env.IONIFY_SCOPE_HOIST = 'false';
    process.env.IONIFY_SCOPE_HOIST_INLINE = 'false';
    const artifactsOff = native.buildChunks!(plan);
    const mainOff = artifactsOff.find(a => a.id === 'chunk-entry');
    expect(mainOff).toBeTruthy();
    const codeOff = mainOff!.code;
    expect(codeOff).toMatch(/function\s+helper/);
  } finally {
    process.env.IONIFY_SCOPE_HOIST = prev.HOIST;
    process.env.IONIFY_SCOPE_HOIST_INLINE = prev.INLINE;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
