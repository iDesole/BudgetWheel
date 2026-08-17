export function formatMoney(amount: number): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  return amount < 0 ? `−${formatted}` : formatted;
}

export function formatPct(value: number, digits = 0): string {
  const n = Number.isFinite(value) ? value : 0;
  return `${n.toFixed(digits)}%`;
}

export function clampMoney(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100) / 100;
}

export function parsePad(raw: string): number {
  if (!raw || raw === ".") return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? clampMoney(n) : 0;
}

export function appendPad(current: string, key: string): string {
  if (key === "back") {
    return current.slice(0, -1);
  }
  if (key === ".") {
    if (current.includes(".")) return current;
    return current === "" ? "0." : `${current}.`;
  }
  if (!/^\d$/.test(key)) return current;
  if (current === "0") return key;
  if (current.includes(".")) {
    const dec = current.split(".")[1] ?? "";
    if (dec.length >= 2) return current;
  }
  const digits = current.replace(".", "").length;
  if (digits >= 8) return current;
  return `${current}${key}`;
}

export function padDisplay(raw: string, unit: "money" | "hours" | "percent" = "money"): string {
  if (unit === "hours") {
    if (!raw) return "0 hrs";
    if (raw.endsWith(".")) return `${raw} hrs`;
    const n = parsePad(raw);
    return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} hrs`;
  }
  if (unit === "percent") {
    if (!raw) return "0%";
    if (raw.endsWith(".")) return `${raw}%`;
    const n = parsePad(raw);
    return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  }
  if (!raw) return "$0";
  if (raw.endsWith(".")) return `$${raw}`;
  const n = parsePad(raw);
  if (raw.includes(".")) {
    const dec = raw.split(".")[1] ?? "";
    return `$${n.toLocaleString("en-US", {
      minimumFractionDigits: dec.length,
      maximumFractionDigits: 2,
    })}`;
  }
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function escapeHtml(value: string): string {
  return value
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;")
    .split("'")
    .join("&#39;");
}
