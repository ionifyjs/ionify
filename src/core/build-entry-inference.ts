import fs from "fs";
import path from "path";

export function resolveConfiguredBuildEntries(config: any, rootDir: string): string[] | undefined {
  const configured = config?.entry
    ? (Array.isArray(config.entry) ? config.entry : [config.entry])
        .map((entry: string) => (entry.startsWith("/") ? path.join(rootDir, entry) : path.resolve(rootDir, entry)))
        .filter((entry: string) => typeof entry === "string" && entry.length > 0)
    : [];
  return configured.length > 0 ? configured : undefined;
}

export function resolveHtmlModuleEntryPath(htmlInput: string, rootDir: string, src: string): string | null {
  const trimmed = typeof src === "string" ? src.trim() : "";
  if (!trimmed) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(trimmed)) return null;
  if (trimmed.startsWith("data:") || trimmed.startsWith("javascript:") || trimmed.startsWith("#")) return null;

  const withoutQuery = trimmed.split("#", 1)[0]?.split("?", 1)[0]?.trim() ?? "";
  if (!withoutQuery) return null;

  if (withoutQuery.startsWith("/")) {
    return path.join(rootDir, withoutQuery.replace(/^[/\\]+/, ""));
  }

  return path.resolve(path.dirname(htmlInput), withoutQuery);
}

export function inferBuildEntriesFromHtml(
  rootDir: string,
  onWarn?: (message: string) => void,
): string[] {
  const htmlInput = path.join(rootDir, "index.html");
  if (!fs.existsSync(htmlInput)) return [];

  let html = "";
  try {
    html = fs.readFileSync(htmlInput, "utf8");
  } catch {
    return [];
  }

  const moduleScriptRe =
    /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  const entries: string[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(moduleScriptRe)) {
    const src = typeof match[1] === "string" ? match[1] : "";
    const resolved = resolveHtmlModuleEntryPath(htmlInput, rootDir, src);
    if (!resolved) continue;
    if (!fs.existsSync(resolved)) {
      onWarn?.(`[Build] Skipping inferred entry "${src}" from index.html because the file does not exist`);
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    entries.push(resolved);
  }

  return entries;
}

export function resolveProductionBuildEntries(
  config: any,
  rootDir: string,
  onWarn?: (message: string) => void,
): { entries: string[] | undefined; source: "config" | "html" | "graph" } {
  const configured = resolveConfiguredBuildEntries(config, rootDir);
  if (configured?.length) return { entries: configured, source: "config" };

  const inferred = inferBuildEntriesFromHtml(rootDir, onWarn);
  if (inferred.length > 0) return { entries: inferred, source: "html" };

  return { entries: undefined, source: "graph" };
}
