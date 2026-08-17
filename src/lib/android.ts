/**
 * Android WebView bridge.
 *
 * The home-screen widget and the app share one JSON budget in SharedPreferences.
 * persist() calls pushBudgetToAndroid with baseUpdatedAt = the stamp before this
 * write, so native mergeBudgetJson can keep purchases the widget logged while
 * the WebView was saving. pullBudgetFromAndroid is the other direction.
 */
import { getCachedUser, getToken } from "../auth.ts";
import { sanitizeState } from "./sanitize.ts";
import type { PersistedState } from "../types.ts";

interface AndroidBridge {
  writeBudget(json: string): void;
  readBudget(): string;
  notifyWidgets(): void;
  saveDownload?(filename: string, mime: string, base64: string): string;
}

function bridge(): AndroidBridge | null {
  const w = window as unknown as { BudgetWheelAndroid?: AndroidBridge };
  return w.BudgetWheelAndroid ?? null;
}

export function isAndroidApp(): boolean {
  return bridge() !== null;
}

export function pushBudgetToAndroid(state: PersistedState, baseUpdatedAt = state.updatedAt): void {
  const native = bridge();
  if (!native) return;
  try {
    native.writeBudget(
      JSON.stringify({
        state,
        token: getToken(),
        user: getCachedUser(),
        updatedAt: state.updatedAt,
        baseUpdatedAt,
      }),
    );
    native.notifyWidgets();
  } catch {
    /* running in a browser, not the Android app */
  }
}

export function pullBudgetFromAndroid(): PersistedState | null {
  const native = bridge();
  if (!native) return null;
  try {
    const raw = native.readBudget();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: unknown; user?: { id?: string } };
    const owner = parsed.user?.id;
    const me = getCachedUser()?.id;
    if (owner && me && owner !== me) return null;
    return sanitizeState(parsed.state ?? parsed);
  } catch {
    return null;
  }
}
