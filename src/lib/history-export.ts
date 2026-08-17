/**
 * History PDF export
 *
 * Layout, top to bottom:
 *   1. Title + date range
 *   2. Budgeted / spent / left (same numbers as the in-app graph header)
 *   3. One bar card per category (same shape as the live graph)
 *   4. Purchases grouped by category
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { EXTRA_FUNDS_ID } from "./categories.ts";
import { isAndroidApp } from "./android.ts";
import { periodLabel } from "./history.ts";
import { formatPct } from "./money.ts";
import { formatQuarterRange } from "./quarter.ts";
import { historyWheelSlices, transactionsForSnapshot } from "../store.ts";
import type { Transaction, WheelSnapshot } from "../types.ts";

interface AndroidSave {
  saveDownload?(filename: string, mime: string, base64: string): string;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

const bg = rgb(0.051, 0.047, 0.063);
const surface = rgb(0.11, 0.106, 0.129);
const track = rgb(0.149, 0.145, 0.173);
const on = rgb(0.957, 0.937, 0.969);
const soft = rgb(0.792, 0.769, 0.816);
const gold = rgb(0.941, 0.788, 0.302);
const line = rgb(0.286, 0.271, 0.31);
const err = rgb(1, 0.706, 0.671);

function androidSave(): AndroidSave | null {
  return (window as unknown as { BudgetWheelAndroid?: AndroidSave }).BudgetWheelAndroid ?? null;
}

function fileSafe(name: string): string {
  return name.replace(/[^A-Za-z0-9._\- ]+/g, "-").replace(/\s+/g, "-").slice(0, 60);
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function pdfSafe(value: string): string {
  return value
    .replace(/[−–—]/g, "-")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, "");
}

function money(amount: number): string {
  const formatted = Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

function hexRgb(hex: string): RGB {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return gold;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0.5, Math.min(r, w / 2, h / 2));
  return [
    `M ${x + rr} ${y}`,
    `H ${x + w - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x + w} ${y + rr}`,
    `V ${y + h - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}`,
    `H ${x + rr}`,
    `A ${rr} ${rr} 0 0 1 ${x} ${y + h - rr}`,
    `V ${y + rr}`,
    `A ${rr} ${rr} 0 0 1 ${x + rr} ${y}`,
    "Z",
  ].join(" ");
}

async function writeFile(filename: string, bytes: Uint8Array, mime: string): Promise<string> {
  const native = androidSave();
  if (native?.saveDownload) {
    const result = native.saveDownload(filename, mime, bytesToBase64(bytes));
    if (result && result.startsWith("ok")) return "Saved to Downloads on this phone.";
    throw new Error(result || "Could not save the file.");
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return isAndroidApp() ? "Saved on this phone." : "Download started.";
}

function fitText(font: PDFFont, text: string, size: number, max: number): string {
  const clean = pdfSafe(text);
  if (font.widthOfTextAtSize(clean, size) <= max) return clean;
  let cut = clean;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > max) {
    cut = cut.slice(0, -1);
  }
  return `${cut}...`;
}

class HistoryPdf {
  // y walks down from the top margin as each block is drawn.
  private readonly doc: PDFDocument;
  private readonly font: PDFFont;
  private readonly bold: PDFFont;
  private readonly title: string;
  private page!: PDFPage;
  private pageNo = 0;
  private y = 0;

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont, title: string) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.title = pdfSafe(title);
  }

  private fill(): void {
    this.page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: bg });
  }

  private footer(): void {
    this.page.drawText(pdfSafe("On-device copy  ·  nothing uploaded"), {
      x: MARGIN,
      y: 28,
      size: 8,
      font: this.font,
      color: soft,
    });
    const mark = String(this.pageNo);
    this.page.drawText(mark, {
      x: PAGE_W - MARGIN - this.font.widthOfTextAtSize(mark, 8),
      y: 28,
      size: 8,
      font: this.font,
      color: soft,
    });
  }

  private banner(continued: boolean): void {
    this.page.drawText("BUDGET WHEEL", {
      x: MARGIN,
      y: this.y,
      size: 8,
      font: this.bold,
      color: gold,
    });
    this.y -= 20;
    this.page.drawText(continued ? `${this.title}  (continued)` : this.title, {
      x: MARGIN,
      y: this.y,
      size: continued ? 14 : 22,
      font: this.bold,
      color: on,
    });
    this.y -= continued ? 18 : 16;
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y,
      width: 36,
      height: 1.25,
      color: gold,
    });
    this.y -= continued ? 18 : 22;
  }

  start(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pageNo = 1;
    this.y = PAGE_H - MARGIN;
    this.fill();
    this.banner(false);
  }

  private ensure(need: number): void {
    if (this.y - need >= 44) return;
    this.footer();
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pageNo += 1;
    this.y = PAGE_H - MARGIN;
    this.fill();
    this.banner(true);
  }

  note(value: string, gap = 16): void {
    this.ensure(gap);
    this.text(value, { size: 10, color: soft });
    this.y -= gap;
  }

  text(
    value: string,
    opts: { x?: number; y?: number; size?: number; bold?: boolean; color?: RGB; right?: number },
  ): number {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const label = pdfSafe(value);
    const width = font.widthOfTextAtSize(label, size);
    const x = opts.right !== undefined ? opts.right - width : (opts.x ?? MARGIN);
    this.page.drawText(label, {
      x,
      y: opts.y ?? this.y,
      size,
      font,
      color: opts.color ?? on,
    });
    return width;
  }

  private card(x: number, y: number, w: number, h: number): void {
    this.page.drawSvgPath(roundedRect(x, y, w, h, 14), {
      color: surface,
      borderColor: line,
      borderWidth: 0.8,
    });
  }

  section(label: string): void {
    this.ensure(28);
    this.y -= 4;
    this.text(label.toUpperCase(), { size: 8, bold: true, color: gold });
    this.y -= 14;
  }

  drawTotals(opts: {
    income: number;
    envelope: number;
    spent: number;
    remaining: number;
  }): void {
    const h = 96;
    this.ensure(h + 12);
    const bottom = this.y - h;
    this.card(MARGIN, bottom, CONTENT_W, h);
    this.text("Income", { x: MARGIN + 14, y: this.y - 20, size: 8, color: soft });
    this.text(money(opts.income), { x: MARGIN + 14, y: this.y - 38, size: 14, bold: true });
    const cols = 3;
    const gap = 8;
    const inner = CONTENT_W - 28;
    const cellW = (inner - gap * (cols - 1)) / cols;
    const cellH = 36;
    const cellY = bottom + 12;
    const over = opts.remaining < 0;
    const cells = [
      { val: opts.envelope > 0 ? money(opts.envelope) : "-", lbl: "budgeted", warn: false },
      { val: money(opts.spent), lbl: "spent", warn: false },
      {
        val: money(over ? -opts.remaining : opts.remaining),
        lbl: over ? "over-Budget" : "budget-left",
        warn: over,
      },
    ];
    cells.forEach((cell, i) => {
      const x = MARGIN + 14 + i * (cellW + gap);
      this.page.drawSvgPath(roundedRect(x, cellY, cellW, cellH, 10), { color: track });
      const vw = this.bold.widthOfTextAtSize(pdfSafe(cell.val), 10);
      this.text(cell.val, {
        x: x + (cellW - Math.min(vw, cellW - 8)) / 2,
        y: cellY + 18,
        size: 10,
        bold: true,
        color: cell.warn ? err : on,
      });
      const lw = this.font.widthOfTextAtSize(cell.lbl.toUpperCase(), 7);
      this.text(cell.lbl.toUpperCase(), {
        x: x + (cellW - lw) / 2,
        y: cellY + 7,
        size: 7,
        color: soft,
      });
    });
    this.y = bottom - 14;
  }

  drawBars(slices: ReturnType<typeof historyWheelSlices>): void {
    if (!slices.length) {
      this.ensure(16);
      this.text("No categories in this period.", { size: 10, color: soft });
      this.y -= 16;
      return;
    }
    const warn = rgb(1, 0.714, 0.541);
    const rowH = 68;
    const gap = 8;
    for (const slice of slices) {
      this.ensure(rowH + gap);
      const bottom = this.y - rowH;
      this.card(MARGIN, bottom, CONTENT_W, rowH);
      const over = slice.envelope > 0 && slice.spent > slice.envelope + 0.009;
      const left = slice.envelope - slice.spent;
      const pct = slice.envelope > 0 ? Math.min(100, (slice.spent / slice.envelope) * 100) : slice.spent > 0 ? 100 : 0;
      const name = fitText(this.bold, slice.name, 11, CONTENT_W * 0.52);
      const amt = `${money(slice.spent)} of ${slice.envelope > 0 ? money(slice.envelope) : "-"}`;
      this.text(name, { x: MARGIN + 14, y: this.y - 24, size: 11, bold: true });
      this.text(amt, { y: this.y - 23, size: 9, bold: true, color: soft, right: PAGE_W - MARGIN - 14 });
      const trackY = this.y - 40;
      const trackW = CONTENT_W - 28;
      const trackX = MARGIN + 14;
      this.page.drawSvgPath(roundedRect(trackX, trackY, trackW, 10, 5), { color: track });
      const fillW = trackW * (pct / 100);
      if (fillW > 0.6) {
        this.page.drawSvgPath(roundedRect(trackX, trackY, fillW, 10, 5), {
          color: over ? err : hexRgb(slice.color),
        });
      }
      const pctLabel = slice.envelope > 0 ? formatPct(pct, pct < 10 && pct > 0 ? 1 : 0) : "No budget";
      const leftLabel = left < 0 ? `${money(-left)} over` : `${money(left)} left`;
      this.text(pctLabel, { x: MARGIN + 14, y: bottom + 12, size: 8, color: soft });
      this.text(leftLabel, {
        y: bottom + 12,
        size: 8,
        bold: left < 0,
        color: left < 0 ? warn : soft,
        right: PAGE_W - MARGIN - 14,
      });
      this.y = bottom - gap;
    }
  }

  drawPurchases(slices: ReturnType<typeof historyWheelSlices>, txs: Transaction[]): void {
    this.section("Purchases");
    const grouped = slices
      .map((slice) => ({
        slice,
        rows: txs
          .filter((tx) => tx.categoryId === slice.id)
          .sort((a, b) => b.createdAt - a.createdAt),
      }))
      .filter((group) => group.rows.length > 0);
    if (!grouped.length) {
      this.ensure(16);
      this.text("No purchases saved for this period.", { size: 10, color: soft });
      this.y -= 16;
      return;
    }
    const rowH = 18;
    const headH = 28;
    const pad = 12;
    for (const group of grouped) {
      const h = pad + headH + group.rows.length * rowH + 6;
      this.ensure(h + 10);
      const bottom = this.y - h;
      this.card(MARGIN, bottom, CONTENT_W, h);
      const headY = this.y - pad - 12;
      this.page.drawSvgPath(roundedRect(MARGIN + 14, headY - 1, 8, 8, 4), {
        color: hexRgb(group.slice.color),
      });
      const name = fitText(this.bold, group.slice.name, 11, CONTENT_W - 140);
      this.text(name, { x: MARGIN + 28, y: headY, size: 11, bold: true });
      this.text(money(group.slice.spent), {
        y: headY,
        size: 10,
        color: soft,
        right: PAGE_W - MARGIN - 14,
      });
      group.rows.forEach((tx, i) => {
        const y = this.y - pad - headH - i * rowH - 2;
        if (i === 0) {
          this.page.drawRectangle({
            x: MARGIN + 14,
            y: y + 12,
            width: CONTENT_W - 28,
            height: 0.6,
            color: line,
          });
        }
        const when = new Date(tx.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        this.text(when, { x: MARGIN + 14, y, size: 9, color: soft });
        this.text(`-${money(tx.amount)}`, {
          y,
          size: 9,
          color: on,
          right: PAGE_W - MARGIN - 14,
        });
      });
      this.y = bottom - 10;
    }
  }

  finish(): void {
    this.footer();
  }
}

async function buildHistoryPdf(snap: WheelSnapshot): Promise<Uint8Array> {
  const slices = historyWheelSlices(snap);
  const txs = transactionsForSnapshot(snap);
  const monthlyIncome = snap.monthlyIncome;
  const assigned = slices.filter((s) => s.id !== EXTRA_FUNDS_ID);
  const totalEnv = assigned.reduce((s, c) => s + c.envelope, 0);
  const totalSpent = slices.reduce((s, c) => s + c.spent, 0);
  const title = periodLabel(snap);
  const range = formatQuarterRange(snap.startIso, snap.endIso);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pdf = new HistoryPdf(doc, font, bold, title);
  pdf.start();
  if (range) pdf.note(range, 14);
  pdf.drawTotals({
    income: monthlyIncome * snap.periodMonths,
    envelope: totalEnv,
    spent: totalSpent,
    remaining: totalEnv - totalSpent,
  });
  pdf.drawBars(slices);
  pdf.drawPurchases(slices, txs);
  pdf.finish();
  doc.setTitle(`${title} · Budget Wheel`);
  doc.setAuthor("Budget Wheel");
  doc.setCreator("Budget Wheel");
  return doc.save();
}

export async function downloadHistoryWheel(snap: WheelSnapshot): Promise<string> {
  const bytes = await buildHistoryPdf(snap);
  const filename = `Budget-Wheel-${fileSafe(snap.label || snap.id)}.pdf`;
  return writeFile(filename, bytes, "application/pdf");
}

export async function downloadHistoryWheels(snaps: WheelSnapshot[]): Promise<string> {
  const unique = snaps.filter((snap, i, all) => all.findIndex((item) => item.id === snap.id) === i);
  if (!unique.length) throw new Error("Nothing to download.");
  let last = "";
  for (const snap of unique) {
    last = await downloadHistoryWheel(snap);
  }
  return unique.length === 1 ? last : `Saved ${unique.length} PDFs to this device.`;
}
