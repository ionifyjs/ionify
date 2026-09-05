import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
const expectedWhatsNew = `## What's New

### 0.1.36 — Cross-platform native runtime

Fixed #6: Ionify could fail to load its native engine on environments that
didn't match the binary distributed with the package.

Ionify now automatically selects the correct native runtime for supported
macOS, Windows, and Linux environments, with no platform configuration
required.

`;
const expectedBuiltIn = `## Built-in Support

Ionify handles common frontend capabilities directly, without requiring
Ionify-specific plugins:

- React and Fast Refresh
- JavaScript, TypeScript, JSX, and TSX
- ES modules and CommonJS dependency interop
- CSS and CSS Modules
- Static assets
- Dynamic imports and code splitting
- Hot Module Replacement
- Environment files and \`import.meta.env\`
- Workspace and monorepo discovery
- Sass and Less when the corresponding compiler package is installed

### Integrated Tooling

Ionify also integrates directly with project-level tooling such as Tailwind CSS
and PostCSS when their normal project packages and configuration are present.

`;

function sectionRange(text, heading) {
  const marker = `${heading}\n`;
  const start = text.indexOf(marker);
  if (start < 0 || text.indexOf(marker, start + marker.length) >= 0) {
    throw new Error(`README must contain exactly one ${heading} section`);
  }
  const next = text.indexOf("\n## ", start + marker.length);
  return { start, end: next < 0 ? text.length : next + 1 };
}

function readSection(text, heading) {
  const { start, end } = sectionRange(text, heading);
  return text.slice(start, end);
}

function removeSection(text, heading, required = true) {
  if (!text.includes(`${heading}\n`)) {
    if (required) throw new Error(`README is missing ${heading}`);
    return text;
  }
  const { start, end } = sectionRange(text, heading);
  return text.slice(0, start) + text.slice(end);
}

function replaceSection(text, heading, replacement) {
  const { start, end } = sectionRange(text, heading);
  return text.slice(0, start) + replacement + text.slice(end);
}

if (readSection(readme, "## What's New") !== expectedWhatsNew) {
  throw new Error("README What's New must contain only the exact 0.1.36 release note");
}
if (readSection(readme, "## Built-in Support") !== expectedBuiltIn) {
  throw new Error("README Built-in Support differs from the audited built-in capability section");
}
if (/^### 0\.1\.37\b/m.test(readme)) {
  throw new Error("README must not contain a 0.1.37 release note");
}

const readmeBaseRef = process.env.IONIFY_README_BASE_REF || "origin/main";
const baselineResult = spawnSync("git", ["show", `${readmeBaseRef}:README.md`], {
  cwd: root,
  encoding: "utf8",
});
if (baselineResult.status !== 0) {
  throw new Error(
    `unable to read authoritative README baseline ${readmeBaseRef}: ${baselineResult.stderr.trim()}`,
  );
}
const baselineReadme = baselineResult.stdout;
const quickStart = readSection(readme, "## Quick Start");
const baselineQuickStart = readSection(baselineReadme, "## Quick Start");
const baselinePackageCommand = "pnpm add -D ionify";
const packageCommandOccurrences = baselineQuickStart.split(baselinePackageCommand).length - 1;
if (packageCommandOccurrences !== 1) {
  throw new Error(
    `authoritative README baseline must contain exactly one '${baselinePackageCommand}' in Quick Start`,
  );
}
const expectedQuickStart = baselineQuickStart.replace(
  baselinePackageCommand,
  "pnpm add -D @ionify/ionify",
);
if (quickStart !== expectedQuickStart) {
  throw new Error(
    `README Quick Start must differ from ${readmeBaseRef} only by the @ionify/ionify package-name correction`,
  );
}
const candidateOutsideAuthorizedSections = removeSection(
  removeSection(
    replaceSection(readme, "## Quick Start", baselineQuickStart),
    "## Built-in Support",
  ),
  "## What's New",
);
const baselineOutsideAuthorizedSections = removeSection(
  removeSection(baselineReadme, "## Built-in Support", false),
  "## What's New",
);
if (candidateOutsideAuthorizedSections !== baselineOutsideAuthorizedSections) {
  throw new Error(
    `README contains byte changes outside What's New, Built-in Support, and the Quick Start package name relative to ${readmeBaseRef}`,
  );
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
