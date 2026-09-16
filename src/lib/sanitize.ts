import { createDefaultCategories, ensureDefaultCategories, retireDebtPayments } from "./categories.ts";
import { clampMoney } from "./money.ts";
import { MONTH_ID_RE, QUARTER_ID_RE, YEAR_ID_RE } from "./quarter.ts";
import type {
  Category,
  HistoryScale,
  Income,
  IncomeSource,
  PersistedState,
  ReviewPromptState,
  ThemePref,
  Transaction,
  WheelSnapshot,
} from "../types.ts";

const SAFE_ID = /^[A-Za-z0-9_:-]{1,64}$/;
const SAFE_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function safeColor(value: unknown, fallback = "#F0C94D"): string {
  return typeof value === "string" && SAFE_COLOR.test(value) ? value : fallback;
}

export function safeId(value: unknown, fallback: string): string {
  return typeof value === "string" && SAFE_ID.test(value) ? value : fallback;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clipName(value: unknown, fallback = "Category"): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, 40);
  return trimmed || fallback;
}

function sanitizeSource(raw: unknown, index: number): IncomeSource | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = o.type === "hourly" ? "hourly" : o.type === "side" ? "side" : o.type === "salary" ? "salary" : null;
  if (!type) return null;
  const kind = o.kind === "second" || o.kind === "side" || o.kind === "primary" ? o.kind : "primary";
  return {
    id: safeId(o.id, `inc_${index}`),
    kind,
    type,
    salaryPeriod: o.salaryPeriod === "monthly" ? "monthly" : o.salaryPeriod === "annual" ? "annual" : undefined,
    salaryAmount: finiteNumber(o.salaryAmount),
    hourlyWage: finiteNumber(o.hourlyWage),
    hoursPerWeek: finiteNumber(o.hoursPerWeek),
    monthlyGross: clampMoney(finiteNumber(o.monthlyGross)),
    monthlyTakeHome: clampMoney(finiteNumber(o.monthlyTakeHome)),
    estimatedTaxAnnual: clampMoney(finiteNumber(o.estimatedTaxAnnual)),
    takeHomeOverridden: Boolean(o.takeHomeOverridden),
    payWeekday: sanitizePayWeekday(o.payWeekday),
  };
}

function sanitizePayWeekday(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 6) return undefined;
  return value;
}

function sanitizeIncome(raw: unknown): Income | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = o.type === "hourly" ? "hourly" : o.type === "side" ? "side" : o.type === "salary" ? "salary" : null;
  if (!type || typeof o.state !== "string" || !o.state) return null;
  const sources = Array.isArray(o.sources)
    ? o.sources.map(sanitizeSource).filter((s): s is IncomeSource => s !== null)
    : [];
  return {
    type,
    salaryPeriod: o.salaryPeriod === "monthly" ? "monthly" : o.salaryPeriod === "annual" ? "annual" : undefined,
    salaryAmount: finiteNumber(o.salaryAmount),
    hourlyWage: finiteNumber(o.hourlyWage),
    hoursPerWeek: finiteNumber(o.hoursPerWeek),
    state: o.state.slice(0, 2).toUpperCase(),
    monthlyGross: clampMoney(finiteNumber(o.monthlyGross)),
    monthlyTakeHome: clampMoney(finiteNumber(o.monthlyTakeHome)),
    estimatedTaxAnnual: clampMoney(finiteNumber(o.estimatedTaxAnnual)),
    sources,
  };
}

function sanitizeCategory(raw: unknown, index: number): Category | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = safeId(o.id, `cat_${index + 1}`);
  return {
    id,
    name: clipName(o.name),
    isCustom: Boolean(o.isCustom),
    budgeted: clampMoney(finiteNumber(o.budgeted)),
    color: safeColor(o.color),
    order: Math.max(0, Math.round(finiteNumber(o.order, index))),
    hidden: Boolean(o.hidden),
  };
}

function sanitizeTransaction(raw: unknown, index: number): Transaction | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const categoryId = safeId(o.categoryId, "");
  const amount = clampMoney(finiteNumber(o.amount));
  if (!categoryId || amount <= 0) return null;
  return {
    id: safeId(o.id, `tx_${index}`),
    categoryId,
    amount,
    createdAt: Math.max(0, finiteNumber(o.createdAt, Date.now())),
    kind: o.kind === "in" ? "in" : "out",
  };
}

function inferHistoryScale(raw: Record<string, unknown>, id: string): HistoryScale {
  if (raw.scale === "month" || raw.scale === "quarter" || raw.scale === "year") return raw.scale;
  if (MONTH_ID_RE.test(id)) return "month";
  if (YEAR_ID_RE.test(id)) return "year";
  return "quarter";
}

function defaultPeriodMonths(scale: HistoryScale): number {
  if (scale === "year") return 12;
  if (scale === "month") return 1;
  return 3;
}

function sanitizeTheme(value: unknown): ThemePref {
  return value === "light" || value === "system" ? value : "dark";
}

function sanitizeReview(value: unknown): ReviewPromptState {
  return value === "shown" || value === "rated" || value === "declined" || value === "never"
    ? value
    : "not_asked";
}

function sanitizeDay(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function sanitizeSnapshot(raw: unknown): WheelSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rawId = typeof o.id === "string" ? o.id : typeof o.quarterId === "string" ? o.quarterId : "";
  const id = rawId.slice(0, 16);
  if (!id) return null;
  const scale = inferHistoryScale(o, id);
  const cats = Array.isArray(o.categories) ? o.categories : [];
  const fallbackMonths = defaultPeriodMonths(scale);
  return {
    id,
    scale,
    quarterId: typeof o.quarterId === "string" && o.quarterId ? o.quarterId.slice(0, 16) : id,
    label: clipName(o.label, scale === "month" ? "Past month" : scale === "year" ? "Past year" : "Past quarter"),
    startIso: typeof o.startIso === "string" ? o.startIso.slice(0, 10) : "",
    endIso: typeof o.endIso === "string" ? o.endIso.slice(0, 10) : "",
    periodMonths: Math.min(12, Math.max(1, Math.round(finiteNumber(o.periodMonths, fallbackMonths)))),
    monthlyIncome: clampMoney(finiteNumber(o.monthlyIncome)),
    categories: cats.slice(0, 40).map((c, i) => {
      const row = (c ?? {}) as Record<string, unknown>;
      return {
        id: safeId(row.id, `snap_${i}`),
        name: clipName(row.name),
        color: safeColor(row.color),
        budgetedMonthly: clampMoney(finiteNumber(row.budgetedMonthly)),
        spent: clampMoney(finiteNumber(row.spent)),
      };
    }),
    capturedAt: Math.max(0, finiteNumber(o.capturedAt, Date.now())),
  };
}

export function sanitizeState(raw: unknown): PersistedState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  const cats = Array.isArray(o.categories)
    ? o.categories.map(sanitizeCategory).filter((c): c is Category => c !== null)
    : [];
  const txs = Array.isArray(o.transactions)
    ? o.transactions.map(sanitizeTransaction).filter((t): t is Transaction => t !== null)
    : [];
  const migrated = retireDebtPayments(cats, txs);
  const period = Math.round(finiteNumber(o.periodMonths, 3));
  const onboarded = Boolean(o.onboardingComplete);
  const legacyOnboarded = onboarded && o.tutorialComplete === undefined && o.firstSetupAt === undefined;
  return {
    version: 1,
    onboardingComplete: onboarded,
    income: sanitizeIncome(o.income),
    categories: ensureDefaultCategories(
      migrated.categories.length ? migrated.categories.slice(0, 40) : createDefaultCategories(),
    ),
    transactions: migrated.transactions,
    activeQuarterId: typeof o.activeQuarterId === "string" && QUARTER_ID_RE.test(o.activeQuarterId)
      ? o.activeQuarterId
      : "",
    activeMonthId: typeof o.activeMonthId === "string" && MONTH_ID_RE.test(o.activeMonthId)
      ? o.activeMonthId
      : "",
    periodMonths: Math.min(3, Math.max(1, period || 1)),
    previousSnapshot: sanitizeSnapshot(o.previousSnapshot),
    monthHistory: Array.isArray(o.monthHistory)
      ? o.monthHistory.map(sanitizeSnapshot).filter((s): s is WheelSnapshot => s !== null)
      : [],
    quarterHistory: Array.isArray(o.quarterHistory)
      ? o.quarterHistory.map(sanitizeSnapshot).filter((s): s is WheelSnapshot => s !== null)
      : [],
    yearHistory: Array.isArray(o.yearHistory)
      ? o.yearHistory.map(sanitizeSnapshot).filter((s): s is WheelSnapshot => s !== null)
      : [],
    wheelScale: o.wheelScale === "quarter" || o.wheelScale === "year" ? o.wheelScale : "month",
    homeChart: o.homeChart === "bars" ? "bars" : "wheel",
    theme: sanitizeTheme(o.theme),
    tutorialComplete: legacyOnboarded ? true : Boolean(o.tutorialComplete),
    tutorialReplayedAt: Math.max(0, finiteNumber(o.tutorialReplayedAt)),
    firstSetupAt: Math.max(0, finiteNumber(o.firstSetupAt, legacyOnboarded ? finiteNumber(o.updatedAt) : 0)),
    reviewPromptState: sanitizeReview(o.reviewPromptState),
    openDayCount: Math.max(0, Math.round(finiteNumber(o.openDayCount))),
    lastOpenDay: sanitizeDay(o.lastOpenDay),
    updatedAt: Math.max(0, finiteNumber(o.updatedAt)),
  };
}
