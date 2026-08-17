/* API shims for Chrome 63 / Android 8 (2018). Syntax is downleveled by Vite. */

if (typeof globalThis === "undefined") {
  (window as unknown as { globalThis: Window }).globalThis = window;
}

if (typeof queueMicrotask !== "function") {
  (window as unknown as { queueMicrotask: (cb: () => void) => void }).queueMicrotask = function (cb) {
    Promise.resolve()
      .then(cb)
      .catch((err) => {
        setTimeout(() => {
          throw err;
        }, 0);
      });
  };
}

if (!String.prototype.replaceAll) {
  String.prototype.replaceAll = function (this: string, search: string | RegExp, replacement: string) {
    if (typeof search !== "string") {
      return this.replace(search, replacement);
    }
    return this.split(search).join(replacement);
  } as typeof String.prototype.replaceAll;
}

if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, "at", {
    configurable: true,
    writable: true,
    value: function at(this: unknown[], n: number) {
      const len = this.length;
      const i = Math.trunc(n) || 0;
      const idx = i >= 0 ? i : len + i;
      return idx < 0 || idx >= len ? undefined : this[idx];
    },
  });
}

if (!Array.prototype.flat) {
  Object.defineProperty(Array.prototype, "flat", {
    configurable: true,
    writable: true,
    value: function flat(this: unknown[], depth?: number) {
      const d = depth === undefined ? 1 : Number(depth);
      const out: unknown[] = [];
      const walk = (arr: unknown[], left: number) => {
        for (let i = 0; i < arr.length; i += 1) {
          const v = arr[i];
          if (left > 0 && Array.isArray(v)) walk(v, left - 1);
          else out.push(v);
        }
      };
      walk(this, d);
      return out;
    },
  });
}

if (!Array.prototype.flatMap) {
  Object.defineProperty(Array.prototype, "flatMap", {
    configurable: true,
    writable: true,
    value: function flatMap<T, U>(this: T[], fn: (v: T, i: number, a: T[]) => U | U[], thisArg?: unknown) {
      return Array.prototype.concat.apply([], this.map(fn, thisArg));
    },
  });
}

if (!Object.fromEntries) {
  Object.fromEntries = function fromEntries(iter: Iterable<readonly [PropertyKey, unknown]>) {
    const obj: Record<string, unknown> = {};
    const list = Array.from(iter);
    for (let i = 0; i < list.length; i += 1) {
      obj[String(list[i][0])] = list[i][1];
    }
    return obj;
  } as typeof Object.fromEntries;
}

if (!Promise.allSettled) {
  Promise.allSettled = function allSettled<T>(values: Iterable<T | PromiseLike<T>>) {
    return Promise.all(
      Array.from(values).map((value) =>
        Promise.resolve(value).then(
          (ok) => ({ status: "fulfilled" as const, value: ok }),
          (reason) => ({ status: "rejected" as const, reason }),
        ),
      ),
    );
  } as typeof Promise.allSettled;
}
