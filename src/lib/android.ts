/**
 * Android WebView bridge.
 *
 * The home-screen widget and the app share one JSON budget in SharedPreferences.
 * persist() calls pushBudgetToAndroid with baseUpdatedAt = the stamp before this
 * write, so native mergeBudgetJson can keep purchases the widget logged while
 * the WebView was saving. pullBudgetFromAndroid is the other direction.
 * Extra JS methods: saveDownload, openPlayStore, setChrome, pinWidget,
 * widgetOwned, widgetPrice, buyWidget.
 */
import { getCachedUser, getToken } from "../auth.ts";
import { sanitizeState } from "./sanitize.ts";
import { addWidgetToHomeScreen } from "./widget.ts";
import type { PersistedState } from "../types.ts";

interface AndroidBridge {
  writeBudget(json: string): void;
  readBudget(): string;
  notifyWidgets(): void;
  saveDownload?(filename: string, mime: string, base64: string): string;
  openPlayStore?(): void;
  setChrome?(theme: string): void;
  pinWidget?(): string;
  widgetOwned?(): string;
  widgetPrice?(): string;
  buyWidget?(): string;
}

function bridge(): AndroidBridge | null {
  const w = window as unknown as { BudgetWheelAndroid?: AndroidBridge };
  return w.BudgetWheelAndroid ?? null;
}

let ownedCache: boolean | null = null;

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

const PLAY_URL = "https://play.google.com/store/apps/details?id=com.budgetwheel.app";

export function openPlayStore(): void {
  const native = bridge();
  if (native?.openPlayStore) {
    try {
      native.openPlayStore();
      return;
    } catch {
      /* fall through to the public listing */
    }
  }
  try {
    window.open(PLAY_URL, "_blank", "noopener");
  } catch {
    window.location.assign(PLAY_URL);
  }
}

export function widgetUnlockState(): "free" | "owned" | "locked" {
  if (!isAndroidApp()) return "free";
  if (ownedCache === true) return "owned";
  try {
    const native = bridge()?.widgetOwned?.() === "1";
    ownedCache = native;
    return native ? "owned" : "locked";
  } catch {
    return ownedCache === true ? "owned" : "locked";
  }
}

export function watchWidgetOwned(onChange: () => void): void {
  (window as unknown as { BudgetWheelWidgetOwned?: (owned: boolean) => void }).BudgetWheelWidgetOwned = (
    owned: boolean,
  ) => {
    ownedCache = !!owned;
    onChange();
  };
}

export function widgetPriceLabel(): string {
  try {
    return bridge()?.widgetPrice?.() || "$1.99";
  } catch {
    return "$1.99";
  }
}

export function buyHomeWidget(): void {
  try {
    bridge()?.buyWidget?.();
  } catch {
    /* Play Billing not ready */
  }
}

export async function pinHomeWidget(): Promise<"pinned" | "manual" | "locked"> {
  const native = bridge();
  if (native?.pinWidget) {
    try {
      const result = native.pinWidget();
      if (result === "locked") return "locked";
      if (result === "ok") return "pinned";
    } catch {
      /* older APK without pinWidget */
    }
  }
  const web = await addWidgetToHomeScreen();
  return web === "prompted" ? "pinned" : "manual";
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
