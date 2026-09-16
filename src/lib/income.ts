import type { Income, IncomeDraft, IncomeSource, TaxBreakdown, Transaction, WheelScale } from "../types.ts";
import { EXTRA_FUNDS_ID } from "./categories.ts";
import { estimateStateIncomeTax, findState } from "./states.ts";
import { clampMoney, uid } from "./money.ts";

const NAMED_ORDINALS = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];

export function incomeOrdinal(n: number): string {
  if (n >= 1 && n < NAMED_ORDINALS.length) return NAMED_ORDINALS[n];
  const mod100 = n % 100;
  const mod10 = n % 10;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? "th" : mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

export const ADDED_FUNDS_SOURCE_ID = "inc_added_funds";

export function listedSources(income: Income | null | undefined): IncomeSource[] {
  return rawSources(income).filter((s) => s.id !== ADDED_FUNDS_SOURCE_ID);
}

/** Every stored source, including the retired Extra Funds income row. */
export function rawSources(income: Income | null | undefined): IncomeSource[] {
  if (!income) return [];
  if (income.sources?.length) return income.sources;
  return [
    {
      id: "inc_primary",
      kind: "primary",
      type: income.type,
      salaryPeriod: income.salaryPeriod,
      salaryAmount: income.salaryAmount,
      hourlyWage: income.hourlyWage,
      hoursPerWeek: income.hoursPerWeek,
      monthlyGross: income.monthlyGross,
      monthlyTakeHome: income.monthlyTakeHome,
      estimatedTaxAnnual: income.estimatedTaxAnnual,
    },
  ];
}

export function incomeSlotLabel(n: number): string {
  return `${incomeOrdinal(n)} Income`;
}

export function nextIncomeNumber(income: Income | null | undefined): number {
  return listedSources(income).length + 1;
}

export function isSideSource(source: Pick<IncomeSource, "kind" | "type">): boolean {
  return source.kind === "side" || source.type === "side";
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function isPayWeekday(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6;
}

export function sourceTypeLabel(source: IncomeSource): string {
  if (isSideSource(source)) return "Side · after tax";
  if (source.type === "hourly") {
    if (isPayWeekday(source.payWeekday)) return `Hourly · ${WEEKDAYS[source.payWeekday]}s`;
    return "Hourly";
  }
  return source.salaryPeriod === "monthly" ? "Monthly salary" : "Salary";
}

/** How many times `weekday` (0=Sun) lands in a calendar month. Month is 0-indexed. */
export function countWeekdayInMonth(year: number, monthIndex: number, weekday: number): number {
  const first = new Date(year, monthIndex, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const firstHit = 1 + offset;
  const lastDate = new Date(year, monthIndex + 1, 0).getDate();
  if (firstHit > lastDate) return 0;
  return Math.floor((lastDate - firstHit) / 7) + 1;
}

export function countWeekdayInMonths(
  start: Date,
  monthCount: number,
  weekday: number,
): number {
  let n = 0;
  for (let i = 0; i < monthCount; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    n += countWeekdayInMonth(d.getFullYear(), d.getMonth(), weekday);
  }
  return n;
}

export function weeklyTakeHome(monthly: number): number {
  return clampMoney((monthly * 12) / 52);
}

function sourceTakeHomeForMonth(source: IncomeSource, year: number, monthIndex: number): number {
  if (source.type === "hourly" && isPayWeekday(source.payWeekday)) {
    const weeks = countWeekdayInMonth(year, monthIndex, source.payWeekday);
    return clampMoney(weeklyTakeHome(source.monthlyTakeHome) * weeks);
  }
  return clampMoney(source.monthlyTakeHome);
}

/** Typical-month take-home scaled to the actual paydays in this calendar month. Salary is unchanged. */
export function takeHomeForMonth(income: Income | null | undefined, year: number, monthIndex: number): number {
  const sources = listedSources(income);
  if (!sources.length) return clampMoney(income?.monthlyTakeHome ?? 0);
  return clampMoney(sources.reduce((sum, s) => sum + sourceTakeHomeForMonth(s, year, monthIndex), 0));
}

export function takeHomeForMonths(income: Income | null | undefined, start: Date, monthCount: number): number {
  let sum = 0;
  for (let i = 0; i < monthCount; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    sum += takeHomeForMonth(income, d.getFullYear(), d.getMonth());
  }
  return clampMoney(sum);
}

export function takeHomeForScale(
  income: Income | null | undefined,
  scale: WheelScale,
  now = new Date(),
): number {
  if (scale === "year") return takeHomeForMonths(income, new Date(now.getFullYear(), 0, 1), 12);
  if (scale === "quarter") {
    const qStart = Math.floor(now.getMonth() / 3) * 3;
    return takeHomeForMonths(income, new Date(now.getFullYear(), qStart, 1), 3);
  }
  return takeHomeForMonth(income, now.getFullYear(), now.getMonth());
}

/**
 * Extra Funds is not an income source. Turn the old `inc_added_funds` row
 * into Extra Funds `kind:"in"` activity and drop it from Settings.
 */
export function peelAddedFunds(
  income: Income | null,
  transactions: Transaction[],
): { income: Income | null; transactions: Transaction[] } {
  if (!income) return { income, transactions };
  const sources = income.sources?.length ? income.sources : rawSources(income);
  const added = sources.find((s) => s.id === ADDED_FUNDS_SOURCE_ID);
  if (!added) return { income, transactions };
  const amount = clampMoney(added.monthlyTakeHome);
  const nextSources = sources.filter((s) => s.id !== ADDED_FUNDS_SOURCE_ID);
  const nextIncome: Income = {
    ...income,
    monthlyGross: clampMoney(income.monthlyGross - amount),
    monthlyTakeHome: clampMoney(income.monthlyTakeHome - amount),
    sources: nextSources,
  };
  const existingIn = transactions
    .filter((t) => t.kind === "in" && t.categoryId === EXTRA_FUNDS_ID)
    .reduce((sum, t) => sum + t.amount, 0);
  const missing = clampMoney(amount - existingIn);
  const txs =
    missing > 0.009
      ? [
          ...transactions,
          {
            id: uid("tx"),
            categoryId: EXTRA_FUNDS_ID,
            amount: missing,
            createdAt: Date.now(),
            kind: "in" as const,
          },
        ]
      : transactions;
  return { income: nextIncome, transactions: txs };
}

export function normalizeSourceKinds(sources: IncomeSource[]): IncomeSource[] {
  let primarySet = false;
  return sources.map((s) => {
    if (isSideSource(s)) return { ...s, kind: "side", type: "side" };
    if (!primarySet) {
      primarySet = true;
      return { ...s, kind: "primary" };
    }
    return { ...s, kind: "second" };
  });
}

/** 2026 IRS inflation-adjusted figures (single filer). */
const STANDARD_DEDUCTION_2026_SINGLE = 16_100;
const SS_WAGE_BASE_2026 = 184_500;

const FEDERAL_BRACKETS_2026_SINGLE: Array<[number, number]> = [
  [12_400, 0.1],
  [50_400, 0.12],
  [105_700, 0.22],
  [201_775, 0.24],
  [256_225, 0.32],
  [640_600, 0.35],
  [Number.POSITIVE_INFINITY, 0.37],
];

function federalIncomeTax(taxable: number): number {
  if (taxable <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const [cap, rate] of FEDERAL_BRACKETS_2026_SINGLE) {
    const slice = Math.min(taxable, cap) - prev;
    if (slice > 0) tax += slice * rate;
    if (taxable <= cap) break;
    prev = cap;
  }
  return tax;
}

function ficaTax(annualGross: number): number {
  const oasdi = Math.min(annualGross, SS_WAGE_BASE_2026) * 0.062;
  const medicare = annualGross * 0.0145;
  const extraMedicare = Math.max(0, annualGross - 200_000) * 0.009;
  return oasdi + medicare + extraMedicare;
}

export function monthlyGrossFromDraft(draft: IncomeDraft): number {
  if (draft.slot === "side") {
    return clampMoney(draft.monthlyTakeHomeOverride ?? draft.salaryAmount ?? 0);
  }
  if (draft.type === "salary") {
    const amount = draft.salaryAmount ?? 0;
    if (draft.salaryPeriod === "monthly") return clampMoney(amount);
    return clampMoney(amount / 12);
  }
  if (draft.type === "hourly") {
    const wage = draft.hourlyWage ?? 0;
    const hours = draft.hoursPerWeek ?? 0;
    return clampMoney((wage * hours * 52) / 12);
  }
  return 0;
}

export function estimateTaxes(monthlyGross: number, stateCode: string): TaxBreakdown {
  const annualGross = monthlyGross * 12;
  const standardDeduction = STANDARD_DEDUCTION_2026_SINGLE;
  const taxableIncome = Math.max(0, annualGross - standardDeduction);
  const federal = federalIncomeTax(taxableIncome);
  const fica = ficaTax(annualGross);
  const stateInfo = findState(stateCode);
  const state = stateInfo ? estimateStateIncomeTax(annualGross, stateInfo) : 0;
  const stateRate = annualGross > 0 ? state / annualGross : 0;
  const annualTax = federal + fica + state;
  const monthlyTakeHome = clampMoney((annualGross - annualTax) / 12);
  return {
    monthlyGross: clampMoney(monthlyGross),
    annualGross: clampMoney(annualGross),
    standardDeduction,
    taxableIncome: clampMoney(taxableIncome),
    federal: clampMoney(federal),
    fica: clampMoney(fica),
    state: clampMoney(state),
    stateRate,
    annualTax: clampMoney(annualTax),
    monthlyTakeHome,
  };
}

export function combineIncome(stateCode: string, sources: IncomeSource[]): Income {
  const w2 = sources.filter((s) => s.kind !== "side" && s.type !== "side");
  const side = sources.filter((s) => s.kind === "side" || s.type === "side");
  const w2Gross = w2.reduce((sum, s) => sum + s.monthlyGross, 0);
  const tax = estimateTaxes(w2Gross, stateCode);
  const sideHome = side.reduce((sum, s) => sum + s.monthlyTakeHome, 0);
  const sideGross = side.reduce((sum, s) => sum + s.monthlyGross, 0);
  const keepTakeHome = w2.length <= 1 || w2.some((s) => s.takeHomeOverridden);
  const adjusted = sources.map((s) => {
    if (s.kind === "side" || s.type === "side" || w2Gross <= 0 || keepTakeHome) return s;
    const share = s.monthlyGross / w2Gross;
    return {
      ...s,
      monthlyTakeHome: clampMoney(tax.monthlyTakeHome * share),
      estimatedTaxAnnual: clampMoney(tax.annualTax * share),
    };
  });
  const w2Home = adjusted
    .filter((s) => s.kind !== "side" && s.type !== "side")
    .reduce((sum, s) => sum + s.monthlyTakeHome, 0);
  const head = adjusted.find((s) => s.kind === "primary") ?? adjusted[0];
  return {
    type: head?.type === "side" ? "salary" : (head?.type ?? "salary"),
    salaryPeriod: head?.salaryPeriod,
    salaryAmount: head?.salaryAmount,
    hourlyWage: head?.hourlyWage,
    hoursPerWeek: head?.hoursPerWeek,
    state: stateCode,
    monthlyGross: clampMoney(w2Gross + sideGross),
    monthlyTakeHome: clampMoney(w2Home + sideHome),
    estimatedTaxAnnual: tax.annualTax,
    sources: adjusted,
  };
}

export function finalizeIncome(draft: IncomeDraft): Income | null {
  if (draft.slot === "side") {
    const takeHome = clampMoney(draft.monthlyTakeHomeOverride ?? draft.salaryAmount ?? 0);
    if (takeHome <= 0 || !draft.state) return null;
    return {
      type: "side",
      state: draft.state,
      monthlyGross: takeHome,
      monthlyTakeHome: takeHome,
      estimatedTaxAnnual: 0,
      sources: [],
    };
  }
  if (!draft.type || draft.type === "side" || !draft.state) return null;
  const monthlyGross = monthlyGrossFromDraft(draft);
  if (monthlyGross <= 0) return null;
  const tax = estimateTaxes(monthlyGross, draft.state);
  const monthlyTakeHome = clampMoney(draft.monthlyTakeHomeOverride ?? tax.monthlyTakeHome);
  return {
    type: draft.type,
    salaryPeriod: draft.salaryPeriod,
    salaryAmount: draft.salaryAmount,
    hourlyWage: draft.hourlyWage,
    hoursPerWeek: draft.hoursPerWeek,
    state: draft.state,
    monthlyGross,
    monthlyTakeHome,
    estimatedTaxAnnual: tax.annualTax,
    sources: [],
  };
}
