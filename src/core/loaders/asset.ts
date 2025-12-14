/**
{
  "description": "Asset loader for images/fonts/svg. If requested with '?import', returns a JS module exporting the asset URL; else streams the raw file.",
  "phase": 2,
  "todo": [
    "Return JS module for ESM imports (export default 'url')",
    "Serve binary for direct requests",
    "Future: inline small assets as data URI"
  ]
}
*/

import path from "path";
import { publicPathForFile } from "@core/utils/public-path";

export function assetAsModule(urlPath: string): string {
  // For dev server, the URL is the path the browser will fetch
  const safe = urlPath.replace(/"/g, "%22");
  return `export default "${safe}";`;
}

export function isAssetExt(ext: string): boolean {
  return [".png",".jpg",".jpeg",".gif",".svg",".ico",".webp",".avif",
          ".woff",".woff2",".ttf",".otf",".eot"].includes(ext);
}

export function contentTypeForAsset(ext: string): string {
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".svg": return "image/svg+xml";
    case ".ico": return "image/x-icon";
    case ".webp": return "image/webp";
    case ".avif": return "image/avif";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    case ".ttf": return "font/ttf";
    case ".otf": return "font/otf";
    case ".eot": return "application/vnd.ms-fontobject";
    default: return "application/octet-stream";
  }
}

export function normalizeUrlFromFs(rootDir: string, fsPath: string): string {
  return publicPathForFile(rootDir, fsPath);
}
