/**
 * App entry: viewport, hydrate from IndexedDB / Android, then paint.
 * BudgetWheelRefresh is what MainActivity calls after a widget purchase.
 */
import "./lib/compat.ts";
import { startApp } from "./app.ts";
import { captureInstallPrompt, isWidgetPath } from "./lib/widget.ts";
import { handleWidgetBack, resetWidget } from "./screens/widget.ts";
import { handlePopState, hydrate, refreshOnForeground, refreshUi } from "./store.ts";
import "./style.css";

if (isWidgetPath()) {
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (manifest) manifest.href = "/widget-manifest.webmanifest";
}

let viewportTimer = 0;
let lastAppHeight = -1;
let lastOffsetTop = -1;

function syncViewportHeight(): void {
  const vv = window.visualViewport;
  const height = Math.max(1, Math.round(vv?.height ?? window.innerHeight));
  const offsetTop = Math.max(0, Math.round(vv?.offsetTop ?? 0));
  if (height === lastAppHeight && offsetTop === lastOffsetTop) return;
  lastAppHeight = height;
  lastOffsetTop = offsetTop;
  const root = document.documentElement;
  root.style.setProperty("--app-height", `${height}px`);
  root.style.setProperty("--app-offset-top", `${offsetTop}px`);
}

function scheduleViewportHeight(): void {
  window.clearTimeout(viewportTimer);
  viewportTimer = window.setTimeout(syncViewportHeight, 50);
}

function scrollFocusedFieldIntoView(target: EventTarget | null): void {
  if (!(target instanceof HTMLElement)) return;
  if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") return;
  window.setTimeout(() => {
    try {
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    } catch {
      target.scrollIntoView();
    }
  }, 80);
}

try {
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
} catch {
  /* ignore */
}

syncViewportHeight();
window.addEventListener("resize", scheduleViewportHeight);
window.addEventListener("orientationchange", () => {
  syncViewportHeight();
  window.setTimeout(syncViewportHeight, 150);
  window.setTimeout(syncViewportHeight, 400);
});
window.visualViewport?.addEventListener("resize", scheduleViewportHeight);
window.visualViewport?.addEventListener("scroll", scheduleViewportHeight);

document.addEventListener("focusin", (event) => {
  scrollFocusedFieldIntoView(event.target);
});

window.addEventListener("beforeinstallprompt", (event) => {
  captureInstallPrompt(event);
});

window.addEventListener("popstate", () => {
  if (handleWidgetBack()) return;
  if (document.body.classList.contains("is-widget")) {
    resetWidget();
    refreshUi();
    return;
  }
  handlePopState();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  syncViewportHeight();
  void refreshOnForeground();
});

window.addEventListener("focus", () => {
  void refreshOnForeground();
});

window.addEventListener("pageshow", (event) => {
  syncViewportHeight();
  if (event.persisted) void refreshOnForeground();
});

void hydrate().then(() => {
  startApp();
});

(window as unknown as { BudgetWheelRefresh?: () => void }).BudgetWheelRefresh = () => {
  void refreshOnForeground();
};
