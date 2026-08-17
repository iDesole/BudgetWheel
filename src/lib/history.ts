/**
 * Spending history
 *
 * Three archives sit on the device and stay independent unless the user
 * says otherwise:
 *
 *   month   id "2026-06"
 *   quarter id "2026-Q2"
 *   year    id "2026"
 *
 * Closing a period writes a frozen snapshot (budgets + spend). Opening
 * a snapshot always reads those frozen numbers so a deleted month cannot
 * silently rewrite a quarter. Itemized purchases still come from the
 * transaction list.
 *
 * Delete is scale-local by default. A checkbox can cascade:
 *   month  → also rebuild the overlapping quarter and year
 *   quarter → also rebuild the overlapping year
 */

import type { Category, HistoryScale, SnapshotCategory, Transaction, WheelSnapshot } from "../types.ts";
import {
  compareMonthId,
  compareQuarterId,
  formatMonthLabel,
  monthBounds,
  monthIdFromTimestamp,
  parseMonthId,
  parseQuarterId,
  quarterIdFromMonthId,
  quarterYear,
  yearBounds,
} from "./quarter.ts";

export interface HistoryPack {
  monthHistory: WheelSnapshot[];
  quarterHistory: WheelSnapshot[];
  yearHistory: WheelSnapshot[];
  previousSnapshot: WheelSnapshot | null;
  transactions: Transaction[];
}

export interface HistoryDeleteOpts {
  cascadeQuarters?: boolean;
  cascadeYears?: boolean;
}

export type HistorySlice = Category & { spent: number; remaining: number; envelope: number };

// ---------------------------------------------------------------------------
// Period labels
// ---------------------------------------------------------------------------

export function periodWord(scale: HistoryScale): string {
  if (scale === "year") return "year";
  if (scale === "quarter") return "quarter";
  return "month";
}

export function periodLabel(snap: WheelSnapshot): string {
  if (snap.scale === "month") return formatMonthLabel(snap.id);
  return snap.label || snap.id;
}

// ---------------------------------------------------------------------------
// Which purchases belong to a saved period
// ---------------------------------------------------------------------------

export function txsInMonth(txs: Transaction[], monthId: string): Transaction[] {
  return txs.filter((tx) => monthIdFromTimestamp(tx.createdAt) === monthId);
}

export function txsInQuarter(txs: Transaction[], quarterId: string): Transaction[] {
  return txs.filter((tx) => {
    const monthId = monthIdFromTimestamp(tx.createdAt);
    return monthId ? quarterIdFromMonthId(monthId) === quarterId : false;
  });
}

export function txsInYear(txs: Transaction[], year: number): Transaction[] {
  return txs.filter((tx) => {
    const monthId = monthIdFromTimestamp(tx.createdAt);
    return monthId ? parseMonthId(monthId)?.year === year : false;
  });
}

export function txsInSnapshot(snap: WheelSnapshot, txs: Transaction[]): Transaction[] {
  if (snap.scale === "month") return txsInMonth(txs, snap.id);
  if (snap.scale === "quarter") return txsInQuarter(txs, snap.id);
  const year = Number(snap.id);
  return Number.isFinite(year) ? txsInYear(txs, year) : [];
}

// ---------------------------------------------------------------------------
// Spend maps (purchases or already-saved snapshots → category totals)
// ---------------------------------------------------------------------------

export function spendFromTransactions(txs: Transaction[]): Map<string, number> {
  const spent = new Map<string, number>();
  for (const tx of txs) {
    spent.set(tx.categoryId, (spent.get(tx.categoryId) ?? 0) + tx.amount);
  }
  return spent;
}

export function spendFromSnapshots(snaps: WheelSnapshot[]): Map<string, number> {
  const spent = new Map<string, number>();
  for (const snap of snaps) {
    for (const cat of snap.categories) {
      spent.set(cat.id, (spent.get(cat.id) ?? 0) + cat.spent);
    }
  }
  return spent;
}

function hasSpend(spent: Map<string, number>): boolean {
  for (const value of spent.values()) {
    if (value > 0.009) return true;
  }
  return false;
}

function snapshotHasSpend(snap: WheelSnapshot): boolean {
  return snap.categories.some((cat) => cat.spent > 0.009);
}

// ---------------------------------------------------------------------------
// Build one frozen archive card
// ---------------------------------------------------------------------------

function snapshotCategories(spent: Map<string, number>, categories: Category[]): SnapshotCategory[] {
  return categories
    .filter((c) => c.budgeted > 0 || (spent.get(c.id) ?? 0) > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      budgetedMonthly: c.budgeted,
      spent: spent.get(c.id) ?? 0,
    }));
}

export function snapshotFromSpend(
  id: string,
  scale: HistoryScale,
  label: string,
  startIso: string,
  endIso: string,
  periodMonths: number,
  spent: Map<string, number>,
  income: number,
  categories: Category[],
): WheelSnapshot {
  return {
    id,
    scale,
    quarterId: scale === "quarter" ? id : quarterIdFromMonthId(id) || id,
    label,
    startIso,
    endIso,
    periodMonths,
    monthlyIncome: income,
    categories: snapshotCategories(spent, categories),
    capturedAt: Date.now(),
  };
}

/** Replace the same period if it is already in the list. Match on id only so a month never knocks out its quarter. */
export function upsertSnapshot(
  list: WheelSnapshot[],
  snap: WheelSnapshot,
  compare: (a: string, b: string) => number,
): WheelSnapshot[] {
  const next = list.filter((item) => item.id !== snap.id);
  next.push(snap);
  next.sort((a, b) => compare(a.id, b.id));
  return next;
}

export function makeMonthSnapshot(
  monthId: string,
  txs: Transaction[],
  income: number,
  categories: Category[],
): WheelSnapshot | null {
  const bounds = monthBounds(monthId);
  if (!bounds) return null;
  return snapshotFromSpend(
    monthId,
    "month",
    formatMonthLabel(monthId),
    bounds.startIso,
    bounds.endIso,
    1,
    spendFromTransactions(txsInMonth(txs, monthId)),
    income,
    categories,
  );
}

/**
 * Quarter totals come from saved months first. Purchases are only the fallback
 * when no month cards exist, so deleting June cannot resurrect June from leftover txs.
 */
export function makeQuarterSnapshot(
  quarterId: string,
  txs: Transaction[],
  monthHistory: WheelSnapshot[],
  income: number,
  categories: Category[],
): WheelSnapshot | null {
  const parsed = parseQuarterId(quarterId);
  if (!parsed) return null;
  const months = monthHistory.filter((item) => quarterIdFromMonthId(item.id) === quarterId);
  const spent = months.length ? spendFromSnapshots(months) : spendFromTransactions(txsInQuarter(txs, quarterId));
  return snapshotFromSpend(
    quarterId,
    "quarter",
    parsed.label,
    parsed.startIso,
    parsed.endIso,
    3,
    spent,
    income,
    categories,
  );
}

/** Year totals come from saved quarters, then months, then purchases. */
export function makeYearSnapshot(
  year: number,
  txs: Transaction[],
  quarterHistory: WheelSnapshot[],
  monthHistory: WheelSnapshot[],
  income: number,
  categories: Category[],
): WheelSnapshot | null {
  const yearId = String(year);
  const bounds = yearBounds(year);
  const quarters = quarterHistory.filter((item) => quarterYear(item.id) === year);
  const months = monthHistory.filter((item) => parseMonthId(item.id)?.year === year);
  const spent = quarters.length
    ? spendFromSnapshots(quarters)
    : months.length
      ? spendFromSnapshots(months)
      : spendFromTransactions(txsInYear(txs, year));
  if (!hasSpend(spent) && !quarters.length && !months.length) return null;
  return snapshotFromSpend(yearId, "year", yearId, bounds.startIso, bounds.endIso, 12, spent, income, categories);
}

// ---------------------------------------------------------------------------
// Look up a saved period
// ---------------------------------------------------------------------------

export function findSnapshot(lists: Array<WheelSnapshot[] | null | undefined>, periodId: string): WheelSnapshot | undefined {
  if (!periodId) return undefined;
  for (const list of lists) {
    const exact = (list ?? []).find((item) => item.id === periodId);
    if (exact) return exact;
  }
  return undefined;
}

export function snapshotsForScale(
  scale: HistoryScale,
  pack: Pick<HistoryPack, "monthHistory" | "quarterHistory" | "yearHistory" | "previousSnapshot">,
): WheelSnapshot[] {
  const list =
    scale === "year" ? pack.yearHistory : scale === "quarter" ? pack.quarterHistory : pack.monthHistory;
  const known = new Set(list.map((item) => item.id));
  const orphan = pack.previousSnapshot;
  if (orphan && orphan.scale === scale && !known.has(orphan.id)) return [...list, orphan];
  return list;
}

// ---------------------------------------------------------------------------
// Draw a saved period the same way as the live wheel (frozen snapshot numbers)
// ---------------------------------------------------------------------------

export function historySlices(snap: WheelSnapshot, liveCategories: Category[]): HistorySlice[] {
  return snap.categories
    .map((c) => {
      const current = liveCategories.find((item) => item.id === c.id);
      const envelope = c.budgetedMonthly * snap.periodMonths;
      return {
        id: c.id,
        name: current?.name ?? c.name,
        color: current?.color ?? c.color,
        isCustom: current?.isCustom ?? false,
        budgeted: c.budgetedMonthly,
        order: current?.order ?? 0,
        hidden: false,
        spent: c.spent,
        envelope,
        remaining: envelope - c.spent,
      };
    })
    .filter((c) => c.envelope > 0.009 || c.spent > 0.009);
}

export function snapshotSpentTotal(snap: WheelSnapshot): number {
  return snap.categories.reduce((sum, cat) => sum + cat.spent, 0);
}

// ---------------------------------------------------------------------------
// Delete a saved period
// ---------------------------------------------------------------------------

function withoutIds(list: WheelSnapshot[], ids: Set<string>): WheelSnapshot[] {
  return list.filter((item) => !ids.has(item.id));
}

function replaceInList(list: WheelSnapshot[], snap: WheelSnapshot, compare: (a: string, b: string) => number): WheelSnapshot[] {
  return upsertSnapshot(list, snap, compare);
}

function dropEmpty(list: WheelSnapshot[], id: string): WheelSnapshot[] {
  return list.filter((item) => item.id !== id || snapshotHasSpend(item));
}

/** Rebuild a quarter that already exists, using the months that are still saved. */
function refreshQuarter(pack: HistoryPack, quarterId: string, income: number, categories: Category[]): HistoryPack {
  if (!pack.quarterHistory.some((item) => item.id === quarterId)) return pack;
  const snap = makeQuarterSnapshot(quarterId, pack.transactions, pack.monthHistory, income, categories);
  if (!snap || !snapshotHasSpend(snap)) {
    return { ...pack, quarterHistory: pack.quarterHistory.filter((item) => item.id !== quarterId) };
  }
  return { ...pack, quarterHistory: dropEmpty(replaceInList(pack.quarterHistory, snap, compareQuarterId), quarterId) };
}

/** Rebuild a year that already exists, using the quarters/months that are still saved. */
function refreshYear(pack: HistoryPack, year: number, income: number, categories: Category[]): HistoryPack {
  const yearId = String(year);
  if (!pack.yearHistory.some((item) => item.id === yearId)) return pack;
  const snap = makeYearSnapshot(year, pack.transactions, pack.quarterHistory, pack.monthHistory, income, categories);
  if (!snap || !snapshotHasSpend(snap)) {
    return { ...pack, yearHistory: pack.yearHistory.filter((item) => item.id !== yearId) };
  }
  return { ...pack, yearHistory: dropEmpty(replaceInList(pack.yearHistory, snap, (a, b) => Number(a) - Number(b)), yearId) };
}

export function deleteHistory(
  pack: HistoryPack,
  ids: string[],
  opts: HistoryDeleteOpts,
  income: number,
  categories: Category[],
): HistoryPack {
  const wanted = [...new Set(ids.filter(Boolean))];
  const selected = wanted
    .map((id) => findSnapshot([pack.monthHistory, pack.quarterHistory, pack.yearHistory, pack.previousSnapshot ? [pack.previousSnapshot] : []], id))
    .filter((snap): snap is WheelSnapshot => Boolean(snap));
  if (!selected.length) return pack;

  const dropIds = new Set(selected.map((snap) => snap.id));
  let next: HistoryPack = {
    monthHistory: withoutIds(pack.monthHistory, dropIds),
    quarterHistory: withoutIds(pack.quarterHistory, dropIds),
    yearHistory: withoutIds(pack.yearHistory, dropIds),
    previousSnapshot: pack.previousSnapshot,
    transactions: pack.transactions,
  };

  // Cascade also removes the purchases so parent purchase lists stay in sync.
  const dropTx = new Set<string>();
  if (opts.cascadeQuarters || opts.cascadeYears) {
    for (const snap of selected.filter((item) => item.scale === "month")) {
      for (const tx of txsInSnapshot(snap, pack.transactions)) dropTx.add(tx.id);
    }
  }
  if (opts.cascadeYears) {
    for (const snap of selected.filter((item) => item.scale === "quarter")) {
      for (const tx of txsInSnapshot(snap, pack.transactions)) dropTx.add(tx.id);
    }
  }
  if (dropTx.size) {
    next = { ...next, transactions: next.transactions.filter((tx) => !dropTx.has(tx.id)) };
  }

  if (opts.cascadeQuarters) {
    const quarters = new Set<string>();
    for (const snap of selected) {
      if (snap.scale === "month") {
        const qid = quarterIdFromMonthId(snap.id);
        if (qid) quarters.add(qid);
      }
    }
    for (const qid of quarters) next = refreshQuarter(next, qid, income, categories);
  }

  if (opts.cascadeYears) {
    const years = new Set<number>();
    for (const snap of selected) {
      if (snap.scale === "month") {
        const year = parseMonthId(snap.id)?.year;
        if (year) years.add(year);
      } else if (snap.scale === "quarter") {
        const year = quarterYear(snap.id);
        if (year) years.add(year);
      }
    }
    for (const year of years) next = refreshYear(next, year, income, categories);
  }

  const prev = pack.previousSnapshot;
  const prevStill = prev
    ? findSnapshot([next.monthHistory, next.quarterHistory, next.yearHistory], prev.id)
    : undefined;
  next = {
    ...next,
    previousSnapshot:
      prevStill && prevStill.scale === prev?.scale
        ? prevStill
        : (next.monthHistory.at(-1) ?? next.quarterHistory.at(-1) ?? next.yearHistory.at(-1) ?? null),
  };
  return next;
}

// ---------------------------------------------------------------------------
// Keep archives in sync when a single purchase is removed
// ---------------------------------------------------------------------------

function subtractFromSnap(snap: WheelSnapshot, tx: Transaction): WheelSnapshot {
  return {
    ...snap,
    categories: snap.categories.map((cat) =>
      cat.id === tx.categoryId ? { ...cat, spent: Math.max(0, Math.round((cat.spent - tx.amount) * 100) / 100) } : cat,
    ),
  };
}

/** One category color, on every saved period. */
export function paintCategoryColor(pack: HistoryPack, id: string, color: string): HistoryPack {
  if (!id) return pack;
  const paint = (snap: WheelSnapshot): WheelSnapshot => ({
    ...snap,
    categories: snap.categories.map((cat) => (cat.id === id ? { ...cat, color } : cat)),
  });
  return {
    ...pack,
    monthHistory: pack.monthHistory.map(paint),
    quarterHistory: pack.quarterHistory.map(paint),
    yearHistory: pack.yearHistory.map(paint),
    previousSnapshot: pack.previousSnapshot ? paint(pack.previousSnapshot) : null,
    transactions: pack.transactions,
  };
}

export function removePurchaseFromArchives(pack: HistoryPack, tx: Transaction): HistoryPack {
  const monthId = monthIdFromTimestamp(tx.createdAt);
  const quarterId = monthId ? quarterIdFromMonthId(monthId) : "";
  const yearId = monthId ? String(parseMonthId(monthId)?.year ?? "") : "";
  const touch = (snap: WheelSnapshot): WheelSnapshot => {
    if (snap.id === monthId || snap.id === quarterId || snap.id === yearId) return subtractFromSnap(snap, tx);
    return snap;
  };
  return {
    ...pack,
    monthHistory: pack.monthHistory.map(touch),
    quarterHistory: pack.quarterHistory.map(touch),
    yearHistory: pack.yearHistory.map(touch),
    previousSnapshot: pack.previousSnapshot ? touch(pack.previousSnapshot) : null,
    transactions: pack.transactions,
  };
}

export function historyCompare(scale: HistoryScale): (a: string, b: string) => number {
  if (scale === "month") return compareMonthId;
  if (scale === "quarter") return compareQuarterId;
  return (a, b) => Number(a) - Number(b);
}
