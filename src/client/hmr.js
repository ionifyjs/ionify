/**
 * Ionify HMR client (SSE + Fetch handshake).
 * Listens for graph-diff updates over SSE, then POSTs to fetch the payload.
 * For now, reloads the page when a module is deleted or update fails.
 */
import { showErrorOverlay, clearErrorOverlay } from "/__ionify_overlay.js";

const SSE_URL = "/__ionify_hmr";
const APPLY_URL = "/__ionify_hmr/apply";
const ERROR_URL = "/__ionify_hmr/error";

const log = (...args) => console.log("[Ionify HMR]", ...args);
const warn = (...args) => console.warn("[Ionify HMR]", ...args);

// Establish SSE channel used to notify about pending graph diffs.
const source = new EventSource(SSE_URL);

source.addEventListener("ready", () => {
  log("connected");
});

source.addEventListener("error", (e) => {
  warn("SSE error", e);
  // Show overlay if server streamed a structured error payload.
  if (e?.data) {
    try {
      const payload = JSON.parse(e.data);
      if (payload?.message) {
        showErrorOverlay(payload.message, payload.id ? `Update ${payload.id}` : undefined);
      }
    } catch {
      showErrorOverlay(String(e.data || "HMR connection error"));
    }
  }
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
  clearErrorOverlay();

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
    clearErrorOverlay();
  } catch (err) {
    await reportError(summary.id, err);
    const message = err instanceof Error ? err.message : String(err);
    showErrorOverlay("Failed to apply update", message);
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
      showErrorOverlay(`Failed to refresh ${mod.url}`, message);
      warn(`failed to refresh ${mod.url}`, err);
      return;
    }
  }
  log(`update ${payload?.id ?? "unknown"} applied`);
  clearErrorOverlay();
}
