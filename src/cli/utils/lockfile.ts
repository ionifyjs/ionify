import fs from "fs";
import path from "path";

export type LockfileInfo = {
  name: string;
  path: string;
  contents: Buffer;
  packageCount: number | null;
};

const LOCKFILE_ORDER = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
];

export function readLockfile(workspaceRoot: string, projectRoot: string): LockfileInfo | null {
  const roots = [workspaceRoot, projectRoot].filter(Boolean);
  const uniqueRoots: string[] = [];
  for (const r of roots) {
    const abs = path.resolve(r);
    if (!uniqueRoots.includes(abs)) uniqueRoots.push(abs);
  }

  for (const root of uniqueRoots) {
    for (const name of LOCKFILE_ORDER) {
      const filePath = path.join(root, name);
      if (!fs.existsSync(filePath)) continue;
      const contents = fs.readFileSync(filePath);
      return { name, path: filePath, contents, packageCount: estimateLockfilePackageCount(name, contents) };
    }
  }
  return null;
}

export function estimateLockfilePackageCount(name: string, contents: Buffer): number | null {
  if (name === "package-lock.json") {
    try {
      const parsed = JSON.parse(contents.toString("utf8"));
      if (parsed?.packages && typeof parsed.packages === "object") {
        return Object.keys(parsed.packages).length;
      }
    } catch {
      return null;
    }
  }

  if (name === "pnpm-lock.yaml") {
    const text = contents.toString("utf8");
    const lines = text.split(/\r?\n/);
    const legacyCount = lines.filter((line) => line.trimStart().startsWith("/")).length;
    if (legacyCount > 0) return legacyCount;

    const packageSectionIndex = lines.findIndex((line) => line.trim() === "packages:");
    if (packageSectionIndex < 0) return null;
    let count = 0;
    for (let i = packageSectionIndex + 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (/^\S/.test(line)) break;
      if (/^\s{2}[^#\s].*:\s*$/.test(line)) count++;
    }
    return count;
  }

  if (name === "yarn.lock") {
    const text = contents.toString("utf8");
    return text.split("\n").filter((line) => line && !line.startsWith(" ") && line.endsWith(":")).length;
  }

  return null;
}
