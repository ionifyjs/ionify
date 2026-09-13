import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const expectedVersion = arg("--version", packageJson.version);
const registry = String(arg("--registry", "https://registry.npmjs.org")).replace(/\/+$/, "");
const outputPath = path.resolve(arg("--output", `release-smoke-evidence-${expectedVersion}.json`));
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ionify-registry-smoke-${expectedVersion}-`));

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stdout ?? ""}\n${result.stderr ?? ""}` : "";
    throw new Error(`${command} ${commandArgs.join(" ")} failed (${result.status})${details}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function registryMetadata(name, version = "latest") {
  const response = await fetch(`${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${name}@${version} registry metadata returned ${response.status}`);
  return response.json();
}

function caseEnvironment(caseRoot) {
  const cacheRoot = path.join(caseRoot, "manager-cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  return {
    ...process.env,
    CI: "1",
    NO_COLOR: "1",
    npm_config_cache: path.join(cacheRoot, "npm"),
    npm_config_registry: registry,
    pnpm_config_store_dir: path.join(cacheRoot, "pnpm-store"),
    YARN_CACHE_FOLDER: path.join(cacheRoot, "yarn"),
  };
}

function generatedTreeHash(appRoot) {
  const ignored = new Set(["node_modules", ".git", ".ionify", "dist"]);
  const records = [];
  const walk = (root, relative = "") => {
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name) || /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(entry.name)) continue;
      const childRelative = path.join(relative, entry.name);
      const absolute = path.join(root, entry.name);
      if (entry.isDirectory()) walk(absolute, childRelative);
      else {
        let bytes = fs.readFileSync(absolute);
        if (childRelative === "package.json") {
          const value = JSON.parse(bytes.toString("utf8"));
          value.name = "<project>";
          value.packageManager = "<package-manager>";
          bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
        } else {
          bytes = Buffer.from(bytes.toString("utf8").replaceAll(path.basename(appRoot), "<project>"));
        }
        records.push(`${childRelative.replaceAll(path.sep, "/")}:${sha256(bytes)}`);
      }
    }
  };
  walk(appRoot);
  return { hash: sha256(records.join("\n")), records };
}

function lockfileEvidence(appRoot, manager) {
  if (manager === "npm") {
    const lock = JSON.parse(fs.readFileSync(path.join(appRoot, "package-lock.json"), "utf8"));
    const item = lock.packages?.["node_modules/@ionify/ionify"];
    return { file: "package-lock.json", version: item?.version, resolved: item?.resolved, integrity: item?.integrity };
  }
  if (manager === "pnpm") {
    const text = fs.readFileSync(path.join(appRoot, "pnpm-lock.yaml"), "utf8");
    const section = text.match(/['"]?@ionify\/ionify@[^\n]+[\s\S]{0,800}?resolution:[^\n]+/);
    return { file: "pnpm-lock.yaml", excerpt: section?.[0] ?? null, sha256: sha256(text) };
  }
  const text = fs.readFileSync(path.join(appRoot, "yarn.lock"), "utf8");
  const section = text.match(/"?@ionify\/ionify@[^\n]+[\s\S]{0,800}?(?=\n\S|$)/);
  return { file: "yarn.lock", excerpt: section?.[0] ?? null, sha256: sha256(text) };
}

function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else child.kill("SIGTERM");
}

async function waitForUrl(url, attempts = 120) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError ?? new Error(`timed out waiting for ${url}`);
}

async function inspectDevTransport(baseUrl) {
  const html = await (await waitForUrl(`${baseUrl}/`)).text();
  const sourceUrls = Array.from(html.matchAll(/(?:src|href)="(\/[^"?#]+\.(?:js|jsx|ts|tsx)(?:\?[^"#]*)?)"/g), (match) => match[1]);
  const queue = [...sourceUrls, "/src/main.tsx", "/src/main.ts"];
  const visited = new Set();
  const depUrls = new Set();
  while (queue.length > 0 && visited.size < 30) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    const response = await fetch(`${baseUrl}${url}`);
    if (!response.ok) continue;
    const source = await response.text();
    for (const match of source.matchAll(/["'](\/@deps\/[^"']+\.js(?:\?[^"']*)?)["']/g)) depUrls.add(match[1]);
    for (const match of source.matchAll(/["'](\/src\/[^"']+\.(?:js|jsx|ts|tsx)(?:\?[^"']*)?)["']/g)) queue.push(match[1]);
  }
  const violations = [];
  if (depUrls.size === 0) violations.push("dev transport exposed no dependency URLs");
  const inspected = [];
  for (const depUrl of Array.from(depUrls).slice(0, 12)) {
    const parsed = new URL(depUrl, baseUrl);
    const generation = parsed.searchParams.get("v");
    if (!generation) violations.push(`dependency URL is not generation-bound: ${depUrl}`);
    const response = await fetch(parsed);
    if (!response.ok) throw new Error(`${depUrl} returned ${response.status}`);
    const cacheControl = response.headers.get("cache-control");
    if (cacheControl !== "no-cache") violations.push(`${depUrl} cache-control is ${cacheControl}`);
    const source = await response.text();
    const transitiveUrls = Array.from(source.matchAll(/["'](\/@deps\/[^"']+\.js(?:\?[^"']*)?)["']/g), (match) => match[1]);
    for (const transitiveUrl of transitiveUrls) {
      const transitiveGeneration = new URL(transitiveUrl, baseUrl).searchParams.get("v");
      if (generation && transitiveGeneration !== generation) {
        violations.push(`${depUrl} crosses dependency generations through ${transitiveUrl}`);
      }
    }
    inspected.push({ url: depUrl, logicalUrl: parsed.pathname, generation, cacheControl, transitiveUrls });
  }
  return { inspected, violations };
}

const initializers = [
  { label: "npm-create", manager: "npm", command: "npm", prefix: ["create", "ionify", "--"] },
  { label: "npm-create-latest", manager: "npm", command: "npm", prefix: ["create", "ionify@latest", "--"] },
  { label: "npx-latest", manager: "npm", command: "npx", prefix: ["--yes", "create-ionify@latest"] },
  { label: "pnpm-create", manager: "pnpm", command: "pnpm", prefix: ["create", "ionify"] },
  { label: "pnpm-dlx-latest", manager: "pnpm", command: "pnpm", prefix: ["dlx", "create-ionify@latest"] },
  { label: "yarn-classic-create", manager: "yarn", command: "yarn", prefix: ["create", "ionify"] },
];

const createMetadata = await registryMetadata("create-ionify", "latest");
const engineMetadata = await registryMetadata("@ionify/ionify", expectedVersion);
const results = [];
try {
  for (let index = 0; index < initializers.length; index += 1) {
    const initializer = initializers[index];
    const caseRoot = path.join(workRoot, initializer.label);
    const appName = `${initializer.label}-app`;
    const appRoot = path.join(caseRoot, appName);
    fs.mkdirSync(caseRoot, { recursive: true });
    const env = caseEnvironment(caseRoot);
    const initializerOutput = run(
      initializer.command,
      [...initializer.prefix, appName, "--yes", "--pm", initializer.manager, "--skip-install", "--skip-git"],
      { cwd: caseRoot, env, capture: true },
    );
    const generatedPackage = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
    const generatedEngineRange =
      generatedPackage.dependencies?.["@ionify/ionify"] ??
      generatedPackage.devDependencies?.["@ionify/ionify"];
    if (generatedEngineRange !== "latest") {
      throw new Error(`${initializer.label} did not generate @ionify/ionify: latest`);
    }
    const generatedTree = generatedTreeHash(appRoot);
    const installArgs = initializer.manager === "yarn"
      ? ["install", "--non-interactive", "--registry", registry]
      : ["install", "--registry", registry];
    run(initializer.manager, installArgs, { cwd: appRoot, env, capture: true });

    const installedPackagePath = path.join(appRoot, "node_modules", "@ionify", "ionify", "package.json");
    const installedPackage = JSON.parse(fs.readFileSync(installedPackagePath, "utf8"));
    if (installedPackage.version !== expectedVersion) {
      throw new Error(`${initializer.label} resolved engine ${installedPackage.version}, expected ${expectedVersion}`);
    }
    const requireFromApp = createRequire(path.join(appRoot, "package.json"));
    const mainEntry = requireFromApp.resolve("@ionify/ionify");
    const requireFromMain = createRequire(mainEntry);
    const installedNative = Object.keys(installedPackage.optionalDependencies ?? {}).filter((name) => {
      try { requireFromMain.resolve(name); return true; } catch { return false; }
    });
    if (installedNative.length !== 1) throw new Error(`${initializer.label} selected natives: ${installedNative.join(", ")}`);
    const nativePackage = requireFromMain(`${installedNative[0]}/package.json`);
    const nativeMetadata = await registryMetadata(installedNative[0], expectedVersion);
    const binding = requireFromMain(installedNative[0]);
    if (typeof binding.depsStoreHash !== "function") throw new Error(`${initializer.label} native import is incomplete`);
    const lockfileName = initializer.manager === "npm"
      ? "package-lock.json"
      : initializer.manager === "pnpm"
        ? "pnpm-lock.yaml"
        : "yarn.lock";
    const depsStoreHash = binding.depsStoreHash(
      "release-smoke",
      fs.readFileSync(path.join(appRoot, lockfileName)),
      "production",
      false,
      true,
      "auto",
      1,
    );
    const cliPath = path.join(appRoot, "node_modules", "@ionify", "ionify", "dist", "cli", "index.js");
    const cliVersion = run(process.execPath, [cliPath, "--version"], { cwd: appRoot, env, capture: true }).trim();
    if (cliVersion !== expectedVersion) throw new Error(`${initializer.label} CLI version is ${cliVersion}`);

    run(process.execPath, [cliPath, "build"], { cwd: appRoot, env, capture: true });
    if (!fs.existsSync(path.join(appRoot, "dist", "index.html"))) throw new Error(`${initializer.label} first build failed`);
    fs.rmSync(path.join(appRoot, ".ionify"), { recursive: true, force: true });
    fs.rmSync(path.join(appRoot, "dist"), { recursive: true, force: true });

    const port = 53100 + index;
    const logPath = path.join(caseRoot, "first-dev.log");
    const logFd = fs.openSync(logPath, "w");
    const child = spawn(process.execPath, [cliPath, "dev", "--port", String(port)], {
      cwd: appRoot,
      env,
      stdio: ["ignore", logFd, logFd],
    });
    let devTransportResult;
    try {
      devTransportResult = await inspectDevTransport(`http://127.0.0.1:${port}`);
    } finally {
      stopProcess(child);
      fs.closeSync(logFd);
    }
    results.push({
      initializer: initializer.label,
      initializerCommand: [initializer.command, ...initializer.prefix],
      manager: initializer.manager,
      createVersion: createMetadata.version,
      initializerOutputSha256: sha256(initializerOutput),
      generatedPackage,
      generatedTreeHash: generatedTree.hash,
      generatedTreeRecords: generatedTree.records,
      lockfile: lockfileEvidence(appRoot, initializer.manager),
      engine: {
        version: installedPackage.version,
        registryTarball: engineMetadata.dist?.tarball,
        registryIntegrity: engineMetadata.dist?.integrity,
      },
      native: {
        name: installedNative[0],
        version: nativePackage.version,
        registryTarball: nativeMetadata.dist?.tarball,
        registryIntegrity: nativeMetadata.dist?.integrity,
        import: "green",
      },
      depsStoreHash,
      cliVersion,
      firstBuild: "green",
      firstDev: "green",
      devTransport: devTransportResult.inspected,
      devTransportViolations: devTransportResult.violations,
    });
  }

  const generatedHashes = new Set(results.map((result) => result.generatedTreeHash));
  const npmTransport = results.find((result) => result.manager === "npm")?.devTransport ?? [];
  const pnpmTransport = results.find((result) => result.manager === "pnpm")?.devTransport ?? [];
  const npmByLogical = new Map(npmTransport.map((item) => [item.logicalUrl, item]));
  const common = pnpmTransport.find((item) => npmByLogical.has(item.logicalUrl));
  if (!common) throw new Error("npm and pnpm dev transports exposed no comparable dependency wrapper");
  const violations = results.flatMap((result) =>
    result.devTransportViolations.map((violation) => `${result.initializer}: ${violation}`),
  );
  if (generatedHashes.size !== 1) {
    violations.push("initializer forms generated different normalized project bytes");
  }
  if (npmByLogical.get(common.logicalUrl).url === common.url) {
    violations.push(`npm and pnpm reused one browser dependency URL for ${common.logicalUrl}`);
  }

  const evidence = {
    kind: "ionify.real-registry-package-manager-smoke",
    schemaVersion: 1,
    status: violations.length === 0 ? "GREEN" : "RED",
    registry,
    expectedVersion,
    createContract: {
      name: createMetadata.name,
      version: createMetadata.version,
      tarball: createMetadata.dist?.tarball,
      integrity: createMetadata.dist?.integrity,
    },
    normalizedGenerationHash: results[0].generatedTreeHash,
    cacheIsolationProof: {
      logicalUrl: common.logicalUrl,
      npmUrl: npmByLogical.get(common.logicalUrl).url,
      pnpmUrl: common.url,
    },
    results,
    violations,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  if (violations.length > 0) {
    throw new Error(`real-registry smoke found ${violations.length} release-contract violation(s); evidence: ${outputPath}`);
  }
  console.log(`[release-smoke] GREEN ${expectedVersion}: ${outputPath}`);
} finally {
  fs.rmSync(workRoot, { recursive: true, force: true });
}
