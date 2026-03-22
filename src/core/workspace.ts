import fs from "fs";
import path from "path";
import crypto from "crypto";

export type WorkspaceInfo = {
  projectRoot: string;
  workspaceRoot: string;
  ionifyDir: string;
  workspaceId: string;
  projectId: string;
  projectRelPath: string;
  markers: string[];
  submoduleRoots: string[];
  allowedRoots: string[];
};

const WORKSPACE_MARKERS = [
  "pnpm-workspace.yaml",
  "turbo.json",
  "lerna.json",
  "nx.json",
  "rush.json",
  ".gitmodules",
];

const LOCKFILE_MARKERS = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"];

function realpathOrResolve(absPath: string): string {
  try {
    // native preserves case on macOS and is faster when available.
    const fn = (fs.realpathSync as any).native as ((p: string) => string) | undefined;
    if (fn) return fn(absPath);
    return fs.realpathSync(absPath);
  } catch {
    return path.resolve(absPath);
  }
}

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath: string): boolean {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function hasGitRootMarker(dir: string): boolean {
  const dotGit = path.join(dir, ".git");
  // In worktrees/submodules, `.git` can be a file that points to a gitdir.
  return fileExists(dotGit) || dirExists(dotGit);
}

function hasWorkspacesField(dir: string): boolean {
  const pkgPath = path.join(dir, "package.json");
  if (!fileExists(pkgPath)) return false;
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw);
    const ws = parsed?.workspaces;
    if (Array.isArray(ws) && ws.length > 0) return true;
    if (ws && typeof ws === "object") return true; // e.g. { packages: [...] }
  } catch {
    return false;
  }
  return false;
}

function findUp(startDir: string, predicate: (dir: string) => string[] | null): { dir: string; markers: string[] } | null {
  let current = path.resolve(startDir);
  for (let i = 0; i < 50; i++) {
    const markers = predicate(current);
    if (markers && markers.length) return { dir: current, markers };
    const parent = path.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
}

function findNearestPackageRoot(startDir: string): string | null {
  const found = findUp(startDir, (dir) => (fileExists(path.join(dir, "package.json")) ? ["package.json"] : null));
  return found?.dir ?? null;
}

function detectWorkspaceRoot(projectRoot: string): { dir: string; markers: string[] } {
  // 1) Prefer explicit workspace markers (pnpm/turbo/workspaces/etc.).
  const explicit = findUp(projectRoot, (dir) => {
    const markers: string[] = [];
    for (const name of WORKSPACE_MARKERS) {
      if (fileExists(path.join(dir, name))) markers.push(name);
    }
    if (hasWorkspacesField(dir)) markers.push("package.json#workspaces");
    for (const name of LOCKFILE_MARKERS) {
      if (fileExists(path.join(dir, name))) markers.push(name);
    }
    return markers.length ? markers : null;
  });
  if (explicit) return explicit;

  // 2) Fall back to git root if present.
  const git = findUp(projectRoot, (dir) => (hasGitRootMarker(dir) ? [".git"] : null));
  if (git) return git;

  return { dir: projectRoot, markers: [] };
}

export function readGitSubmoduleRoots(workspaceRoot: string): string[] {
  const gitmodulesPath = path.join(workspaceRoot, ".gitmodules");
  if (!fileExists(gitmodulesPath)) return [];

  let text: string;
  try {
    text = fs.readFileSync(gitmodulesPath, "utf8");
  } catch {
    return [];
  }

  const roots: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    // Minimal parse: `path = something`
    const m = line.match(/^\s*path\s*=\s*(.+)\s*$/);
    if (!m) continue;
    const raw = m[1] ? String(m[1]).trim() : "";
    if (!raw) continue;

    // `.gitmodules` paths are workspace-root relative; enforce that.
    const abs = path.resolve(workspaceRoot, raw);
    const normalizedWs = realpathOrResolve(workspaceRoot);
    const normalizedAbs = realpathOrResolve(abs);
    if (
      normalizedAbs === normalizedWs ||
      normalizedAbs.startsWith(normalizedWs + path.sep)
    ) {
      roots.push(abs);
    }
  }

  // Keep deterministic order.
  return Array.from(new Set(roots.map((p) => realpathOrResolve(p)))).sort();
}

function computeWorkspaceId(workspaceRoot: string): string {
  const hash = crypto.createHash("sha256");
  hash.update("ionify:workspace:v1\n");

  // Hash a small set of workspace identity files. Do not include lockfiles here
  // to keep the ID stable across dependency updates.
  const identityFiles = [
    "package.json",
    "pnpm-workspace.yaml",
    "turbo.json",
    "lerna.json",
    "nx.json",
    "rush.json",
    ".gitmodules",
  ];

  for (const name of identityFiles) {
    const p = path.join(workspaceRoot, name);
    if (!fileExists(p)) continue;
    try {
      hash.update(name);
      hash.update("\0");
      hash.update(fs.readFileSync(p));
      hash.update("\0");
    } catch {
      // Ignore unreadable identity files; workspaceRoot path still scopes storage.
    }
  }

  return hash.digest("hex").slice(0, 12);
}

function computeProjectId(workspaceRoot: string, projectRoot: string): { id: string; rel: string } {
  const rel = path
    .relative(workspaceRoot, projectRoot)
    .split(path.sep)
    .join("/");
  const normalizedRel = rel && rel !== "." ? rel : "root";
  const hash = crypto.createHash("sha256").update(`ionify:project:v1:${normalizedRel}`).digest("hex");
  return { id: hash.slice(0, 10), rel: normalizedRel };
}

function uniqueRoots(roots: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of roots) {
    const normalized = realpathOrResolve(path.resolve(r));
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function resolveWorkspace(startDir: string, opts: { projectRootOverride?: string | null } = {}): WorkspaceInfo {
  const startAbs = realpathOrResolve(path.resolve(startDir));
  const projectRoot = opts.projectRootOverride
    ? realpathOrResolve(path.resolve(opts.projectRootOverride))
    : realpathOrResolve(findNearestPackageRoot(startAbs) ?? startAbs);

  const ws = detectWorkspaceRoot(projectRoot);
  const workspaceRoot = realpathOrResolve(ws.dir);
  const ionifyDir = path.join(workspaceRoot, ".ionify");
  const submoduleRoots = readGitSubmoduleRoots(workspaceRoot);

  const markers = ws.markers;
  const workspaceId = computeWorkspaceId(workspaceRoot);
  const { id: projectId, rel: projectRelPath } = computeProjectId(workspaceRoot, projectRoot);

  // Allowlist is workspace-scoped. Include the projectRoot explicitly in case
  // workspaceRoot resolution differs due to symlinks or override.
  const allowedRoots = uniqueRoots([workspaceRoot, projectRoot, ...submoduleRoots]);

  return {
    projectRoot,
    workspaceRoot,
    ionifyDir,
    workspaceId,
    projectId,
    projectRelPath,
    markers,
    submoduleRoots,
    allowedRoots,
  };
}

