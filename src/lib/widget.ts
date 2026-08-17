/**
 * In-WebView / PWA helpers for the /widget route.
 * The Android home-screen widget is native (WheelWidgetProvider), not this file.
 */
export function isWidgetPath(pathname = window.location.pathname): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/widget";
}

export function isStandaloneDisplay(): boolean {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.matchMedia("(display-mode: minimal-ui)").matches) return true;
    if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  } catch {
    /* old WebView without matchMedia display-mode */
  }
  return false;
}

type InstallPrompt = Event & { prompt: () => Promise<unknown> };

let deferredInstall: InstallPrompt | null = null;

export function captureInstallPrompt(event: Event): void {
  event.preventDefault();
  const promptable = event as InstallPrompt;
  if (typeof promptable.prompt === "function") deferredInstall = promptable;
}

export async function addWidgetToHomeScreen(): Promise<"prompted" | "manual"> {
  const ev = deferredInstall;
  if (ev) {
    try {
      await ev.prompt();
      deferredInstall = null;
      return "prompted";
    } catch {
      /* user dismissed or browser refused */
    }
  }
  return "manual";
}

export function openWidget(): void {
  if (isWidgetPath()) return;
  window.location.assign("/widget");
}

export function openFullApp(): void {
  window.location.assign("/");
}
