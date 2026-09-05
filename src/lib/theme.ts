/**
 * Dark / Light / System. Dark is the default. Light and System live in
 * Settings → Appearance. Android chrome follows the resolved scheme.
 */
import { isAndroidApp } from "./android.ts";
import type { ThemePref } from "../types.ts";

const DARK_CHROME = "#0D0C10";
const LIGHT_CHROME = "#F3EFE6";

interface AndroidChrome {
  setChrome?(theme: string): void;
}

function native(): AndroidChrome | null {
  return (window as unknown as { BudgetWheelAndroid?: AndroidChrome }).BudgetWheelAndroid ?? null;
}

export function resolvedTheme(pref: ThemePref): "dark" | "light" {
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(pref: ThemePref): "dark" | "light" {
  const resolved = resolvedTheme(pref);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    resolved === "light" ? LIGHT_CHROME : DARK_CHROME,
  );
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute("content", "dark light");
  if (isAndroidApp()) {
    try {
      native()?.setChrome?.(resolved);
    } catch {
      /* older APK without the chrome bridge */
    }
  }
  return resolved;
}

export function watchSystemTheme(pref: () => ThemePref, onChange: () => void): () => void {
  let mq: MediaQueryList | null = null;
  try {
    mq = window.matchMedia("(prefers-color-scheme: light)");
  } catch {
    return () => undefined;
  }
  const handler = () => {
    if (pref() === "system") onChange();
  };
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", handler);
  else mq.addListener(handler);
  return () => {
    if (!mq) return;
    if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", handler);
    else mq.removeListener(handler);
  };
}
