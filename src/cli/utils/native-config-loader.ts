import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { tryNativeTransform } from "@native/index";

const require = createRequire(import.meta.url);

export async function importNativeConfigModule(configPath: string): Promise<unknown> {
  const ext = path.extname(configPath).toLowerCase();
  let importUrl: string;
  let tmpFile: string | null = null;
  let helperFile: string | null = null;
  const tempPrefix = `.ionify-config.${process.pid}.${Date.now()}`;

  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    const source = fs.readFileSync(configPath, "utf8");
    const helper = ionifyConfigHelperImportPath(source, tempPrefix);
    if (helper) {
      helperFile = path.join(path.dirname(configPath), helper.fileName);
      tmpFile = path.join(path.dirname(configPath), `${tempPrefix}.mjs`);
      fs.writeFileSync(helperFile, configHelperModuleSource(), "utf8");
      fs.writeFileSync(tmpFile, rewriteIonifyConfigHelperImports(source, `./${helper.fileName}`), "utf8");
      importUrl = pathToFileURL(tmpFile).href;
    } else {
      importUrl = pathToFileURL(configPath).href;
    }
  } else {
    const source = fs.readFileSync(configPath, "utf8");
    const helper = ionifyConfigHelperImportPath(source, tempPrefix);
    const rewrittenSource = helper
      ? rewriteIonifyConfigHelperImports(source, `./${helper.fileName}`)
      : source;
    const code = transpileConfigToEsm(rewrittenSource, configPath);
    tmpFile = path.join(path.dirname(configPath), `${tempPrefix}.mjs`);
    if (helper) {
      helperFile = path.join(path.dirname(configPath), helper.fileName);
      fs.writeFileSync(helperFile, configHelperModuleSource(), "utf8");
    }
    fs.writeFileSync(tmpFile, code, "utf8");
    importUrl = pathToFileURL(tmpFile).href;
  }

  try {
    return await import(importUrl);
  } finally {
    if (tmpFile) {
      try {
        fs.rmSync(tmpFile, { force: true });
      } catch {
        // best effort cleanup
      }
    }
    if (helperFile) {
      try {
        fs.rmSync(helperFile, { force: true });
      } catch {
        // best effort cleanup
      }
    }
  }
}

function ionifyConfigHelperImportPath(
  source: string,
  tempPrefix: string,
): { fileName: string } | null {
  return /\bfrom\s*["'](?:ionify|@ionify\/ionify)["']/.test(source)
    ? { fileName: `${tempPrefix}.helper.mjs` }
    : null;
}

function rewriteIonifyConfigHelperImports(source: string, helperSpecifier: string): string {
  return source.replace(
    /(\bfrom\s*["'])(?:ionify|@ionify\/ionify)(["'])/g,
    `$1${helperSpecifier}$2`,
  );
}

function configHelperModuleSource(): string {
  return "export function defineConfig(config) { return config; }\n";
}

export function transpileConfigToEsm(source: string, filename: string): string {
  let code: string | null = null;

  const native = tryNativeTransform("swc", source, { filename, typescript: true, jsx: false });
  if (native?.code) {
    code = native.code;
  } else {
    try {
      const swc = require("@swc/core") as typeof import("@swc/core");
      code = swc.transformSync(source, {
        filename,
        jsc: { parser: { syntax: "typescript", tsx: false }, target: "es2022" },
        module: { type: "es6" },
        sourceMaps: false,
      }).code;
    } catch (err) {
      throw new Error(`native transform unavailable and @swc/core fallback failed: ${String(err)}`);
    }
  }

  const usesDirname = /\b__dirname\b/.test(source) || /\b__filename\b/.test(source);
  const declaresDirname = /\b(?:const|let|var)\s+__(?:dir|file)name\b/.test(source);
  if (usesDirname && !declaresDirname) {
    const shim =
      `import { fileURLToPath as __ionifyFileURLToPath } from "url";\n` +
      `import { dirname as __ionifyDirname } from "path";\n` +
      `const __filename = __ionifyFileURLToPath(import.meta.url);\n` +
      `const __dirname = __ionifyDirname(__filename);\n`;
    code = shim + code;
  }

  return code;
}
