/**
 * User-owned month download: a PNG of the wheel plus a CSV of that month.
 * Available once the month has ended (or on its last calendar day).
 */
import { EXTRA_FUNDS_ID, budgetSpendTotals, isFundsIn } from "./categories.ts";
import { saveDeviceFile } from "./history-export.ts";
import { txsInMonth } from "./history.ts";
import { formatMoney } from "./money.ts";
import { formatMonthLabel, isoDate, monthIdFromDate } from "./quarter.ts";
import { resolvedTheme } from "./theme.ts";
import { donut, wheelRingLayout, type WheelSlice } from "../ui/wheel.ts";
import { historyWheelSlices, state, transactionsForSnapshot, wheelCategories } from "../store.ts";
import type { ThemePref, Transaction } from "../types.ts";

const PNG_W = 1080;
const PNG_H = 1440;

function fileSafe(name: string): string {
  return name.replace(/[^A-Za-z0-9._\- ]+/g, "-").replace(/\s+/g, "-").slice(0, 60);
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function lastDayOfMonth(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

export function monthHasEnded(monthId: string, now = new Date()): boolean {
  const current = monthIdFromDate(now);
  if (monthId < current) return true;
  if (monthId > current) return false;
  return now.getDate() >= lastDayOfMonth(now);
}

export function monthExportReady(now = new Date()): boolean {
  if (monthHasEnded(monthIdFromDate(now), now)) return true;
  return (state.monthHistory ?? []).length > 0;
}

export function exportableMonth(now = new Date()): { id: string; label: string; live: boolean } | null {
  const currentId = monthIdFromDate(now);
  if (monthHasEnded(currentId, now)) {
    const snap = (state.monthHistory ?? []).find((item) => item.id === currentId);
    return { id: currentId, label: formatMonthLabel(currentId), live: !snap };
  }
  const closed = [...(state.monthHistory ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const latest = closed[closed.length - 1];
  if (!latest) return null;
  return { id: latest.id, label: formatMonthLabel(latest.id) || latest.label, live: false };
}

function palette(theme: "dark" | "light"): { bg: string; on: string; soft: string; gold: string } {
  if (theme === "light") {
    return { bg: "#F3EFE6", on: "#1C1B16", soft: "#5C5748", gold: "#8A6A00" };
  }
  return { bg: "#0D0C10", on: "#F4EFF7", soft: "#CAC4D0", gold: "#F0C94D" };
}

function paintWheelPng(
  slices: WheelSlice[],
  opts: { label: string; leftover: number; spent: number; envelope: number; theme: "dark" | "light" },
): Promise<Uint8Array> {
  const colors = palette(opts.theme);
  const canvas = document.createElement("canvas");
  canvas.width = PNG_W;
  canvas.height = PNG_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Could not draw the wheel."));
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, PNG_W, PNG_H);
  ctx.fillStyle = colors.gold;
  ctx.font = "700 28px Outfit, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("BUDGET WHEEL", PNG_W / 2, 88);
  ctx.fillStyle = colors.on;
  ctx.font = "750 56px Outfit, Segoe UI, sans-serif";
  ctx.fillText(opts.label, PNG_W / 2, 156);

  const layout = wheelRingLayout(slices);
  const svg = 320;
  const wheelPx = 720;
  const scale = wheelPx / svg;
  const cx = PNG_W / 2;
  const cy = 560;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-svg / 2, -svg / 2);
  if (layout.empty) {
    ctx.beginPath();
    ctx.arc(layout.cx, layout.cy, (layout.hole + layout.mainOuter) / 2, 0, Math.PI * 2);
    ctx.strokeStyle = opts.theme === "light" ? "#D4CDB8" : "#49454F";
    ctx.lineWidth = layout.mainOuter - layout.hole;
    ctx.stroke();
  } else {
    for (const arc of layout.arcs) {
      const path = new Path2D(donut(layout.cx, layout.cy, arc.r0, arc.r1, arc.a0, arc.a1));
      ctx.fillStyle = arc.color;
      ctx.fill(path);
    }
  }
  ctx.restore();

  ctx.fillStyle = colors.soft;
  ctx.font = "600 24px Outfit, Segoe UI, sans-serif";
  ctx.fillText("left this month", PNG_W / 2, 980);
  ctx.fillStyle = opts.leftover < 0 ? "#E46962" : colors.on;
  ctx.font = "750 64px Outfit, Segoe UI, sans-serif";
  ctx.fillText(formatMoney(opts.leftover), PNG_W / 2, 1052);
  ctx.fillStyle = colors.soft;
  ctx.font = "500 22px Outfit, Segoe UI, sans-serif";
  ctx.fillText(`${formatMoney(opts.spent)} spent of ${formatMoney(opts.envelope)}`, PNG_W / 2, 1100);

  const ticks = slices.filter((s) => s.id !== EXTRA_FUNDS_ID).slice(0, 10);
  const tickY = 1188;
  const gap = 36;
  const startX = PNG_W / 2 - ((ticks.length - 1) * gap) / 2;
  ticks.forEach((slice, i) => {
    ctx.beginPath();
    ctx.arc(startX + i * gap, tickY, 10, 0, Math.PI * 2);
    ctx.fillStyle = slice.color;
    ctx.fill();
  });

  ctx.fillStyle = colors.soft;
  ctx.font = "500 18px Outfit, Segoe UI, sans-serif";
  ctx.fillText("Yours — saved on this device", PNG_W / 2, 1368);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not save the picture."));
        return;
      }
      void blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
    }, "image/png");
  });
}

function monthCsv(label: string, txs: Transaction[], names: Map<string, string>): Uint8Array {
  const lines = ["Month,Date,Category,Type,Amount"];
  const sorted = [...txs].sort((a, b) => a.createdAt - b.createdAt);
  for (const tx of sorted) {
    const kind = isFundsIn(tx) ? "added" : "purchase";
    const name = names.get(tx.categoryId) ?? tx.categoryId;
    lines.push(
      [csvCell(label), isoDate(new Date(tx.createdAt)), csvCell(name), kind, tx.amount.toFixed(2)].join(","),
    );
  }
  if (sorted.length === 0) lines.push(`${csvCell(label)},,,,`);
  const text = `\uFEFF${lines.join("\n")}\n`;
  return new TextEncoder().encode(text);
}

function slicesForMonth(target: { id: string; live: boolean }): WheelSlice[] {
  if (target.live) return wheelCategories();
  const snap = (state.monthHistory ?? []).find((item) => item.id === target.id);
  return snap ? historyWheelSlices(snap) : wheelCategories();
}

function txsForMonth(target: { id: string; live: boolean }): Transaction[] {
  if (target.live) return txsInMonth(state.transactions, target.id);
  const snap = (state.monthHistory ?? []).find((item) => item.id === target.id);
  return snap ? transactionsForSnapshot(snap) : txsInMonth(state.transactions, target.id);
}

export async function downloadMonthWheel(opts?: { theme?: ThemePref }): Promise<string> {
  const target = exportableMonth();
  if (!target) throw new Error("Available when this month ends.");
  const slices = slicesForMonth(target);
  const totals = budgetSpendTotals(slices);
  const theme = resolvedTheme(opts?.theme ?? state.theme);
  const png = await paintWheelPng(slices, {
    label: target.label,
    leftover: totals.moneyLeft,
    spent: totals.spent,
    envelope: totals.envelope,
    theme,
  });
  const names = new Map(slices.map((s) => [s.id, s.name]));
  for (const cat of state.categories) names.set(cat.id, cat.name);
  const csv = monthCsv(target.label, txsForMonth(target), names);
  const stamp = fileSafe(target.label);
  await saveDeviceFile(`Budget-Wheel-${stamp}.png`, png, "image/png");
  await saveDeviceFile(`Budget-Wheel-${stamp}.csv`, csv, "text/csv");
  return "Saved a picture and a CSV on this device.";
}

export function monthExportHint(now = new Date()): string {
  if (monthExportReady(now)) {
    const target = exportableMonth(now);
    return target ? `Save ${target.label} as a picture and a CSV.` : "Save a picture of a closed month.";
  }
  return "Available when this month ends.";
}
