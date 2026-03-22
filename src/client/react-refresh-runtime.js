import RefreshRuntime from "react-refresh/runtime";

let installed = false;
const moduleInfo = new Map();
const warnedClassModules = new Set();

function warnAboutClassRefresh(stableModuleId) {
  if (warnedClassModules.has(stableModuleId)) return;
  const warning = `[Ionify] React Fast Refresh cannot preserve state for class components (module: ${stableModuleId}). State will reset after edits.`;
  console.warn(warning);

  if (typeof document !== "undefined") {
    import("/__ionify_overlay.js")
      .then((mod) => {
        if (typeof mod?.showWarningOverlay === "function") {
          mod.showWarningOverlay(warning, stableModuleId);
        }
      })
      .catch(() => {});
  }

  warnedClassModules.add(stableModuleId);
}

export function normalizeRefreshModuleId(url) {
  if (typeof url !== "string") return "";
  if (!url.includes("?") && !url.includes("#")) return url;

  // Absolute URL: keep origin + pathname + hash, drop search.
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname + parsed.hash;
  } catch {
    // Fall through for non-absolute URLs.
  }

  // Relative URL: keep pathname + hash, drop search.
  try {
    const parsed = new URL(url, "http://ionify.invalid");
    return parsed.pathname + parsed.hash;
  } catch {
    // Final fallback: conservative string manipulation.
  }

  const [beforeHash, hash = ""] = url.split("#", 2);
  const [pathPart] = beforeHash.split("?", 2);
  return pathPart + (hash ? `#${hash}` : "");
}

function ensureRuntime() {
  if (installed) return RefreshRuntime;
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => (type) => type;
  window.__IONIFY_REACT_REFRESH__ = RefreshRuntime;
  installed = true;
  return RefreshRuntime;
}

// Ensure the global hook is installed as early as possible (before React modules execute).
// Guarded so Node-side unit tests can import helpers from this file.
if (typeof window !== "undefined") {
  try {
    ensureRuntime();
  } catch {
    // Runtime injection is best-effort; transform-side warnings handle failures.
  }
}

export function setupReactRefresh(importMetaHot, moduleId) {
  if (!importMetaHot) return null;
  const runtime = ensureRuntime();
  const stableModuleId = normalizeRefreshModuleId(moduleId);

  // Track metadata for this module so we can make refresh decisions later.
  const record = {
    hasReactExport: false,
    hasClassComponent: false,
  };
  moduleInfo.set(stableModuleId, record);

  const prevReg = window.$RefreshReg$;
  const prevSig = window.$RefreshSig$;

  window.$RefreshReg$ = (type, id) => {
    runtime.register(type, stableModuleId + " " + id);
    if (type) {
      record.hasReactExport = true;
      if (type.prototype && type.prototype.isReactComponent) {
        record.hasClassComponent = true;
      }
    }
  };
  window.$RefreshSig$ = runtime.createSignatureFunctionForTransform;

  const finalize = () => {
    window.$RefreshReg$ = prevReg;
    window.$RefreshSig$ = prevSig;
  };

  const dispose = () => {
    moduleInfo.delete(stableModuleId);
  };

  const refresh = () => {
    if (!record.hasReactExport) return false;
    if (record.hasClassComponent) {
      warnAboutClassRefresh(stableModuleId);
    }
    queueMicrotask(() => {
      runtime.performReactRefresh();
    });
    return true;
  };

  return {
    finalize,
    refresh,
    dispose,
    hasReactExports: () => record.hasReactExport,
    hasClassComponent: () => record.hasClassComponent,
  };
}
