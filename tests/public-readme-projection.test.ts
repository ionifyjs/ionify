import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {describe, expect, it} from 'vitest';
import {assertMainSurface, assertPublicRepositorySurface} from '../scripts/hybrid-release-boundary.mjs';

describe('public Git README and immutable package boundary', () => {
  it('preserves the current owner main README bytes and Git blob without a version rewrite', () => {
    const baseline = execFileSync('git', ['show', 'origin/main:README.md']);
    expect(fs.readFileSync('README.md')).toEqual(baseline);
    const policy = JSON.parse(fs.readFileSync('scripts/public-readme-policy.json', 'utf8'));
    expect(policy.repositorySha256).toBe(policy.baseSha256);
    expect(execFileSync('git', ['rev-parse', 'origin/main:README.md'], {encoding:'utf8'}).trim()).toBe(policy.baseReadmeGitBlob);
  });

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
