/**
 * Device session only — there is no login or server.
 * The id is the IndexedDB key and the Android JSON owner stamp so a widget
 * written by this install is not absorbed by a different device profile.
 */
const USER_KEY = "bw_user";
const TOKEN_KEY = "bw_token";
const memoryStore = new Map<string, string>();

export interface AuthUser {
  id: string;
  name: string;
  createdAt: number;
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

function storageSet(key: string, value: string): void {
  memoryStore.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode or quota — keep the in-memory copy */
  }
}

function storageRemove(key: string): void {
  memoryStore.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function newDeviceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getCachedUser(): AuthUser | null {
  const raw = storageGet(USER_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { id?: string; name?: string; createdAt?: number };
    if (!o.id) return null;
    return {
      id: o.id,
      name: String(o.name || "This device").trim(),
      createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
    };
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return storageGet(TOKEN_KEY);
}

export function clearSession(): void {
  storageRemove(TOKEN_KEY);
  storageRemove(USER_KEY);
}

export function ensureDeviceSession(): AuthUser {
  const cached = getCachedUser();
  if (cached) {
    if (!getToken()) storageSet(TOKEN_KEY, `local.${cached.id}`);
    return cached;
  }
  const user: AuthUser = {
    id: newDeviceId(),
    name: "This device",
    createdAt: Date.now(),
  };
  storageSet(USER_KEY, JSON.stringify(user));
  storageSet(TOKEN_KEY, `local.${user.id}`);
  return user;
}
