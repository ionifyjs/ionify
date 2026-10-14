import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {describe, expect, it} from 'vitest';
import {assertMainSurface, assertPublicRepositorySurface, assertPublicReadmeProjection} from '../scripts/hybrid-release-boundary.mjs';

const policy = JSON.parse(fs.readFileSync('scripts/public-readme-policy.json', 'utf8'));
const baseline = execFileSync('git', ['show', `${policy.baseCommit}:README.md`]);
const candidate = fs.readFileSync('README.md');
const sha = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
const blob = (bytes: Buffer) => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

describe('public Git README and immutable package boundary', () => {
  it('admits exactly the current-version token change against the owner baseline', () => {
    const main = execFileSync('git', ['show', 'origin/main:README.md']);
    expect(assertPublicReadmeProjection(baseline, candidate, policy, main).status).toBe('VERIFIED');
    expect(candidate.length).toBe(baseline.length);
    expect([...candidate].filter((byte, i) => byte !== baseline[i])).toHaveLength(1);
  });

  it.each(['before', 'after'])('admits main %s the protected README merge', state => {
    expect(assertPublicReadmeProjection(baseline, candidate, policy, state === 'before' ? baseline : candidate).status).toBe('VERIFIED');
  });

  it('retains the unchanged strict npm policy and rejects the Git README as package bytes', () => {
    expect(assertPublicRepositorySurface(process.cwd()).status).toBe('VERIFIED');
    expect(sha(fs.readFileSync('scripts/hybrid-release-files.json'))).toBe('5d65495ed1ca5ed6385d83b2ed08853141781278707d09a8682e8ba9ec62e908');
    expect(() => assertMainSurface(process.cwd())).toThrow('unreviewed publication bytes: README.md');
  });

  it.each(['\n', '\nUnreviewed claim.\n'])('rejects extra owner-byte edits even with a matching proposed digest: %j', suffix => {
    const changed = Buffer.concat([candidate, Buffer.from(suffix)]);
    const forged = {...policy, repositorySha256: sha(changed), repositoryReadmeGitBlob: blob(changed)};
    expect(() => assertPublicReadmeProjection(baseline, changed, forged)).toThrow('only the reviewed version token correction');
  });

  it('rejects a wrong version instead of the authorized successor', () => {
    const changed = Buffer.from(candidate.toString().replace(policy.versionCorrection.after, policy.versionCorrection.after.replace('0.1.38', '0.1.39')));
    expect(() => assertPublicReadmeProjection(baseline, changed, policy)).toThrow('only the reviewed version token correction');
  });

  it('rejects a duplicate version anchor rather than changing multiple occurrences', () => {
    const changed = Buffer.concat([baseline, Buffer.from(policy.versionCorrection.before)]);
    const forged = {...policy, baseSha256: sha(changed), baseReadmeGitBlob: blob(changed)};
    expect(() => assertPublicReadmeProjection(changed, candidate, forged)).toThrow('anchor must occur exactly once');
  });

  it('fails closed when current main contains another owner edit', () => {
    const moved = Buffer.concat([baseline, Buffer.from('\nOwner update.\n')]);
    expect(() => assertPublicReadmeProjection(baseline, candidate, policy, moved)).toThrow('current public main README moved');
  });
});
