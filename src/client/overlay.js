// Basic DOM overlay used to surface build/transform errors (and warnings) during HMR.
const ERROR_OVERLAY_ID = "ionify-error-overlay";
const WARNING_OVERLAY_ID = "ionify-warning-overlay";

function ensureOverlay(id) {
  let overlay = document.getElementById(id);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = id;
    document.body.appendChild(overlay);
  }
  return overlay;
}

function buildOverlayContent({
  title,
  message,
  details,
  onClose,
  accentColor,
}) {
  const root = document.createElement("div");
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.gap = "12px";

  const headerRow = document.createElement("div");
  headerRow.style.display = "flex";
  headerRow.style.alignItems = "flex-start";
  headerRow.style.justifyContent = "space-between";
  headerRow.style.gap = "12px";

  const header = document.createElement("div");
  header.style.fontWeight = "600";
  header.style.fontSize = "16px";
  header.textContent = title;

  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close overlay");
  close.textContent = "×";
  close.style.border = "1px solid rgba(255,255,255,0.25)";
  close.style.background = "transparent";
  close.style.color = "inherit";
  close.style.borderRadius = "8px";
  close.style.width = "32px";
  close.style.height = "32px";
  close.style.cursor = "pointer";
  close.style.fontSize = "20px";
  close.style.lineHeight = "28px";
  close.style.padding = "0";
  close.onclick = onClose;

  headerRow.appendChild(header);
  headerRow.appendChild(close);

  const body = document.createElement("div");
  body.textContent = message ?? "";

  root.appendChild(headerRow);
  root.appendChild(body);

  if (details) {
    const pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.color = accentColor;
    pre.textContent = details;
    root.appendChild(pre);
  }

  return root;
}

export function showErrorOverlay(message, details) {
  if (typeof document === "undefined") return;
  const overlay = ensureOverlay(ERROR_OVERLAY_ID);

  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.86)";
  overlay.style.color = "#f87171";
  overlay.style.fontFamily = "Menlo, Consolas, monospace";
  overlay.style.fontSize = "14px";
  overlay.style.padding = "32px";
  overlay.style.zIndex = "2147483647";
  overlay.style.overflowY = "auto";
  overlay.style.whiteSpace = "pre-wrap";

  overlay.replaceChildren(
    buildOverlayContent({
      title: "Ionify Build Error",
      message: message ?? "Unknown error",
      details,
      onClose: clearErrorOverlay,
      accentColor: "#fca5a5",
    })
  );
}

export function clearErrorOverlay() {
  if (typeof document === "undefined") return;
  const overlay = document.getElementById(ERROR_OVERLAY_ID);
  if (overlay && overlay.parentElement) {
    overlay.parentElement.removeChild(overlay);
  }
}

export function showWarningOverlay(message, details) {
  if (typeof document === "undefined") return;
  const overlay = ensureOverlay(WARNING_OVERLAY_ID);

  // Full-screen, transparent backdrop with a top-center panel.
  // Keep the app interactive by letting only the panel receive pointer events.
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.35)";
  overlay.style.zIndex = "2147483646";
  overlay.style.pointerEvents = "none";

  const panel = document.createElement("div");
  panel.style.position = "absolute";
  panel.style.top = "16px";
  panel.style.left = "50%";
  panel.style.transform = "translateX(-50%)";
  panel.style.maxWidth = "min(760px, calc(100vw - 32px))";
  panel.style.width = "fit-content";
  panel.style.background = "rgba(17,24,39,0.92)";
  panel.style.color = "#fbbf24";
  panel.style.fontFamily = "Menlo, Consolas, monospace";
  panel.style.fontSize = "13px";
  panel.style.padding = "16px";
  panel.style.border = "1px solid rgba(251,191,36,0.45)";
  panel.style.borderRadius = "12px";
  panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.35)";
  panel.style.overflow = "hidden";
  panel.style.pointerEvents = "auto";

  panel.appendChild(
    buildOverlayContent({
      title: "Ionify Warning",
      message: message ?? "",
      details,
      onClose: clearWarningOverlay,
      accentColor: "#fde68a",
    })
  );

  overlay.replaceChildren(panel);
}

export function clearWarningOverlay() {
  if (typeof document === "undefined") return;
  const overlay = document.getElementById(WARNING_OVERLAY_ID);
  if (overlay && overlay.parentElement) {
    overlay.parentElement.removeChild(overlay);
  }
}
