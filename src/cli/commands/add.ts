import fs from "fs";
import path from "path";
import { logError, logInfo } from "@cli/utils/logger";
import { IONIFY_COMPONENTS } from "@cli/components/registry";

export type AddComponentOptions = {
  list?: boolean;
  dir?: string;
  force?: boolean;
};

function findProjectRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 15; i++) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg) && fs.statSync(pkg).isFile()) return dir;
    const parent = path.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}

function isTypeScriptProject(projectRoot: string): boolean {
  // Prefer tsconfig presence.
  const tsconfig = path.join(projectRoot, "tsconfig.json");
  if (fs.existsSync(tsconfig) && fs.statSync(tsconfig).isFile()) return true;

  // Fallback: inspect package.json.
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    return typeof deps.typescript === "string";
  } catch {
    return false;
  }
}

export async function runAddCommand(componentName: string | undefined, options: AddComponentOptions = {}) {
  const { list, force } = options;
  const templates = IONIFY_COMPONENTS;

  if (list || !componentName) {
    const names = Object.keys(templates).sort();
    logInfo(`Available components (${names.length}):`);
    for (const name of names) {
      const t = templates[name]!;
      // Keep output simple and grep-friendly.
      console.log(`- ${t.name}: ${t.description}`);
    }
    if (!componentName) return;
  }

  const normalized = String(componentName ?? "").trim().toLowerCase();
  const template = templates[normalized];
  if (!template) {
    logError(`Unknown component '${componentName}'. Use 'ionify add --list' to see available components.`);
    process.exitCode = 1;
    return;
  }

  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) {
    logError("Could not find project root (package.json). Run this inside a project directory.");
    process.exitCode = 1;
    return;
  }

  const ts = isTypeScriptProject(projectRoot);
  const targetDir = path.resolve(projectRoot, options.dir ?? "src/components/ui");
  const ext = ts ? "tsx" : "jsx";
  const outFile = path.join(targetDir, `${template.fileBase}.${ext}`);

  fs.mkdirSync(targetDir, { recursive: true });
  if (fs.existsSync(outFile) && !force) {
    logError(`File already exists: ${outFile} (use --force to overwrite)`);
    process.exitCode = 1;
    return;
  }

  const code = ts ? template.tsx : template.jsx;
  fs.writeFileSync(outFile, code, "utf8");
  logInfo(`Added ${template.name} → ${path.relative(projectRoot, outFile)}`);
}

