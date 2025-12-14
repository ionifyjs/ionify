import "tsconfig-paths/register";
import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { loadIonifyConfig, resetIonifyConfigCache } from "../src/cli/utils/config";
import { resolveImport, resetResolverAliasCache } from "../src/core/resolver";

test("config loader resolves aliases and settings", async () => {
  const prevCwd = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-config-test-"));
  const projectDir = path.join(tempRoot, "workspace");
  const srcDir = path.join(projectDir, "src");
  const localesDir = path.join(srcDir, "Locales");
  const libDir = path.join(srcDir, "lib", "utils");

  resetIonifyConfigCache();
  resetResolverAliasCache();

  fs.mkdirSync(localesDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });

  const localesFile = path.join(localesDir, "index.ts");
  fs.writeFileSync(localesFile, "export const locale = 'en';\n", "utf8");

  const utilFile = path.join(libDir, "math.ts");
  fs.writeFileSync(utilFile, "export const sq = (x: number) => x * x;\n", "utf8");

  const entryFile = path.join(srcDir, "entry.ts");
  fs.writeFileSync(entryFile, "export const entry = true;\n", "utf8");

  const configPath = path.join(projectDir, "ionify.config.ts");
  const configSource = `
    import path from "path";

    export default {
      resolve: {
        alias: {
          "@@": path.resolve(__dirname),
          "@": path.resolve(__dirname, "src"),
          "@lib/*": path.resolve(__dirname, "src/lib/*")
        },
      },
      server: {
        port: 4545,
        host: "127.0.0.1",
      },
      plugins: [
        { name: "example-plugin" }
      ],
    };
  `;
  fs.writeFileSync(configPath, configSource, "utf8");

  process.chdir(projectDir);

  try {
    const config = await loadIonifyConfig(projectDir);

    expect(config).toBeTruthy();
    expect(config?.server?.port).toBe(4545);
    expect(config?.server?.host).toBe("127.0.0.1");
    expect(config?.plugins?.[0]?.name).toBe("example-plugin");
    expect(config?.resolve?.alias).toBeTruthy();

    const aliasRoot = resolveImport("@@/src/Locales/index", entryFile);
    expect(aliasRoot).toBe(localesFile);

    const aliasAt = resolveImport("@/Locales/index", entryFile);
    expect(aliasAt).toBe(localesFile);

    const wildcard = resolveImport("@lib/utils/math", entryFile);
    expect(wildcard).toBe(utilFile);
  } finally {
    process.chdir(prevCwd);
    resetIonifyConfigCache();
    resetResolverAliasCache();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
