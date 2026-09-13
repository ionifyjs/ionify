import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "dist");
const nativeRoot = path.join(root, "native-packages");
const internalPrefixes = [`[G${"2-R1"}] `, `G${"2-C3"} `];
const buildPath = /(?:\.\.\/)+(?:[^/\s"']+\/)+node_modules\/\.pnpm\/[^/\s"']+\/node_modules\/tsup\/assets\/(esm_shims|cjs_shims)\.js/g;
const nativeInternalToken = Buffer.from(`G${"2-C2"}`);
const nativePublicToken = Buffer.from("CACHE");
const textExtensions = new Set([".js", ".cjs", ".mjs", ".ts", ".cts", ".json", ".map"]);

function collectTextFiles(target) {
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(target, entry.name);
    if (entry.isDirectory()) return collectTextFiles(file);
    return textExtensions.has(path.extname(entry.name)) ? [file] : [];
  });
}

const files = collectTextFiles(distRoot);
const changedChunks = [];
let replacements = 0;
let nativeReplacements = 0;
const patchedNativeFiles = [];

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  let after = before;
  for (const prefix of internalPrefixes) {
    const occurrences = after.split(prefix).length - 1;
    if (occurrences === 0) continue;
    after = after.split(prefix).join("");
    replacements += occurrences;
  }
  after = after.replace(buildPath, (_match, shim) => {
    replacements += 1;
    return `tsup/assets/${shim}.js`;
  });
  if (after === before) continue;

  fs.writeFileSync(file, after);

  if (/^chunk-[A-Z0-9]+\.js$/.test(path.basename(file))) {
    changedChunks.push({ file, contents: after });
  }
}

for (const { file, contents } of changedChunks) {
  const oldName = path.basename(file);
  const digest = crypto.createHash("sha256").update(contents).digest("hex").slice(0, 8).toUpperCase();
  const newName = `chunk-${digest}.js`;
  if (newName === oldName) continue;

  const newFile = path.join(path.dirname(file), newName);
  if (fs.existsSync(newFile)) {
    throw new Error(`refusing to overwrite existing release chunk: ${newName}`);
  }
  fs.renameSync(file, newFile);

  for (const referenceFile of collectTextFiles(distRoot)) {
    const before = fs.readFileSync(referenceFile, "utf8");
    if (!before.includes(oldName)) continue;
    fs.writeFileSync(referenceFile, before.split(oldName).join(newName));
  }
}

for (const file of collectTextFiles(distRoot)) {
  const contents = fs.readFileSync(file, "utf8");
  if (
    internalPrefixes.some((prefix) => contents.includes(prefix)) ||
    buildPath.test(contents)
  ) {
    throw new Error(`internal release marker remains in ${path.relative(root, file)}`);
  }
  buildPath.lastIndex = 0;
}

if (nativeInternalToken.length !== nativePublicToken.length) {
  throw new Error("native release-label replacement must preserve binary length");
}
for (const file of fs.readdirSync(nativeRoot, { withFileTypes: true }).flatMap((entry) => {
  if (!entry.isDirectory()) return [];
  const nativeFile = path.join(nativeRoot, entry.name, "ionify_core.node");
  return fs.existsSync(nativeFile) ? [nativeFile] : [];
})) {
  const bytes = fs.readFileSync(file);
  let fileReplacements = 0;
  let offset = bytes.indexOf(nativeInternalToken);
  while (offset >= 0) {
    nativePublicToken.copy(bytes, offset);
    fileReplacements += 1;
    nativeReplacements += 1;
    offset = bytes.indexOf(nativeInternalToken, offset + nativePublicToken.length);
  }
  if (fileReplacements > 0) {
    fs.writeFileSync(file, bytes);
    patchedNativeFiles.push(file);
  }
}

if (process.platform === "darwin") {
  for (const file of patchedNativeFiles) {
    const signed = spawnSync("codesign", ["--force", "--sign", "-", file], { encoding: "utf8" });
    if (signed.status !== 0) {
      throw new Error(`failed to ad-hoc sign ${path.relative(root, file)}: ${signed.stderr.trim()}`);
    }
  }
}

console.log(
  `[release-sanitize] removed ${replacements} internal marker${replacements === 1 ? "" : "s"}; ` +
    `renamed ${changedChunks.length} content chunk${changedChunks.length === 1 ? "" : "s"}; ` +
    `rewrote ${nativeReplacements} native release label${nativeReplacements === 1 ? "" : "s"}`,
);
