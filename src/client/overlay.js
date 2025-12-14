// Basic DOM overlay used to surface build/transform errors during HMR.
const OVERLAY_ID = "ionify-error-overlay";

function ensureOverlay() {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.8)";
    overlay.style.color = "#f87171";
    overlay.style.fontFamily = "Menlo, Consolas, monospace";
    overlay.style.fontSize = "14px";
    overlay.style.padding = "32px";
    overlay.style.zIndex = "2147483647";
    overlay.style.overflowY = "auto";
    overlay.style.whiteSpace = "pre-wrap";
    document.body.appendChild(overlay);
  }
  return overlay;
}

export function showErrorOverlay(message, details) {
  if (typeof document === "undefined") return;
  const overlay = ensureOverlay();
  const header = "Ionify Build Error";
  overlay.innerHTML = `
    <div style="font-weight:600;font-size:16px;margin-bottom:16px;">
      ${header}
    </div>
    <div>${message ?? "Unknown error"}</div>
    ${details ? `<pre style="margin-top:16px;color:#fca5a5;">${details}</pre>` : ""}
  `;
}

export function clearErrorOverlay() {
  if (typeof document === "undefined") return;
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay && overlay.parentElement) {
    overlay.parentElement.removeChild(overlay);
  }
}
