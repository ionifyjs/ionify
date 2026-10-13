import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {assertMainSurface, assertPublicRepositorySurface} from '../scripts/hybrid-release-boundary.mjs';

describe('public Git README and immutable package boundary', () => {
  it('admits the reviewed repository variant while retaining the strict package guard', () => {
    expect(assertPublicRepositorySurface(process.cwd()).status).toBe('VERIFIED');
    expect(() => assertMainSurface(process.cwd())).toThrow('unreviewed publication bytes: README.md');
  });

  it('rejects an unreviewed README edit before admitting the repository surface', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ionify-readme-policy-'));
    try {
      for (const file of ['dist', 'package.json', 'README.md', 'LICENSE']) fs.cpSync(path.join(process.cwd(), file), path.join(root, file), {recursive: true});
      fs.appendFileSync(path.join(root, 'README.md'), '\nUnreviewed claim.\n');
      expect(() => assertPublicRepositorySurface(root)).toThrow('unreviewed publication bytes: README.md');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});
