// Basic DOM overlay used to surface build/transform errors (and warnings) during HMR.
const ERROR_OVERLAY_ID = "ionify-error-overlay";
const WARNING_OVERLAY_ID = "ionify-warning-overlay";
const WARNING_TOAST_ID = "ionify-warning-toast";

function scheduleNonBlockingRender(task) {
  if (typeof window === "undefined") {
    task();
    return;
  }

  const run = () => {
    const afterFrame = () => {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => window.requestAnimationFrame(task));
      } else {
        setTimeout(task, 32);
      }
    };

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(afterFrame, { timeout: 1200 });
      return;
    }

    setTimeout(afterFrame, 120);
  };

  if (document.readyState === "complete") {
    run();
    return;
  }

  window.addEventListener("load", run, { once: true });
}

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

export function showWarningToast(message, details) {
  if (typeof document === "undefined") return;

  scheduleNonBlockingRender(() => {
    const toast = ensureOverlay(WARNING_TOAST_ID);
    toast.style.position = "fixed";
    toast.style.right = "16px";
    toast.style.bottom = "16px";
    toast.style.maxWidth = "min(420px, calc(100vw - 32px))";
    toast.style.background = "rgba(17,24,39,0.94)";
    toast.style.color = "#fbbf24";
    toast.style.fontFamily = "Menlo, Consolas, monospace";
    toast.style.fontSize = "12px";
    toast.style.lineHeight = "1.5";
    toast.style.padding = "12px 14px";
    toast.style.border = "1px solid rgba(251,191,36,0.35)";
    toast.style.borderRadius = "12px";
    toast.style.boxShadow = "0 10px 24px rgba(0,0,0,0.28)";
    toast.style.zIndex = "2147483645";

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "flex-start";
    row.style.gap = "10px";

    const body = document.createElement("div");
    body.style.flex = "1";

    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.style.marginBottom = "4px";
    title.textContent = "Ionify Warning";

    const text = document.createElement("div");
    text.textContent = message ?? "";

    body.appendChild(title);
    body.appendChild(text);

    if (details) {
      const controls = document.createElement("div");
      controls.style.marginTop = "8px";
      controls.style.display = "flex";
      controls.style.alignItems = "center";
      controls.style.gap = "8px";

      const detailsButton = document.createElement("button");
      detailsButton.type = "button";
      detailsButton.textContent = "Show details";
      detailsButton.style.border = "1px solid rgba(251,191,36,0.35)";
      detailsButton.style.background = "transparent";
      detailsButton.style.color = "inherit";
      detailsButton.style.borderRadius = "999px";
      detailsButton.style.padding = "4px 8px";
      detailsButton.style.cursor = "pointer";
      detailsButton.style.font = "inherit";

      let detailsVisible = false;
      let detailsBlock = null;
      detailsButton.onclick = () => {
        if (detailsVisible) {
          detailsBlock?.remove();
          detailsBlock = null;
          detailsVisible = false;
          detailsButton.textContent = "Show details";
          return;
        }

        detailsBlock = document.createElement("pre");
        detailsBlock.style.margin = "8px 0 0 0";
        detailsBlock.style.whiteSpace = "pre-wrap";
        detailsBlock.style.maxHeight = "220px";
        detailsBlock.style.overflowY = "auto";
        detailsBlock.style.color = "#fde68a";
        detailsBlock.textContent = details;
        body.appendChild(detailsBlock);
        detailsVisible = true;
        detailsButton.textContent = "Hide details";
      };

      const hint = document.createElement("div");
      hint.style.fontSize = "11px";
      hint.style.opacity = "0.85";
      hint.textContent = "Non-blocking warning.";

      controls.appendChild(detailsButton);
      controls.appendChild(hint);
      body.appendChild(controls);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close warning");
    close.textContent = "×";
    close.style.border = "none";
    close.style.background = "transparent";
    close.style.color = "inherit";
    close.style.cursor = "pointer";
    close.style.fontSize = "18px";
    close.style.lineHeight = "18px";
    close.style.padding = "0";
    close.onclick = clearWarningToast;

    row.appendChild(body);
    row.appendChild(close);
    toast.replaceChildren(row);
  });
}

export function clearWarningOverlay() {
  if (typeof document === "undefined") return;
  const overlay = document.getElementById(WARNING_OVERLAY_ID);
  if (overlay && overlay.parentElement) {
    overlay.parentElement.removeChild(overlay);
  }
}

export function clearWarningToast() {
  if (typeof document === "undefined") return;
  const toast = document.getElementById(WARNING_TOAST_ID);
  if (toast && toast.parentElement) {
    toast.parentElement.removeChild(toast);
  }
}
