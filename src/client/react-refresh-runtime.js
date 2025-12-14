import RefreshRuntime from "react-refresh/runtime";

let installed = false;
const moduleInfo = new Map();
const warnedClassModules = new Set();

function ensureRuntime() {
  if (installed) return RefreshRuntime;
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => (type) => type;
  window.__IONIFY_REACT_REFRESH__ = RefreshRuntime;
  installed = true;
  return RefreshRuntime;
}

export function setupReactRefresh(importMetaHot, moduleId) {
  if (!importMetaHot) return null;
  const runtime = ensureRuntime();

  // Track metadata for this module so we can make refresh decisions later.
  const record = {
    hasReactExport: false,
    hasClassComponent: false,
  };
  moduleInfo.set(moduleId, record);

  const prevReg = window.$RefreshReg$;
  const prevSig = window.$RefreshSig$;

  window.$RefreshReg$ = (type, id) => {
    runtime.register(type, moduleId + " " + id);
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
    moduleInfo.delete(moduleId);
  };

  const refresh = () => {
    if (!record.hasReactExport) return false;
    if (record.hasClassComponent && !warnedClassModules.has(moduleId)) {
      console.warn(
        `[Ionify] React Fast Refresh cannot preserve state for class components (module: ${moduleId}). State will reset after edits.`
      );
      warnedClassModules.add(moduleId);
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
