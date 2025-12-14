import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { expect, test } from "vitest";
import { loadIonifyConfig, resetIonifyConfigCache } from "../src/cli/utils/config";
import { resolveImport, resetResolverAliasCache } from "../src/core/resolver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const portalRoot = path.resolve("/Users/khaledsalem/Projects/UP-Portal-Ionify");
const distRoot = path.resolve(__dirname, "..", "dist");
const externalConfigTest =
  fs.existsSync(portalRoot) && fs.existsSync(distRoot) ? test : test.skip;

externalConfigTest("external project can load ionify config", async () => {
  const stubPkgDir = path.join(portalRoot, "node_modules", "ionify");
  const ensureDir = (dir: string) => fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(stubPkgDir, { recursive: true, force: true });
  ensureDir(stubPkgDir);

  const toPosix = (p: string) => p.split(path.sep).join(path.posix.sep);
  const esmRelativeRaw = toPosix(path.relative(stubPkgDir, path.join(distRoot, "index.js")));
  const esmTarget = esmRelativeRaw.startsWith(".") ? esmRelativeRaw : `./${esmRelativeRaw}`;
  const dtsRelativeRaw = toPosix(path.relative(stubPkgDir, path.join(distRoot, "index.d.ts")));
  const dtsRelative = dtsRelativeRaw.startsWith(".") ? dtsRelativeRaw : `./${dtsRelativeRaw}`;
  const cjsTarget = path.join(distRoot, "index.cjs");

  const stubPackageJson = {
    name: "ionify",
    version: "0.0.0-test",
    type: "module",
    main: "./index.cjs",
    module: "./index.js",
    exports: {
      ".": {
        import: "./index.js",
        require: "./index.cjs",
        types: "./index.d.ts",
      },
    },
  };

  fs.writeFileSync(path.join(stubPkgDir, "package.json"), JSON.stringify(stubPackageJson, null, 2));
  fs.writeFileSync(
    path.join(stubPkgDir, "index.js"),
    `export * from ${JSON.stringify(esmTarget)};\nexport { defineConfig } from ${JSON.stringify(esmTarget)};\n`
  );
  fs.writeFileSync(
    path.join(stubPkgDir, "index.cjs"),
    `module.exports = require(${JSON.stringify(cjsTarget)});\n`
  );
  fs.writeFileSync(
    path.join(stubPkgDir, "index.d.ts"),
    `export * from ${JSON.stringify(dtsRelative)};\nexport { defineConfig } from ${JSON.stringify(dtsRelative)};\n`
  );

  resetIonifyConfigCache();
  resetResolverAliasCache();

  try {
    const config = await loadIonifyConfig(portalRoot);
    expect(config).toBeTruthy();
    expect(config?.resolve?.alias?.["@@"]).toBe(path.resolve(portalRoot, "."));
    expect(config?.resolve?.alias?.["@"]).toBe(path.resolve(portalRoot, "src"));

    const defaultEntry = path.join(portalRoot, "src/main.ts");
    const expectedMain = fs.existsSync(defaultEntry)
      ? defaultEntry
      : path.join(portalRoot, "src/main.tsx");
    const resolved = resolveImport("@@/src/main", expectedMain);
    expect(resolved).toBe(expectedMain);
  } finally {
    resetIonifyConfigCache();
    resetResolverAliasCache();
    fs.rmSync(stubPkgDir, { recursive: true, force: true });
  }
});
