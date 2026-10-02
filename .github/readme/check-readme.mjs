import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const source = readFileSync(join(root, 'README.md'), 'utf8');
const assetRoot = 'https://raw.githubusercontent.com/ionifyjs/ionify/main/';
const references = [...source.matchAll(/(?:src|srcset)="([^"]+)"/g)].map(match => match[1]);
assert(references.length >= 4, 'Hero, still, result and architecture images are present');
for (const reference of references) {
  assert(reference.startsWith(assetRoot), `Image must be repo-owned: ${reference}`);
  const path = join(root, reference.slice(assetRoot.length));
  assert(existsSync(path), `Missing image: ${path}`);
  assert(statSync(path).size < 5 * 1024 * 1024, `Image exceeds 5 MiB budget: ${path}`);
}
for (const image of source.matchAll(/<img\b[^>]+>/g)) assert(/alt="[^"]+"/.test(image[0]), 'Every image has an alt description');
assert(!/<script|<iframe|<canvas|<style|\bstyle=|\bonclick=/i.test(source), 'No unsupported interactive README HTML');
assert(source.includes('prefers-reduced-motion: reduce') && source.includes('View the still'), 'Motion alternatives');
assert.equal((source.match(/^```/gm) || []).length % 2, 0, 'Balanced code fences');
assert(!/^`{4,}/m.test(source), 'No malformed fences');
assert.equal((source.match(/<details>/g)||[]).length,(source.match(/<\/details>/g)||[]).length,'Balanced disclosures');
for(const text of ['~30 ms','~120 ms','~5–6 s','~2.7 s','15,000','25,000','not independently reproduced','Cloud CAS is in progress','Fast First Build is planned','darwin-arm64','darwin-x64']) assert(source.includes(text), `Required scope: ${text}`);
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert(source.includes(manifest.version), 'README references the current package version');
assert(source.includes(manifest.engines.node), 'Node requirements match the package manifest');
const sections=['## 01 / The next build','## 02 / Make your first build','## 03 / Make one change','## 04 / Why the work can survive','## 05 / Know the boundaries'];
let previous=-1;
for(const section of sections){const position=source.indexOf(section);assert(position>previous, `Outcome/example/architecture ordering: ${section}`);previous=position;}
const anchors=new Set([...source.matchAll(/^#{1,6} (.+)$/gm)].map(match=>match[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/ /g,'-')));
for(const match of source.matchAll(/\]\(#([^)]*)\)/g))assert(anchors.has(match[1]),`Broken anchor: ${match[1]}`);
for(const match of source.matchAll(/\]\(([^)]+)\)/g)){const path=match[1];if(!/^(https?:|mailto:|#)/.test(path))assert(existsSync(join(root,path)),`Broken relative link: ${path}`);}
assert(!/drive\.google\.com|docs\.google\.com|UP-Portal|khaledsalem\/Projects/.test(source), 'No private reference links or local paths in public README');
console.log('README checks passed: repo-owned assets, budget, alt text, motion fallback, examples, anchors, source order and claim boundaries.');
