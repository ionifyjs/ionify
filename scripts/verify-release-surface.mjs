import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const expectedTargets = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64-gnu",
  "linux-arm64-musl",
  "linux-x64-gnu",
  "linux-x64-musl",
  "win32-arm64-msvc",
  "win32-x64-msvc",
];

function collectFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) =>
    collectFiles(path.join(target, entry.name)),
  );
}

if (pkg.name !== "@ionify/ionify" || !pkg.version) throw new Error("invalid main package identity");
if (fs.existsSync(path.join(root, "dist", "ionify_core.node"))) {
  throw new Error("main package must not contain a host-specific native addon");
}
for (const target of expectedTargets) {
  const native = JSON.parse(fs.readFileSync(path.join(root, "native-packages", target, "package.json"), "utf8"));
  const expectedName = `@ionify/ionify-${target}`;
  if (native.name !== expectedName || native.version !== pkg.version) {
    throw new Error(`${target} identity/version does not match the main package`);
  }
  if (pkg.optionalDependencies?.[expectedName] !== pkg.version) {
    throw new Error(`${expectedName} is not an exact optional dependency`);
  }
}
if (Object.keys(pkg.optionalDependencies ?? {}).length !== expectedTargets.length) {
  throw new Error("main package must declare exactly eight native optional dependencies");
}

const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const quickStart = `## Quick Start

Create a new project:

\`\`\`bash
pnpm create ionify
\`\`\`\`

Or add Ionify to an existing project:

\`\`\`bash
pnpm add -D @ionify/ionify
\`\`\`

Create \`ionify.config.ts\`:

\`\`\`typescript
import { defineConfig } from "@ionify/ionify";

export default defineConfig({
  entry: "/src/main.ts",
  outDir: "dist",
});
\`\`\`

Then:

\`\`\`bash
pnpm ionify dev
pnpm ionify build
\`\`\`

`;
const quickStartBegin = readme.indexOf("## Quick Start\n");
const quickStartEnd = readme.indexOf("\n---", quickStartBegin);
if (quickStartBegin < 0 || quickStartEnd < 0 || readme.slice(quickStartBegin, quickStartEnd + 1) !== quickStart) {
  throw new Error("Quick Start differs from the frozen pre-0.1.36 byte contract");
}
const whatsNew = readme.match(/^## What's New$/gm) ?? [];
const currentReleaseEntry = readme.match(/^### 0\.1\.37 — Isolated dependency generations$/gm) ?? [];
const nativeReleaseEntry = readme.match(/^### 0\.1\.36 — Cross-platform native runtime$/gm) ?? [];
if (whatsNew.length !== 1 || currentReleaseEntry.length !== 1 || nativeReleaseEntry.length !== 1) {
  throw new Error("README must contain exactly one 0.1.37 and one 0.1.36 What's New entry");
}
for (const script of ["publish-all.mjs", "real-registry-smoke.mjs", "release-local-registry.mjs"]) {
  if (!fs.existsSync(path.join(root, "scripts", script))) throw new Error(`missing release script: ${script}`);
}

const publicSurfaceFiles = [
  path.join(root, "src"),
  path.join(root, "dist"),
  path.join(root, "native-packages"),
  path.join(root, "README.md"),
  path.join(root, "package.json"),
].flatMap(collectFiles);
const privateMarker = new RegExp(
  String.raw`(?:DocsV\x32|Gate[ -]?\x32|G\x32-[A-Z0-9-]+|docs\/(?:gate-\x32|g\x32-)|\/Users\/khaled` +
    String.raw`salem|github_pa` +
    String.raw`t_|gh` +
    String.raw`p_)`,
  "i",
);
for (const file of publicSurfaceFiles) {
  const bytes = fs.readFileSync(file);
  if (bytes.includes(0)) continue;
  if (privateMarker.test(bytes.toString("utf8"))) {
    throw new Error(`private release marker found in public surface: ${path.relative(root, file)}`);
  }
}

const privateBinaryMarker = new RegExp(
  String.raw`(?:DocsV\x32|Gate[ -]?\x32|G\x32-[A-Z0-9-]+|\/Users\/[^/\0]+\/|\/home\/[^/\0]+\/|` +
    String.raw`[A-Z]:[\\/]Users[\\/][^\\/\0]+[\\/]|[A-Z]:[\\/]a[\\/][^\\/\0]+[\\/]|\/workspace\/)`,
  "i",
);
for (const nativeFile of publicSurfaceFiles.filter((file) => file.endsWith(".node"))) {
  if (privateBinaryMarker.test(fs.readFileSync(nativeFile).toString("latin1"))) {
    throw new Error(
      `private release marker or build-machine path found in native addon: ${path.relative(root, nativeFile)}`,
    );
  }
}
console.log(`[release-verify] ${pkg.version}: eight native packages, README, and release commands verified`);
