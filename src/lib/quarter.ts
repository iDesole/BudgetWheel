export interface QuarterInfo {
  id: string;
  year: number;
  quarter: number;
  label: string;
  start: Date;
  end: Date;
  startIso: string;
  endIso: string;
  monthsRemaining: number;
  monthNames: string;
}

export interface PeriodCursor {
  activeQuarterId: string;
  activeMonthId: string;
}

export interface PeriodAdvance {
  cursor: PeriodCursor;
  monthAdvanced: boolean;
  quarterAdvanced: boolean;
  clockSkew: boolean;
  migrated: boolean;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_ID_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const QUARTER_ID_RE = /^(\d{4})-Q([1-4])$/;
export const YEAR_ID_RE = /^(\d{4})$/;

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthIdFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function quarterIdFromDate(date: Date): string {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${quarter}`;
}

export function parseMonthId(id: string): { year: number; month: number } | null {
  const match = MONTH_ID_RE.exec(id);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function parseQuarterId(id: string): { year: number; quarter: number; label: string; startIso: string; endIso: string } | null {
  const match = QUARTER_ID_RE.exec(id);
  if (!match) return null;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  return {
    year,
    quarter,
    label: `Q${quarter} ${year}`,
    startIso: isoDate(start),
    endIso: isoDate(end),
  };
}

export function compareMonthId(a: string, b: string): number {
  const pa = parseMonthId(a);
  const pb = parseMonthId(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  return pa.year * 12 + pa.month - (pb.year * 12 + pb.month);
}

export function compareQuarterId(a: string, b: string): number {
  const pa = parseQuarterId(a);
  const pb = parseQuarterId(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  return pa.year * 4 + pa.quarter - (pb.year * 4 + pb.quarter);
}

export function quarterYear(id: string): number | null {
  return parseQuarterId(id)?.year ?? null;
}

export function monthIdFromTimestamp(ts: number): string | null {
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return monthIdFromDate(d);
}

export function quarterIdFromMonthId(monthId: string): string {
  const parsed = parseMonthId(monthId);
  if (!parsed) return "";
  const quarter = Math.floor((parsed.month - 1) / 3) + 1;
  return `${parsed.year}-Q${quarter}`;
}

export function formatMonthLabel(monthId: string): string {
  const parsed = parseMonthId(monthId);
  if (!parsed) return monthId;
  return `${MONTH_SHORT[parsed.month - 1]} ${parsed.year}`;
}

export function monthBounds(monthId: string): { startIso: string; endIso: string } | null {
  const parsed = parseMonthId(monthId);
  if (!parsed) return null;
  const start = new Date(parsed.year, parsed.month - 1, 1);
  const end = new Date(parsed.year, parsed.month, 0);
  return { startIso: isoDate(start), endIso: isoDate(end) };
}

export function yearBounds(year: number): { startIso: string; endIso: string } {
  return { startIso: `${year}-01-01`, endIso: `${year}-12-31` };
}

export function eachMonthId(fromInclusive: string, toExclusive: string): string[] {
  const start = parseMonthId(fromInclusive);
  const end = parseMonthId(toExclusive);
  if (!start || !end) return start ? [fromInclusive] : [];
  const out: string[] = [];
  let year = start.year;
  let month = start.month;
  const endKey = end.year * 12 + end.month;
  while (year * 12 + month < endKey) {
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (out.length > 48) break;
  }
  return out;
}

export function eachQuarterId(fromInclusive: string, toExclusive: string): string[] {
  const start = parseQuarterId(fromInclusive);
  const end = parseQuarterId(toExclusive);
  if (!start || !end) return start ? [fromInclusive] : [];
  const out: string[] = [];
  let year = start.year;
  let quarter = start.quarter;
  const endKey = end.year * 4 + end.quarter;
  while (year * 4 + quarter < endKey) {
    out.push(`${year}-Q${quarter}`);
    quarter += 1;
    if (quarter > 4) {
      quarter = 1;
      year += 1;
    }
    if (out.length > 24) break;
  }
  return out;
}

export function eachYearId(fromInclusive: number, toExclusive: number): string[] {
  if (!Number.isFinite(fromInclusive) || !Number.isFinite(toExclusive)) return [];
  const out: string[] = [];
  for (let year = fromInclusive; year < toExclusive && out.length < 16; year += 1) {
    out.push(String(year));
  }
  return out;
}

export function isSameMonth(ts: number, now: Date): boolean {
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export function isSameQuarter(ts: number, now: Date): boolean {
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && Math.floor(d.getMonth() / 3) === Math.floor(now.getMonth() / 3);
}

export function isSameYear(ts: number, now: Date): boolean {
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear();
}

export function getQuarter(date = new Date()): QuarterInfo {
  const year = date.getFullYear();
  const month = date.getMonth();
  const quarter = Math.floor(month / 3) + 1;
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  const monthsRemaining = startMonth + 3 - month;
  const names = MONTH_SHORT.slice(startMonth, startMonth + 3);
  return {
    id: `${year}-Q${quarter}`,
    year,
    quarter,
    label: `Q${quarter} ${year}`,
    start,
    end,
    startIso: isoDate(start),
    endIso: isoDate(end),
    monthsRemaining,
    monthNames: `${names[0]}–${names[2]}`,
  };
}

export function formatQuarterRange(startIso: string, endIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso) || !/^\d{4}-\d{2}-\d{2}$/.test(endIso)) return "";
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const startStr = start.toLocaleDateString("en-US", opts);
  const endStr = end.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${startStr} – ${endStr}`;
}

export function nextLocalMidnight(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
}

export function msUntilNextLocalMidnight(now = new Date()): number {
  return Math.max(250, nextLocalMidnight(now).getTime() - now.getTime());
}

/** Decide whether the stored month/quarter cursor must move forward. Never goes backward. */
export function advancePeriodCursor(stored: PeriodCursor, now: Date): PeriodAdvance {
  const currentQ = quarterIdFromDate(now);
  const currentM = monthIdFromDate(now);
  const storedQ = stored.activeQuarterId;
  const storedM = stored.activeMonthId;

  const qCmp = storedQ ? compareQuarterId(currentQ, storedQ) : 0;
  const mCmp = storedM ? compareMonthId(currentM, storedM) : 0;

  if (qCmp < 0 || mCmp < 0) {
    return {
      cursor: { activeQuarterId: storedQ || currentQ, activeMonthId: storedM || currentM },
      monthAdvanced: false,
      quarterAdvanced: false,
      clockSkew: true,
      migrated: false,
    };
  }

  return {
    cursor: { activeQuarterId: currentQ, activeMonthId: currentM },
    monthAdvanced: Boolean(storedM) && mCmp > 0,
    quarterAdvanced: Boolean(storedQ) && qCmp > 0,
    clockSkew: false,
    migrated: !storedQ || !storedM,
  };
}
