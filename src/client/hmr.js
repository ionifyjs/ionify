/**
 * Ionify HMR client (SSE + Fetch handshake).
 * Listens for graph-diff updates over SSE, then POSTs to fetch the payload.
 * For now, reloads the page when a module is deleted or update fails.
 */

const SSE_URL = "/__ionify_hmr";
const APPLY_URL = "/__ionify_hmr/apply";
const ERROR_URL = "/__ionify_hmr/error";

const log = (...args) => console.log("[Ionify HMR]", ...args);
const warn = (...args) => console.warn("[Ionify HMR]", ...args);
let overlayModulePromise = null;
let isNavigatingAway = false;

async function loadOverlayModule() {
  if (!overlayModulePromise) {
    overlayModulePromise = import("/__ionify_overlay.js").catch((error) => {
      overlayModulePromise = null;
      throw error;
    });
  }
  return overlayModulePromise;
}

async function showErrorOverlay(message, details) {
  try {
    const mod = await loadOverlayModule();
    mod?.showErrorOverlay?.(message, details);
  } catch {
    // ignore overlay load failures
  }
}

async function clearErrorOverlay() {
  try {
    const mod = await loadOverlayModule();
    mod?.clearErrorOverlay?.();
  } catch {
    // ignore overlay load failures
  }
}

async function showWarningToast(message, details) {
  try {
    const mod = await loadOverlayModule();
    mod?.showWarningToast?.(message, details);
  } catch {
    // ignore overlay load failures
  }
}

/**
 * Returns true if the error stack contains a frame from an Ionify-managed URL
 * (the deps bundle, an HMR-served module, or the overlay/hmr client itself).
 * Third-party DevTools errors (SolidJS, React, etc.) originate from URLs that
 * do NOT contain these prefixes and are intentionally excluded.
 */
function isIonifyManagedError(event) {
  const stack = (event?.error?.stack ?? event?.reason?.stack ?? "");
  const filename = event?.filename ?? "";
  return (
    stack.includes("/@deps/") ||
    stack.includes("/__ionify_") ||
    filename.includes("/@deps/") ||
    filename.includes("/__ionify_")
  );
}

// Surface runtime errors from Ionify-managed modules only.
// Third-party devtools components (React Query DevTools, Redux DevTools, etc.)
// may throw runtime TypeErrors due to API version mismatches; these should never
// block the app with a full-screen overlay.
globalThis.addEventListener?.("error", (event) => {
  if (!isIonifyManagedError(event)) return;
  void (async () => {
    const message = event?.message || "Runtime error";
    const details = event?.error?.stack || event?.error?.message;
    await showErrorOverlay(message, details);
  })();
});

globalThis.addEventListener?.("unhandledrejection", (event) => {
  if (!isIonifyManagedError(event)) return;
  void (async () => {
    const reason = event?.reason;
    const message = reason instanceof Error ? reason.message : "Unhandled promise rejection";
    const details = reason instanceof Error ? reason.stack : String(reason ?? "");
    await showErrorOverlay(message, details);
  })();
});

globalThis.addEventListener?.("beforeunload", () => {
  isNavigatingAway = true;
});

globalThis.addEventListener?.("pagehide", () => {
  isNavigatingAway = true;
});

// Establish SSE channel used to notify about pending graph diffs.
const source = new EventSource(SSE_URL);

source.addEventListener("error", (e) => {
  if (isNavigatingAway || source.readyState === EventSource.CLOSED) {
    return;
  }
  warn("SSE error", e);
  void (async () => {
  // Show overlay if server streamed a structured error payload.
  const data = e && typeof e === "object" && "data" in e ? e.data : undefined;
    if (data) {
      try {
        const payload = JSON.parse(data);
        if (payload?.message) {
          await showErrorOverlay(payload.message, payload.id ? `Update ${payload.id}` : undefined);
        }
      } catch {
        await showErrorOverlay(String(data || "HMR connection error"));
      }
    }
  })();
});

// P19R: Non-blocking peer dependency version mismatch warnings from the deps optimizer.
// Surface them without competing with the initial document paint.
source.addEventListener("peer-dep-warning", (event) => {
  void (async () => {
    const payload = JSON.parse(event.data);
    const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
    if (warnings.length === 0) return;
    const message = warnings.join("\n");
    warn(`Peer dep version mismatch detected (${warnings.length} issue${warnings.length > 1 ? "s" : ""})`);
    await showWarningToast(
      `Peer dependency version mismatch (${warnings.length} issue${warnings.length > 1 ? "s" : ""})`,
      message
    );
  })().catch(() => {
    // ignore malformed payload
  });
});

source.addEventListener("update", async (event) => {
  let summary;
  try {
    summary = JSON.parse(event.data);
  } catch (err) {
    warn("invalid update payload", err);
    return;
  }
  if (!summary || summary.type !== "update" || typeof summary.id !== "string") {
    return;
  }

  log(`update ${summary.id} received (${summary.modules?.length ?? 0} modules)`);
  void clearErrorOverlay();

  try {
    const response = await fetch(APPLY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: summary.id }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `apply status ${response.status}`);
    }
    const payload = await response.json();
    await applyUpdate(payload);
    await clearErrorOverlay();
  } catch (err) {
    await reportError(summary.id, err);
    const message = err instanceof Error ? err.message : String(err);
    await showErrorOverlay("Failed to apply update", message);
    warn("apply failed", err);
  }
});

async function reportError(id, err) {
  const message = err instanceof Error ? err.message : String(err);
  try {
    await fetch(ERROR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, message }),
    });
  } catch (_) {
    // swallow network errors
  }
}

async function applyUpdate(payload) {
  const modules = Array.isArray(payload?.modules) ? payload.modules : [];
  if (!modules.length) {
    log(`update ${payload?.id ?? "unknown"} had no modules`);
    return;
  }

  // if any module deleted, fallback to hard reload
  if (modules.some((m) => m.status === "deleted")) {
    warn("module deleted, reloading page");
    location.reload();
    return;
  }

  const timestamp = Date.now();
  for (const mod of modules) {
    if (!mod || typeof mod.url !== "string") continue;
    // HTML imports still force reload until we add declarative overlays.
    if (/\.(html)(\?|$)/.test(mod.url)) {
      warn(`${mod.url} requires full reload`);
      location.reload();
      return;
    }
    const separator = mod.url.includes("?") ? "&" : "?";
    const target = `${mod.url}${separator}ionify-hmr=${timestamp}`;
    try {
      await import(/* @vite-ignore */ target);
      log(`refreshed ${mod.url}`);
    } catch (err) {
      await reportError(payload?.id, err);
      const message = err instanceof Error ? err.message : String(err);
      await showErrorOverlay(`Failed to refresh ${mod.url}`, message);
      warn(`failed to refresh ${mod.url}`, err);
      return;
    }
  }

  // If React Refresh runtime is present, trigger it after importing updated modules.
  try {
    const refreshRuntime = globalThis.__IONIFY_REACT_REFRESH__;
    if (refreshRuntime?.performReactRefresh) {
      refreshRuntime.performReactRefresh();
      log("react refresh performed");
    }
  } catch (err) {
    warn("React Refresh failed", err);
  }

  log(`update ${payload?.id ?? "unknown"} applied`);
  await clearErrorOverlay();
}
