import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Positive, reviewed publication inputs. Never generate this policy by scanning
// an unclassified dist tree during packing; changes require explicit admission.
const policyPath = fileURLToPath(new URL("./hybrid-release-files.json", import.meta.url));
const PUBLIC = new Set(["PUBLIC_RUNTIME_REQUIRED", "PUBLIC_API_CONTRACT", "PUBLIC_SAFE_DERIVED", "PUBLIC_DOCS"]);
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = message => { throw new Error(`[hybrid-boundary] ${message}`); };

function walk(root, prefix = "") {
  if (!fs.existsSync(root)) fail(`missing publication input: ${root}`);
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`symlink publication input: ${relative}`);
    if (stat.isDirectory()) return walk(absolute, relative);
    if (!stat.isFile()) fail(`non-file publication input: ${relative}`);
    return [{ relative, absolute }];
  });
}

function assertPath(relative) {
  if (/\.rs(?:$|[./\\])/i.test(relative) || /(?:^|\/)(?:Cargo\.(?:toml|lock)|build\.rs|rust|target)(?:\/|$)/i.test(relative)) {
    fail(`PRIVATE_ENGINE_IMPLEMENTATION: ${relative}`);
  }
  if (/(?:^|\/)(?:\.release-authority|DocsV2|private-proofs|receipts|evidence|tests)(?:\/|$)|(?:gate-?2|g2-).*\.(?:json|md|patch)$/i.test(relative)) {
    fail(`PRIVATE_AUTHORITY_PROOF: ${relative}`);
  }
}

export function assertHybridContents(bytes, relative) {
  const text = bytes.toString("latin1");
  // Binary diagnostics naming the private engine tree are source-layout
  // metadata, not the compiled algorithm itself or a third-party .rs reference.
  if (/(?:src[\\/]rust[\\/]|\/ionify\/source\/|ionify-core(?:[\\/]|\.git)|\.release-authority[\\/]|DocsV2[\\/]|ionify\.release-authority-(?:receipt|envelope)|ionify\.private-native-build-proof)/i.test(text)) {
    fail(`private implementation/proof/provenance content: ${relative}`);
  }
  if (/(?:\/Users\/[^/\0]+\/|\/home\/[^/\0]+\/|[A-Z]:[\\/]Users[\\/][^\\/\0]+[\\/]|[A-Z]:[\\/]a[\\/][^\\/\0]+[\\/]|\/private\/tmp\/|\/workspace\/)/i.test(text)) {
    fail(`private build-machine path: ${relative}`);
  }
  if (/(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text)) {
    fail(`SECRET_OR_CREDENTIAL: ${relative}`);
  }
  // TypeScript also has `export enum`; a bare enum token is not Rust proof.
  if (/\b(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(?:async\s+)?fn\s+[A-Za-z_]\w*\s*(?:<[^>]+>)?\s*\(|\b(?:(?:pub\s+)?(?:struct|trait|impl)|pub\s+enum)\s+[A-Za-z_]\w*\s*(?:<[^>]+>)?\s*\{|\buse\s+(?:crate|super|std)::/.test(text)) {
    fail(`embedded Rust implementation: ${relative}`);
  }
}

function policy() {
  const value = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  for (const rows of [value.main, value.creator, value.publicSource, ...Object.values(value.native)])
    for (const row of rows) {
      assertPath(row.file);
      if (!PUBLIC.has(row.classification)) fail(`UNKNOWN policy classification: ${row.file}`);
      if (!/^[0-9a-f]{64}$/.test(row.sha256)) fail(`missing reviewed digest: ${row.file}`);
    }
  return value;
}

export function assertHybridAllowlist(pkg, expected, label) {
  if (!Array.isArray(pkg.files) || pkg.files.length !== expected.length || new Set(pkg.files).size !== expected.length || !expected.every(file => pkg.files.includes(file))) {
    fail(`${label} package allowlist expanded or changed`);
  }
}

function checkRows(root, actual, admitted, preSanitize = false) {
  for (const row of admitted) {
    assertPath(row.file);
    if (!PUBLIC.has(row.classification)) fail(`UNKNOWN policy classification: ${row.file}`);
    if (!/^[0-9a-f]{64}$/.test(row.sha256)) fail(`missing reviewed digest: ${row.file}`);
  }
  const rows = new Map(admitted.map(row => [row.file, row]));
  if (rows.size !== admitted.length) fail("duplicate admitted publication path");
  for (const { relative, absolute } of actual) {
    assertPath(relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`symlink publication input: ${relative}`);
    if (!stat.isFile()) fail(`non-file publication input: ${relative}`);
    const row = rows.get(relative);
    if (!row) fail(`UNKNOWN newly reachable file: ${relative}`);
    const bytes = fs.readFileSync(absolute);
    // A reviewed digest rejects renamed/encoded Rust and private material as
    // well; extension or marker scans are defense-in-depth, not admission.
    const digest = sha(bytes);
    if (digest !== row.sha256 && !(preSanitize && digest === row.producerSha256)) fail(`unreviewed publication bytes: ${relative}`);
    // Pre-sanitizer digest admission never permits private Rust/source content
    // to be copied first and erased later.
    assertHybridContents(bytes, relative);
  }
  const seen = new Set(actual.map(row => row.relative));
  for (const row of admitted) if (!seen.has(row.file)) fail(`missing admitted publication file: ${row.file}`);
  return { status: "VERIFIED", files: actual.map(row => row.relative), policySha256: sha(fs.readFileSync(policyPath)), root };
}

// Pure publication-policy primitive, also exercised by the permanent tests.
// Production callers below use the checked-in reviewed policy, never a scan.
export function assertHybridFileSet(root, admitted, { preSanitize = false } = {}) {
  return checkRows(root, walk(root), admitted, preSanitize);
}

export function assertMainDist(root, { preSanitize = false, creatorOutput = false } = {}) {
  const admitted = policy().main.filter(row => row.file.startsWith("dist/"));
  let actual = walk(path.join(root, "dist"), "dist");
  if (creatorOutput) {
    const creator = actual.filter(row => row.relative.startsWith("dist/create-ionify/"));
    if (creator.length) assertCreatorSurface(path.join(root, "dist", "create-ionify"));
    actual = actual.filter(row => !row.relative.startsWith("dist/create-ionify/"));
  }
  return checkRows(root, actual, admitted, preSanitize);
}

export function assertMainSurface(root, { preSanitize = false } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assertHybridAllowlist(pkg, ["dist", "README.md", "LICENSE"], "main");
  // npm force-includes these root document families even outside `files`.
  // They must not become an unclassified route around the dist allowlist.
  const rootDocuments = fs.readdirSync(root).filter(file => /^(?:readme|copying|licen[cs]e)(?:$|\.)/i.test(file));
  const actual = [...walk(path.join(root, "dist"), "dist"), ...[...rootDocuments, "package.json"].map(relative => ({ relative, absolute: path.join(root, relative) }))];
  return checkRows(root, actual, policy().main, preSanitize);
}

export function assertNativeSurface(root, { requireAddon = false } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assertHybridAllowlist(pkg, ["ionify_core.node", "README.md", "LICENSE"], "native");
  const allowed = new Set(["ionify_core.node", "package.json", "README.md", "LICENSE"]);
  const actual = walk(root);
  const target = pkg.name?.replace(/^@ionify\/ionify-/, "");
  const admitted = policy().native[target];
  if (!admitted) fail(`UNKNOWN native package context: ${pkg.name}`);
  for (const { relative, absolute } of actual) {
    assertPath(relative);
    if (!allowed.has(relative)) fail(`UNKNOWN native publication input: ${relative}`);
    const bytes = fs.readFileSync(absolute);
    assertHybridContents(bytes, relative);
    if (relative === "ionify_core.node") {
      const magic = bytes.subarray(0, 4).toString("hex");
      if (!["cffaedfe", "feedfacf", "cafebabe", "bebafeca", "7f454c46"].includes(magic) && bytes.subarray(0, 2).toString() !== "MZ") fail("native addon is not a compiled platform binary");
    }
  }
  checkRows(root, actual.filter(row => row.relative !== "ionify_core.node"), admitted);
  for (const file of ["package.json", "README.md", "LICENSE", ...(requireAddon ? ["ionify_core.node"] : [])]) if (!actual.some(row => row.relative === file)) fail(`missing native publication file: ${file}`);
  return { status: "VERIFIED", files: actual.map(row => row.relative) };
}

export function assertCreatorSurface(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assertHybridAllowlist(pkg, ["index.js", "README.md"], "creator");
  return checkRows(root, walk(root), policy().creator);
}

export function assertPublicSource(root) {
  return checkRows(root, walk(path.join(root, "src"), "src"), policy().publicSource);
}

export function assertPublicSurface(root, options = {}) {
  const main = assertMainSurface(root, options);
  const native = [];
  for (const target of fs.readdirSync(path.join(root, "native-packages")).sort()) native.push({ target, ...assertNativeSurface(path.join(root, "native-packages", target)) });
  // Public Git/source projection is distinct from npm's dist allowlist.
  // Unknown source leaves may not inherit directory-level public permission.
  const publicSource = assertPublicSource(root);
  return { status: "VERIFIED", main, native, publicSource };
}

// Public Git documentation is reviewed independently of immutable npm inputs.
// Publication callers above continue to require the original package README.
export function assertPublicRepositorySurface(root) {
  const readmePolicy = JSON.parse(fs.readFileSync(new URL('./public-readme-policy.json', import.meta.url), 'utf8'));
  const admitted = policy().main;
  const original = admitted.find(row => row.file === 'README.md');
  if (readmePolicy.frozenPackageSha256 !== original.sha256 || !/^[a-f0-9]{64}$/.test(readmePolicy.repositorySha256)) fail('invalid public README projection policy');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assertHybridAllowlist(pkg, ['dist', 'README.md', 'LICENSE'], 'main');
  const rootDocuments = fs.readdirSync(root).filter(file => /^(?:readme|copying|licen[cs]e)(?:$|\.)/i.test(file));
  const actual = [...walk(path.join(root, 'dist'), 'dist'), ...[...rootDocuments, 'package.json'].map(relative => ({relative, absolute: path.join(root, relative)}))];
  const main = checkRows(root, actual, admitted.map(row => row.file === 'README.md' ? {...row, sha256: readmePolicy.repositorySha256} : row));
  const native = fs.readdirSync(path.join(root, 'native-packages')).sort().map(target => ({target, ...assertNativeSurface(path.join(root, 'native-packages', target))}));
  const publicSource = assertPublicSource(root);
  return {status: 'VERIFIED', main, native, publicSource, readme: 'REVIEWED_PUBLIC_GIT_VARIANT_NOT_PACKAGE_BYTES'};
}
