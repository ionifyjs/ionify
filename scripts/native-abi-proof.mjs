import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const PROBE_SOURCE = String.raw`
  (async () => {
  const crypto = require("crypto");
  const fs = require("fs");
  const path = require("path");
  const { pathToFileURL } = require("url");
  const loadRequest = process.argv[1];
  const expectedPackage = process.argv[2];
  const expectedArtifactSha = process.argv[3];
  const lockfile = process.argv[4] === "1" ? fs.readFileSync(0) : null;
  const before = new Set(Object.keys(require.cache));
  const loaded = loadRequest.endsWith(".node")
    ? require(loadRequest)
    : await import(pathToFileURL(loadRequest).href);
  const addedAddons = Object.keys(require.cache).filter((file) => !before.has(file) && file.endsWith(".node"));
  if (addedAddons.length !== 1) throw new Error("runtime load must add exactly one native addon: " + JSON.stringify(addedAddons));
  const addonPath = fs.realpathSync(addedAddons[0]);
  const artifactSha256 = crypto.createHash("sha256").update(fs.readFileSync(addonPath)).digest("hex");
  if (artifactSha256 !== expectedArtifactSha) {
    throw new Error("loaded native artifact hash mismatch: " + artifactSha256 + " != " + expectedArtifactSha);
  }
  let cursor = path.dirname(addonPath);
  let actualPackage = null;
  for (let index = 0; index < 12; index += 1) {
    const manifestPath = path.join(cursor, "package.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (typeof manifest.name === "string") { actualPackage = manifest.name; break; }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (actualPackage !== expectedPackage) {
    throw new Error("actual loaded native package " + actualPackage + " != " + expectedPackage);
  }
  const binding = loadRequest.endsWith(".node") && addonPath === fs.realpathSync(loadRequest)
    ? loaded
    : (loaded.native || require(addonPath));
  const exportNames = Object.keys(binding).sort();
  const required = [
    "applyDefineReplacements", "cacheHash", "cacheHashPath", "depsOptimizerOutputVersion",
    "depsStoreHash", "parseImports", "parseModuleMetadata",
  ];
  const missing = required.filter((name) => typeof binding[name] !== "function");
  if (missing.length) throw new Error("representative ABI exports missing: " + missing.join(", "));
  const imports = binding.parseImports("import value from 'abi-dependency'; export { value };", "abi.ts");
  if (!Array.isArray(imports) || imports.length !== 1 || imports[0] !== "abi-dependency") {
    throw new Error("string/array ABI conversion failed: " + JSON.stringify(imports));
  }
  const metadata = binding.parseModuleMetadata("import value from 'abi-dependency'; export { value };", "abi.ts");
  if (!metadata || !Array.isArray(metadata.imports) || typeof metadata.hash !== "string") {
    throw new Error("object ABI conversion failed");
  }
  const bufferHash = binding.cacheHash(Buffer.from("ionify-native-abi", "utf8"));
  if (typeof bufferHash !== "string" || !bufferHash.length) throw new Error("Buffer ABI conversion failed");
  const defined = binding.applyDefineReplacements(
    "export const value = FLAG;",
    [{ key: "FLAG", replacement: "7", isMember: false }],
    null,
  );
  if (defined !== "export const value = 7;") throw new Error("array/object ABI conversion failed: " + defined);
  const outputVersion = binding.depsOptimizerOutputVersion();
  if (!Number.isInteger(outputVersion) || outputVersion < 1) throw new Error("scalar ABI conversion failed");
  let errorPath;
  try {
    binding.cacheHashPath(path.join(process.cwd(), ".ionify-release-authority-missing-path"));
    errorPath = { threw: false };
  } catch (error) {
    errorPath = { threw: true, name: error && error.name || null, code: error && error.code || null };
  }
  if (!errorPath.threw) throw new Error("error ABI conversion failed");
  const abiDepsStoreHash = binding.depsStoreHash(
    "release-authority-abi", Buffer.from("lockfileVersion: abi\n"), "production", false, true, "auto", 1,
  );
  const depsStoreHash = binding.depsStoreHash(
    "release-authority-abi", lockfile, "production", false, true, "auto", 1,
  );
  if (typeof depsStoreHash !== "string" || !depsStoreHash.length) throw new Error("depsStoreHash returned no identity");
  const stable = (value) => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(stable);
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  };
  const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
  process.stdout.write(JSON.stringify({
    status: "VERIFIED",
    nodePatch: process.versions.node,
    nodeMajor: Number(process.versions.node.split(".")[0]),
    napi: process.versions.napi || null,
    expectedNativePackage: expectedPackage,
    actualLoadedNativePackage: actualPackage,
    actualLoadedArtifactPath: addonPath,
    actualLoadedArtifactSha256: artifactSha256,
    exportNames,
    exportCount: exportNames.length,
    exportSetDigest: digest(exportNames),
    representativeCalls: {
      stringToArray: { imports, digest: digest(imports) },
      stringToObject: { imports: metadata.imports, hashType: typeof metadata.hash, digest: digest(metadata) },
      bufferToString: { value: bufferHash, digest: digest(bufferHash) },
      arrayObjectToString: { value: defined, digest: digest(defined) },
      scalar: { value: outputVersion, digest: digest(outputVersion) },
      errorConversion: { value: errorPath, digest: digest(errorPath) },
      depsStoreHash: { value: depsStoreHash, digest: digest(depsStoreHash) },
      deterministicDepsStoreHash: { value: abiDepsStoreHash, digest: digest(abiDepsStoreHash) },
    },
    behaviorDigest: digest({ imports, metadata, bufferHash, defined, outputVersion, errorPath, abiDepsStoreHash }),
  }));
  })().catch((error) => { console.error(error); process.exitCode = 1; });
`;

export function findNativeRuntimeEntry(packageRoot) {
  const distRoot = path.join(packageRoot, "dist");
  const candidates = fs.readdirSync(distRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(distRoot, entry.name))
    .filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      return source.includes("function loadNativeBinding(") &&
        source.includes("nativeBinding = loadNativeBinding()") &&
        /export\s*\{[\s\S]*\bnative\b/.test(source);
    });
  if (candidates.length !== 1) {
    throw new Error(`expected one published native runtime entry; received ${candidates.length}: ${candidates.join(", ")}`);
  }
  return candidates[0];
}

export function probeNativeAbi({
  nodeExecutable = process.execPath,
  loadRequest,
  expectedNativePackage,
  admittedAddonSha256,
  lockfileContents = null,
  expectedSurface = null,
}) {
  if (!fs.existsSync(loadRequest)) throw new Error(`native ABI load request is missing: ${loadRequest}`);
  if (!/^[0-9a-f]{64}$/.test(admittedAddonSha256 ?? "")) throw new Error("admitted addon SHA-256 is required");
  const result = spawnSync(nodeExecutable, [
    "-e", PROBE_SOURCE, loadRequest, expectedNativePackage, admittedAddonSha256, lockfileContents === null ? "0" : "1",
  ], {
    input: lockfileContents ?? undefined,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`native ABI probe failed under ${nodeExecutable} (${result.status})\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
  const proof = JSON.parse(result.stdout);
  if (expectedSurface) {
    for (const field of ["exportCount", "exportSetDigest", "behaviorDigest"]) {
      if (proof[field] !== expectedSurface[field]) {
        throw new Error(`Node-major native ABI ${field} mismatch: ${proof[field]} != ${expectedSurface[field]}`);
      }
    }
    if (JSON.stringify(proof.exportNames) !== JSON.stringify(expectedSurface.exportNames)) {
      throw new Error("Node-major native ABI export-name set mismatch");
    }
  }
  return proof;
}

export function abiSurfaceIdentity(proof) {
  return {
    artifactSha256: proof.actualLoadedArtifactSha256,
    exportNames: proof.exportNames,
    exportCount: proof.exportCount,
    exportSetDigest: proof.exportSetDigest,
    behaviorDigest: proof.behaviorDigest,
  };
}

export function assertNodeMajorAbiParity(proofs) {
  const byMajor = new Map(proofs.map((proof) => [proof.nodeMajor, proof]));
  for (const major of [22, 24]) if (!byMajor.has(major)) throw new Error(`native ABI proof is missing Node ${major}`);
  const node22 = byMajor.get(22);
  const node24 = byMajor.get(24);
  for (const field of ["actualLoadedArtifactSha256", "exportCount", "exportSetDigest", "behaviorDigest"]) {
    if (node22[field] !== node24[field]) throw new Error(`Node 22/24 native ABI parity mismatch in ${field}`);
  }
  if (JSON.stringify(node22.exportNames) !== JSON.stringify(node24.exportNames)) {
    throw new Error("Node 22/24 native ABI parity mismatch in export names");
  }
  return {
    status: "VERIFIED",
    artifactSha256: node22.actualLoadedArtifactSha256,
    exportCount: node22.exportCount,
    exportSetDigest: node22.exportSetDigest,
    behaviorDigest: node22.behaviorDigest,
    nodePatches: [node22.nodePatch, node24.nodePatch],
    napiVersions: [node22.napi, node24.napi],
  };
}

export function nativePackageFromArtifactPath(filePath) {
  let cursor = path.dirname(fs.realpathSync(filePath));
  for (let index = 0; index < 12; index += 1) {
    const manifestPath = path.join(cursor, "package.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (typeof manifest.name === "string") return manifest.name;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

export const NATIVE_ABI_PROBE_SOURCE_SHA256 = sha256(PROBE_SOURCE);
