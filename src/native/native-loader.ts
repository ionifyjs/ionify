import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

export const NATIVE_PACKAGE_BY_TARGET = Object.freeze({
  "darwin-arm64": "@ionify/ionify-darwin-arm64",
  "darwin-x64": "@ionify/ionify-darwin-x64",
  "win32-arm64-msvc": "@ionify/ionify-win32-arm64-msvc",
  "win32-x64-msvc": "@ionify/ionify-win32-x64-msvc",
  "linux-arm64-gnu": "@ionify/ionify-linux-arm64-gnu",
  "linux-x64-gnu": "@ionify/ionify-linux-x64-gnu",
  "linux-arm64-musl": "@ionify/ionify-linux-arm64-musl",
  "linux-x64-musl": "@ionify/ionify-linux-x64-musl",
} as const);

export type SupportedNativeTarget = keyof typeof NATIVE_PACKAGE_BY_TARGET;
export type NativeLibc = "gnu" | "musl";

type RequireFunction = (id: string) => unknown;

export type NativeLoadOptions = {
  platform?: NodeJS.Platform | string;
  arch?: string;
  libc?: NativeLibc;
  requireFn?: RequireFunction;
  moduleUrl?: string;
  privateCheckoutBindingPath?: string | null;
};

export function detectLinuxLibc(
  getReport: (() => unknown) | undefined = process.report?.getReport,
): NativeLibc {
  const report = typeof getReport === "function" ? getReport() : undefined;
  const header = report && typeof report === "object" && "header" in report
    ? (report as { header?: unknown }).header
    : undefined;
  const glibcVersionRuntime = header && typeof header === "object" && "glibcVersionRuntime" in header
    ? (header as { glibcVersionRuntime?: unknown }).glibcVersionRuntime
    : undefined;
  return typeof glibcVersionRuntime === "string" && glibcVersionRuntime.length > 0
    ? "gnu"
    : "musl";
}

function targetKey(platform: string, arch: string, libc?: NativeLibc): string {
  if (platform === "linux") {
    return `${platform}-${arch}-${libc ?? detectLinuxLibc()}`;
  }
  if (platform === "win32") return `${platform}-${arch}-msvc`;
  return `${platform}-${arch}`;
}

function describeOriginalError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : undefined;
}

function makeError(message: string, code: string, cause?: unknown): Error {
  const error = new Error(message) as Error & { code?: string; cause?: unknown };
  error.name = "IonifyNativeBindingError";
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

export function selectNativePackage(
  platform: string,
  arch: string,
  libc?: NativeLibc,
): string {
  const key = targetKey(platform, arch, libc);
  const selected = NATIVE_PACKAGE_BY_TARGET[key as SupportedNativeTarget];
  if (selected) return selected;

  throw makeError(
    [
      `[Ionify] Unsupported native platform: ${key}.`,
      `Supported platforms: ${Object.keys(NATIVE_PACKAGE_BY_TARGET).join(", ")}.`,
      "Ionify did not attempt to load a binary for another platform.",
    ].join("\n"),
    "IONIFY_UNSUPPORTED_NATIVE_PLATFORM",
  );
}

function findPackageRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const packagePath = path.join(dir, "package.json");
    try {
      if (fs.statSync(packagePath).isFile()) return dir;
    } catch {
      // Keep walking toward the filesystem root.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function privateCheckoutBinding(moduleUrl: string): string | null {
  const packageRoot = findPackageRoot(path.dirname(fileURLToPath(moduleUrl)));
  if (!packageRoot) return null;

  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as { name?: unknown; private?: unknown };
    if (packageJson.name !== "ionify" || packageJson.private !== true) return null;
  } catch {
    return null;
  }

  const candidate = path.join(packageRoot, "native", "ionify_core.node");
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function selectedPackageIsMissing(error: unknown, packageName: string): boolean {
  return errorCode(error) === "MODULE_NOT_FOUND"
    && describeOriginalError(error).includes(packageName);
}

function loadFailure(
  platform: string,
  arch: string,
  libc: NativeLibc | undefined,
  packageName: string,
  error: unknown,
): Error {
  const key = targetKey(platform, arch, libc);
  const missing = selectedPackageIsMissing(error, packageName);
  const guidance = missing
    ? [
      "The platform package was not installed. Optional dependencies may have been omitted or the install may be incomplete.",
      "Reinstall the main package without --omit=optional / --no-optional:",
      "  npm install @ionify/ionify",
      "  pnpm add @ionify/ionify",
    ]
    : [
      "The selected package exists, but Node could not load its native addon.",
      "Check that the package was not copied from a different OS/CPU and that the downloaded binary is intact.",
    ];

  return makeError(
    [
      `[Ionify] Failed to load the native binding for ${key}.`,
      `Selected package: ${packageName}`,
      ...guidance,
      `Original Node error: ${describeOriginalError(error)}`,
    ].join("\n"),
    missing ? "IONIFY_NATIVE_PACKAGE_MISSING" : "IONIFY_NATIVE_DLOPEN_FAILED",
    error,
  );
}

export function loadNativeBinding<T>(options: NativeLoadOptions = {}): T {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const libc = platform === "linux" ? options.libc ?? detectLinuxLibc() : undefined;
  const packageName = selectNativePackage(platform, arch, libc);
  const requireFn = options.requireFn ?? createRequire(options.moduleUrl ?? import.meta.url);

  try {
    return requireFn(packageName) as T;
  } catch (selectedError) {
    const checkoutPath = options.privateCheckoutBindingPath === undefined
      ? privateCheckoutBinding(options.moduleUrl ?? import.meta.url)
      : options.privateCheckoutBindingPath;

    // The source repository is private and never published. Its local native/
    // artifact is a development-only fallback, and only a genuinely absent
    // platform package may reach it. Real require/dlopen errors are never hidden.
    if (checkoutPath && selectedPackageIsMissing(selectedError, packageName)) {
      try {
        return requireFn(checkoutPath) as T;
      } catch (checkoutError) {
        throw loadFailure(platform, arch, libc, checkoutPath, checkoutError);
      }
    }

    throw loadFailure(platform, arch, libc, packageName, selectedError);
  }
}
