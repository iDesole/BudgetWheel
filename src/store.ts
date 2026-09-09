/**
 * App state, persistence, and the live wheel.
 *
 * Jobs, in order:
 *   1. In-memory UI (screen stack, selected slice, toasts, tour)
 *   2. History archives (thin wrappers over src/lib/history.ts)
 *   3. Persist — IndexedDB plus the Android widget JSON
 *   4. Mutations (income, Extra Funds adds, categories, purchases)
 *   5. Live wheel queries (period spend, slices, over-budget)
 *   6. Period rollover at local midnight
 *   7. Theme, walkthrough, and the 7-day Play review prompt
 *
 * The widget is the same budget. persist() absorbs widget JSON unless
 * skipAbsorb (local deletes). A newer widget copy can update income and
 * leftover Extra Funds; local transaction deletes still win.
 * Then IndexedDB write + pushBudgetToAndroid. Native merge keeps widget
 * purchases newer than priorUpdatedAt. Extra Funds is leftover take-home
 * plus cash-in activity — never a second income source, never assigned
 * budget spending.
 */
import { ensureDeviceSession, getCachedUser, type AuthUser } from "./auth.ts";
import { idbDel, idbGet, idbSet } from "./db.ts";
import {
  canHideCategory,
  compareCategories,
  createDefaultCategories,
  extraFundsAdded,
  EXTRA_FUNDS_ID,
  isFundsIn,
  isOutOfBudgetSpend,
  NOT_IN_BUDGET_ID,
  nextCustomColor,
  retireDebtPayments,
  syncExtraFunds,
  withExtraFundsPool,
} from "./lib/categories.ts";
import { combineIncome, estimateTaxes, finalizeIncome, listedSources, normalizeSourceKinds, peelAddedFunds } from "./lib/income.ts";
import { clampMoney, uid } from "./lib/money.ts";
import {
  advancePeriodCursor,
  compareMonthId,
  compareQuarterId,
  eachMonthId,
  eachQuarterId,
  eachYearId,
  getQuarter,
  isSameMonth,
  isSameQuarter,
  isSameYear,
  monthIdFromDate,
  msUntilNextLocalMidnight,
  parseMonthId,
  parseQuarterId,
  quarterIdFromDate,
  quarterIdFromMonthId,
  quarterYear,
} from "./lib/quarter.ts";
import { pullBudgetFromAndroid, pushBudgetToAndroid } from "./lib/android.ts";
import { nextOpenDay, reviewAfterChoice, reviewEligible } from "./lib/review.ts";
import { applyTheme } from "./lib/theme.ts";
import {
  deleteHistory,
  findSnapshot,
  historySlices,
  makeMonthSnapshot,
  makeQuarterSnapshot,
  makeYearSnapshot,
  paintCategoryColor,
  removePurchaseFromArchives,
  snapshotSpentTotal as spentOnSnapshot,
  snapshotsForScale,
  txsInMonth,
  txsInQuarter,
  txsInSnapshot,
  upsertSnapshot,
  type HistoryPack,
} from "./lib/history.ts";
import { safeColor, sanitizeState } from "./lib/sanitize.ts";
import type {
  Category,
  HistoryScale,
  Income,
  IncomeDraft,
  IncomeKind,
  IncomeSource,
  PersistedState,
  HomeChart,
  ReviewPromptState,
  Screen,
  ThemePref,
  Transaction,
  WheelScale,
  WheelSnapshot,
} from "./types.ts";

const LEGACY_STATE_KEY = "state";

function stateKey(userId?: string): string {
  return userId ? `state:${userId}` : LEGACY_STATE_KEY;
}

const listeners = new Set<() => void>();
let emitQueued = false;

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function refreshUi(): void {
  emit();
}

function emit(): void {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    emitQueued = false;
    for (const fn of listeners) fn();
  });
}

function emptyState(): PersistedState {
  const now = new Date();
  const q = getQuarter(now);
  return {
    version: 1,
    onboardingComplete: false,
    income: null,
    categories: createDefaultCategories(),
    transactions: [],
    activeQuarterId: q.id,
    activeMonthId: monthIdFromDate(now),
    periodMonths: q.monthsRemaining,
    previousSnapshot: null,
    monthHistory: [],
    quarterHistory: [],
    yearHistory: [],
    wheelScale: "month",
    homeChart: "wheel",
    theme: "dark",
    tutorialComplete: false,
    tutorialReplayedAt: 0,
    firstSetupAt: 0,
    reviewPromptState: "not_asked",
    openDayCount: 0,
    lastOpenDay: "",
    updatedAt: 0,
  };
}

// ---------------------------------------------------------------------------
// In-memory UI session (not persisted except via explicit mutations below)
// ---------------------------------------------------------------------------

export const draft: IncomeDraft = {};

export let screen: Screen = { id: "welcome" };
export let stack: Screen[] = [];
export let toastMessage: string | null = null;
export let selectedSliceId: string | null = null;
export let stateFilter = "";
export let sessionUser: AuthUser | null = null;
export let tourStep: number | null = null;
export let tourReplay = false;
export let reviewPromptVisible = false;
let toastTimer = 0;
let starting = false;
let persistTail: Promise<void> = Promise.resolve();
let applyingHistory = false;
let periodTimer = 0;

export let state: PersistedState = emptyState();

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function writeHistory(mode: "push" | "replace"): void {
  try {
    const payload = { depth: stack.length, id: screen.id };
    if (mode === "push") window.history.pushState(payload, "");
    else window.history.replaceState(payload, "");
  } catch {
    /* private mode / quota */
  }
}

export function canGoBack(): boolean {
  if (stack.length > 0) return true;
  if (!state.onboardingComplete && screen.id !== "welcome") return true;
  return state.onboardingComplete && screen.id !== "home" && screen.id !== "settings" && screen.id !== "past-quarter";
}

function tourBlocks(next: Screen): boolean {
  if (tourStep == null) return false;
  if (tourStep <= 3) return next.id !== "home";
  return next.id !== "settings";
}

export function go(next: Screen, opts?: { replace?: boolean }): void {
  if (tourBlocks(next)) return;
  if (!opts?.replace) stack.push(screen);
  screen = next;
  writeHistory(opts?.replace ? "replace" : "push");
  emit();
}

function applyBack(): void {
  const prev = stack.pop();
  if (prev) {
    screen = prev;
    emit();
    return;
  }
  if (state.onboardingComplete) {
    if (screen.id !== "home") {
      screen = { id: "home" };
      emit();
    }
    return;
  }
  if (screen.id !== "welcome") {
    screen = { id: "welcome" };
    emit();
  }
}

export function back(): void {
  if (applyingHistory) {
    applyBack();
    return;
  }
  let hist: { depth?: number } | null = null;
  try {
    hist = window.history.state as { depth?: number } | null;
  } catch {
    hist = null;
  }
  if (stack.length > 0 && hist && typeof hist.depth === "number" && hist.depth > 0) {
    const depth = stack.length;
    const id = screen.id;
    try {
      window.history.back();
      window.setTimeout(() => {
        if (stack.length === depth && screen.id === id) {
          applyBack();
          writeHistory("replace");
        }
      }, 200);
      return;
    } catch {
      /* fall through */
    }
  }
  applyBack();
  writeHistory("replace");
}

export function consumeBack(): boolean {
  if (tourStep != null) {
    void skipTour();
    return true;
  }
  if (reviewPromptVisible) {
    void resolveReview("later");
    return true;
  }
  const sheet = document.querySelector(".over-sheet");
  const colorPop = document.querySelector(".color-pop");
  const periodDrop = document.querySelector(".period-drop.is-open");
  if (sheet || colorPop || periodDrop) {
    sheet?.remove();
    colorPop?.remove();
    periodDrop?.classList.remove("is-open");
    return true;
  }
  if (canGoBack()) {
    applyBack();
    writeHistory("replace");
    return true;
  }
  return false;
}

export function handlePopState(): void {
  if (tourStep != null) {
    writeHistory("push");
    void skipTour();
    return;
  }
  if (reviewPromptVisible) {
    writeHistory("push");
    void resolveReview("later");
    return;
  }
  const sheet = document.querySelector(".over-sheet");
  const colorPop = document.querySelector(".color-pop");
  const periodDrop = document.querySelector(".period-drop.is-open");
  const tourLayer = document.querySelector(".tour-root");
  if (sheet || colorPop || periodDrop) {
    writeHistory("push");
    sheet?.remove();
    colorPop?.remove();
    periodDrop?.classList.remove("is-open");
    return;
  }
  if (tourLayer) {
    writeHistory("push");
    void skipTour();
    return;
  }
  applyingHistory = true;
  try {
    applyBack();
  } finally {
    applyingHistory = false;
  }
}

export function resetNav(next: Screen): void {
  if (tourBlocks(next)) return;
  stack = [];
  screen = next;
  writeHistory("replace");
  emit();
}

export function showToast(message: string): void {
  toastMessage = message;
  window.clearTimeout(toastTimer);
  const root = document.querySelector("#app");
  root?.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  root?.append(toast);
  toastTimer = window.setTimeout(() => {
    toastMessage = null;
    document.querySelector(".toast")?.remove();
  }, 2400);
}

export function setSelectedSlice(id: string | null): void {
  selectedSliceId = id;
  emit();
}

export function setStateFilter(value: string, opts?: { silent?: boolean }): void {
  stateFilter = value;
  if (!opts?.silent) emit();
}

export function updateDraft(patch: Partial<IncomeDraft>): void {
  Object.assign(draft, patch);
}

export function resetDraft(): void {
  for (const key of Object.keys(draft) as Array<keyof IncomeDraft>) {
    delete draft[key];
  }
}

export function loadDraftFromSource(sourceId: string): boolean {
  const income = state.income;
  const source = listedSources(income).find((s) => s.id === sourceId);
  if (!income || !source) return false;
  resetDraft();
  Object.assign(draft, {
    slot: source.kind,
    sourceId: source.id,
    type: source.type,
    salaryPeriod: source.salaryPeriod,
    salaryAmount: source.salaryAmount,
    hourlyWage: source.hourlyWage,
    hoursPerWeek: source.hoursPerWeek,
    state: income.state,
    monthlyTakeHomeOverride: source.monthlyTakeHome,
  });
  return true;
}

export function periodMultiplier(): number {
  if (state.wheelScale === "year") return 12;
  if (state.wheelScale === "quarter") return 3;
  return 1;
}

export function quarterlyBudget(monthly: number): number {
  return clampMoney(monthly * periodMultiplier());
}

// ---------------------------------------------------------------------------
// Category chrome (hide / color). Color also paints every history snapshot.
// ---------------------------------------------------------------------------

export async function setCategoryHidden(id: string, hidden: boolean): Promise<void> {
  if (!canHideCategory(id)) return;
  state.categories = state.categories.map((c) => (c.id === id ? { ...c, hidden } : c));
  await persist();
  emit();
}

export async function setCategoryColor(id: string, color: string): Promise<void> {
  const next = safeColor(color, "");
  if (!id || !next) return;
  state.categories = state.categories.map((c) => (c.id === id ? { ...c, color: next } : c));
  applyHistoryPack(paintCategoryColor(historyPack(), id, next));
  await persist();
  emit();
}

export async function setWheelScale(scale: WheelScale): Promise<void> {
  state.wheelScale = scale;
  await persist();
  emit();
}

export async function setHomeChart(chart: HomeChart): Promise<void> {
  if (tourStep != null && tourStep < 3) return;
  state.homeChart = chart === "bars" ? "bars" : "wheel";
  await persist();
  emit();
}

export async function toggleHomeChart(): Promise<void> {
  await setHomeChart(state.homeChart === "bars" ? "wheel" : "bars");
}

export async function setTheme(theme: ThemePref): Promise<void> {
  state.theme = theme === "light" || theme === "system" ? theme : "dark";
  applyTheme(state.theme);
  await persist();
  emit();
}

// ---------------------------------------------------------------------------
// Walkthrough (6 live-UI steps) and Play review prompt
// ---------------------------------------------------------------------------

export function startTour(opts?: { replay?: boolean }): void {
  tourReplay = Boolean(opts?.replay);
  tourStep = 1;
  selectedSliceId = null;
  reviewPromptVisible = false;
  if (state.homeChart !== "wheel") state.homeChart = "wheel";
  resetNav({ id: "home" });
}

export async function skipTour(): Promise<void> {
  if (tourStep == null) return;
  tourStep = null;
  tourReplay = false;
  state.tutorialComplete = true;
  await persist();
  emit();
}

export async function goTourStep(step: number): Promise<void> {
  const next = Math.min(6, Math.max(1, Math.round(step)));
  tourStep = next;
  if (next <= 3) {
    if (next === 1) {
      selectedSliceId = null;
      if (state.homeChart !== "wheel") state.homeChart = "wheel";
    }
    if (next === 2) {
      const slices = wheelCategories();
      const pick = slices.find((s) => s.id !== EXTRA_FUNDS_ID) ?? slices[0];
      if (pick) selectedSliceId = pick.id;
    }
    if (next === 3) selectedSliceId = null;
    if (screen.id !== "home") resetNav({ id: "home" });
    else emit();
    return;
  }
  if (screen.id !== "settings") resetNav({ id: "settings" });
  else emit();
}

export async function advanceTour(): Promise<void> {
  if (tourStep == null) return;
  if (tourStep >= 6) {
    await finishTour();
    return;
  }
  await goTourStep(tourStep + 1);
}

export async function finishTour(): Promise<void> {
  state.tutorialComplete = true;
  if (tourReplay) state.tutorialReplayedAt = Date.now();
  tourStep = null;
  tourReplay = false;
  if (state.homeChart !== "wheel") state.homeChart = "wheel";
  selectedSliceId = null;
  await persist();
  resetNav({ id: "home" });
}

function noteOpenDay(): boolean {
  const next = nextOpenDay(state);
  if (!next) return false;
  state.lastOpenDay = next.lastOpenDay;
  state.openDayCount = next.openDayCount;
  return true;
}

export function maybeOfferReview(): void {
  if (tourStep != null || reviewPromptVisible) return;
  if (!reviewEligible(state)) return;
  reviewPromptVisible = true;
  state.reviewPromptState = "shown";
  void persist();
  emit();
}

export async function resolveReview(choice: "rate" | "later" | "never"): Promise<void> {
  reviewPromptVisible = false;
  const next: ReviewPromptState = reviewAfterChoice(choice);
  state.reviewPromptState = next;
  await persist();
  emit();
}

export function allocatedMonthly(): number {
  return state.categories
    .filter((c) => !c.hidden && c.id !== EXTRA_FUNDS_ID)
    .reduce((sum, c) => sum + c.budgeted, 0);
}

export function allocatedPct(): number {
  const income = state.income?.monthlyTakeHome ?? 0;
  if (income <= 0) return 0;
  return (allocatedMonthly() / income) * 100;
}

function resumeTourIfNeeded(): void {
  if (!state.onboardingComplete || state.tutorialComplete || tourStep != null) return;
  startTour();
}

// ---------------------------------------------------------------------------
// History archives (thin wrappers — persist/emit stay here)
// ---------------------------------------------------------------------------

function currentIncome(): number {
  return state.income?.monthlyTakeHome ?? 0;
}

function historyPack(): HistoryPack {
  return {
    monthHistory: state.monthHistory ?? [],
    quarterHistory: state.quarterHistory ?? [],
    yearHistory: state.yearHistory ?? [],
    previousSnapshot: state.previousSnapshot,
    transactions: state.transactions,
  };
}

function applyHistoryPack(pack: HistoryPack): void {
  state.monthHistory = pack.monthHistory;
  state.quarterHistory = pack.quarterHistory;
  state.yearHistory = pack.yearHistory;
  state.previousSnapshot = pack.previousSnapshot;
  state.transactions = pack.transactions;
}

function archiveMonth(monthId: string): WheelSnapshot | null {
  const snap = makeMonthSnapshot(monthId, state.transactions, currentIncome(), state.categories);
  if (!snap) return null;
  state.monthHistory = upsertSnapshot(state.monthHistory ?? [], snap, compareMonthId);
  state.previousSnapshot = snap;
  return snap;
}

function archiveQuarter(quarterId: string): WheelSnapshot | null {
  const snap = makeQuarterSnapshot(
    quarterId,
    state.transactions,
    state.monthHistory ?? [],
    currentIncome(),
    state.categories,
  );
  if (!snap) return null;
  state.quarterHistory = upsertSnapshot(state.quarterHistory ?? [], snap, compareQuarterId);
  state.previousSnapshot = snap;
  return snap;
}

function archiveYear(year: number): WheelSnapshot | null {
  const snap = makeYearSnapshot(
    year,
    state.transactions,
    state.quarterHistory ?? [],
    state.monthHistory ?? [],
    currentIncome(),
    state.categories,
  );
  if (!snap) return null;
  state.yearHistory = upsertSnapshot(state.yearHistory ?? [], snap, (a, b) => Number(a) - Number(b));
  state.previousSnapshot = snap;
  return snap;
}

export function transactionsForSnapshot(snap: WheelSnapshot): Transaction[] {
  return txsInSnapshot(snap, state.transactions);
}

export function historyWheelSlices(snap: WheelSnapshot): ReturnType<typeof historySlices> {
  return historySlices(snap, state.categories);
}

export function findHistorySnapshot(periodId: string): WheelSnapshot | undefined {
  return findSnapshot(
    [state.monthHistory, state.quarterHistory, state.yearHistory, state.previousSnapshot ? [state.previousSnapshot] : []],
    periodId,
  );
}

export function snapshotSpentTotal(snap: WheelSnapshot): number {
  return spentOnSnapshot(snap);
}

export function historySnapsForScale(scale: HistoryScale): WheelSnapshot[] {
  return snapshotsForScale(scale, historyPack());
}

export async function deleteHistorySnapshots(
  ids: string[],
  opts?: { cascadeQuarters?: boolean; cascadeYears?: boolean },
): Promise<number> {
  const before = historyPack();
  const found = [...new Set(ids.filter(Boolean))].filter((id) =>
    findSnapshot([before.monthHistory, before.quarterHistory, before.yearHistory, before.previousSnapshot ? [before.previousSnapshot] : []], id),
  );
  if (!found.length) return 0;
  applyHistoryPack(deleteHistory(before, found, opts ?? {}, currentIncome(), state.categories));
  await persist({ skipAbsorb: true });
  emit();
  return found.length;
}

// ---------------------------------------------------------------------------
// Period rollover — close last month / quarter / year into history
// ---------------------------------------------------------------------------

export function rolloverIfNeeded(now = new Date()): boolean {
  const current = getQuarter(now);
  const storedMonth = state.activeMonthId;
  const storedQuarter = state.activeQuarterId;
  const advance = advancePeriodCursor(
    { activeQuarterId: storedQuarter, activeMonthId: storedMonth },
    now,
  );

  if (advance.clockSkew) return false;

  let changed = false;

  if (state.onboardingComplete && advance.monthAdvanced && storedMonth) {
    for (const monthId of eachMonthId(storedMonth, advance.cursor.activeMonthId)) {
      if (monthId === storedMonth || txsInMonth(state.transactions, monthId).length) archiveMonth(monthId);
    }
    changed = true;
    selectedSliceId = null;
  } else if (advance.monthAdvanced) {
    selectedSliceId = null;
    changed = true;
  }

  if (state.onboardingComplete && advance.quarterAdvanced && storedQuarter) {
    for (const quarterId of eachQuarterId(storedQuarter, advance.cursor.activeQuarterId)) {
      const hasMonths = (state.monthHistory ?? []).some((item) => quarterIdFromMonthId(item.id) === quarterId);
      if (quarterId === storedQuarter || txsInQuarter(state.transactions, quarterId).length || hasMonths) {
        archiveQuarter(quarterId);
      }
    }
    state.periodMonths = current.monthsRemaining;
    selectedSliceId = null;
    changed = true;
  } else if (advance.quarterAdvanced) {
    state.periodMonths = current.monthsRemaining;
    selectedSliceId = null;
    changed = true;
  }

  const storedYear = parseMonthId(storedMonth)?.year ?? parseQuarterId(storedQuarter)?.year;
  const nextYear = now.getFullYear();
  if (state.onboardingComplete && storedYear && storedYear < nextYear) {
    for (const yearId of eachYearId(storedYear, nextYear)) {
      archiveYear(Number(yearId));
    }
    changed = true;
  }

  if (
    state.activeQuarterId !== advance.cursor.activeQuarterId ||
    state.activeMonthId !== advance.cursor.activeMonthId
  ) {
    state.activeQuarterId = advance.cursor.activeQuarterId;
    state.activeMonthId = advance.cursor.activeMonthId;
    changed = true;
  }

  return changed;
}

export function schedulePeriodWatch(): void {
  window.clearTimeout(periodTimer);
  const wait = Math.min(msUntilNextLocalMidnight(), 6 * 60 * 60 * 1000);
  periodTimer = window.setTimeout(() => {
    void refreshOnForeground();
  }, wait);
}

// ---------------------------------------------------------------------------
// Persist + Android widget absorb
// ---------------------------------------------------------------------------

function absorbAndroidBudget(): boolean {
  const fromWidget = pullBudgetFromAndroid();
  if (!fromWidget) return false;
  if (!state.updatedAt && fromWidget.onboardingComplete) {
    applySaved(fromWidget);
    return true;
  }
  const have = new Set(state.transactions.map((tx) => tx.id));
  // New widget purchases only. Older missing ids are local deletes — never
  // put those back. If the widget wrote last, take its income/categories
  // but keep this device's transaction list.
  const extra = fromWidget.transactions.filter(
    (tx) => !have.has(tx.id) && tx.createdAt > state.updatedAt,
  );
  if (fromWidget.updatedAt > state.updatedAt) {
    applySaved({
      ...fromWidget,
      transactions: [...state.transactions, ...extra],
    });
    return true;
  }
  if (!extra.length) return false;
  state = {
    ...state,
    transactions: [...state.transactions, ...extra],
    updatedAt: Math.max(state.updatedAt, fromWidget.updatedAt),
  };
  return true;
}

/** Write IndexedDB, then push JSON to the widget. Absorb widget purchases first. */
async function writePersistedState(opts?: { skipAbsorb?: boolean }): Promise<void> {
  if (!opts?.skipAbsorb) absorbAndroidBudget();
  peelState();
  rolloverIfNeeded();
  const migrated = retireDebtPayments(state.categories, state.transactions);
  const priorUpdatedAt = state.updatedAt;
  state = {
    ...state,
    categories: syncExtraFunds(migrated.categories, state.income?.monthlyTakeHome ?? 0),
    transactions: migrated.transactions,
    updatedAt: Date.now(),
  };
  await idbSet(stateKey(sessionUser?.id), state);
  pushBudgetToAndroid(state, priorUpdatedAt);
}

function persist(opts?: { skipAbsorb?: boolean }): Promise<void> {
  const done = persistTail.then(
    () => writePersistedState(opts),
    () => writePersistedState(opts),
  );
  persistTail = done.then(
    () => undefined,
    () => undefined,
  );
  return done;
}

async function cacheLocal(): Promise<void> {
  await idbSet(stateKey(sessionUser?.id), state);
}

function applySaved(saved: PersistedState | null | undefined): void {
  const clean = sanitizeState(saved);
  const now = new Date();
  const q = getQuarter(now);
  state = clean ?? emptyState();
  peelState();
  applyTheme(state.theme);
  if (!state.activeQuarterId) {
    state = { ...state, activeQuarterId: q.id };
  }
  if (!state.activeMonthId) {
    state = { ...state, activeMonthId: monthIdFromDate(now) };
  }
}

function peelState(): void {
  const next = peelAddedFunds(state.income, state.transactions);
  state.income = next.income;
  state.transactions = next.transactions;
}

function routeAfterLoad(): void {
  stack = [];
  if (!state.onboardingComplete) {
    if (!state.income) screen = { id: "pay-type" };
    else if (allocatedMonthly() <= 0) screen = { id: "extra-income" };
    else screen = { id: "catalog", from: "onboarding" };
  } else {
    screen = { id: "home" };
  }
  writeHistory("replace");
  schedulePeriodWatch();
}

async function loadLocalData(): Promise<void> {
  if (!sessionUser) return;
  const local = sanitizeState(await idbGet<PersistedState>(stateKey(sessionUser.id)));
  const legacy = sanitizeState(await idbGet<PersistedState>(LEGACY_STATE_KEY));
  applySaved(local ?? legacy ?? null);
  const rolled = rolloverIfNeeded();
  const opened = noteOpenDay();
  if (rolled || local || legacy || opened) await persist();
  else await cacheLocal();
  if (legacy) await idbDel(LEGACY_STATE_KEY);
}

export async function hydrate(): Promise<void> {
  sessionUser = getCachedUser();
  if (!sessionUser) {
    state = emptyState();
    screen = { id: "welcome" };
    writeHistory("replace");
    emit();
    return;
  }
  await loadLocalData();
  if (absorbAndroidBudget()) await persist();
  else pushBudgetToAndroid(state);
  routeAfterLoad();
  resumeTourIfNeeded();
  maybeOfferReview();
  emit();
}

export async function startOnThisDevice(): Promise<void> {
  if (starting) return;
  starting = true;
  emit();
  try {
    sessionUser = ensureDeviceSession();
    await loadLocalData();
    if (absorbAndroidBudget()) await persist();
    else await persist();
    routeAfterLoad();
    resumeTourIfNeeded();
    maybeOfferReview();
  } finally {
    starting = false;
    emit();
  }
}

// ---------------------------------------------------------------------------
// Income + categories + purchases
// ---------------------------------------------------------------------------

function sourceFromIncome(income: Income, kind: IncomeKind): IncomeSource {
  const estimated = income.state ? estimateTaxes(income.monthlyGross, income.state).monthlyTakeHome : income.monthlyTakeHome;
  return {
    id: uid("inc"),
    kind,
    type: income.type,
    salaryPeriod: income.salaryPeriod,
    salaryAmount: income.salaryAmount,
    hourlyWage: income.hourlyWage,
    hoursPerWeek: income.hoursPerWeek,
    monthlyGross: income.monthlyGross,
    monthlyTakeHome: income.monthlyTakeHome,
    estimatedTaxAnnual: income.estimatedTaxAnnual,
    takeHomeOverridden: Math.abs(income.monthlyTakeHome - estimated) > 0.009,
  };
}

function withSources(stateCode: string, sources: IncomeSource[]): Income {
  return combineIncome(stateCode, normalizeSourceKinds(sources));
}

export async function saveIncomeFromDraft(): Promise<Income | null> {
  peelState();
  const slot = draft.slot ?? "primary";
  const incoming = finalizeIncome(draft);
  if (!incoming) return null;
  const current = listedSources(state.income);
  const editId = draft.sourceId && current.some((s) => s.id === draft.sourceId) ? draft.sourceId : null;
  let nextSources: IncomeSource[];
  if (!state.income || current.length === 0) {
    nextSources = [sourceFromIncome(incoming, "primary")];
  } else if (editId) {
    nextSources = current.map((s) => {
      if (s.id !== editId) return s;
      const kind = incoming.type === "side" ? "side" : s.kind === "primary" ? "primary" : "second";
      return { ...sourceFromIncome(incoming, kind), id: s.id };
    });
  } else {
    const kind = slot === "side" || incoming.type === "side" ? "side" : slot === "primary" ? "primary" : "second";
    nextSources = [...current, sourceFromIncome(incoming, kind)];
  }
  const stateCode = incoming.state || state.income?.state || "";
  state.income = withSources(stateCode, nextSources);
  if (!state.onboardingComplete) {
    const now = new Date();
    const q = getQuarter(now);
    state.activeQuarterId = q.id;
    state.activeMonthId = monthIdFromDate(now);
    state.periodMonths = q.monthsRemaining;
  }
  await persist();
  emit();
  return state.income;
}

export async function removeIncomeSource(id: string): Promise<void> {
  if (!state.income) return;
  peelState();
  const current = listedSources(state.income);
  if (current.length <= 1) return;
  const next = current.filter((s) => s.id !== id);
  if (!next.length || next.length === current.length) return;
  state.income = withSources(state.income.state, next);
  await persist();
  emit();
}

export async function setCategoryBudget(id: string, amount: number): Promise<void> {
  state.categories = state.categories.map((c) =>
    c.id === id ? { ...c, budgeted: clampMoney(amount) } : c,
  );
  await persist();
  emit();
}

export async function addCustomCategory(name: string, amount: number): Promise<Category> {
  const maxOrder = state.categories.reduce((m, c) => Math.max(m, c.order), 0);
  const category: Category = {
    id: uid("cat"),
    name: name.trim(),
    isCustom: true,
    budgeted: clampMoney(amount),
    color: nextCustomColor(state.categories),
    order: maxOrder + 1,
    hidden: false,
  };
  state.categories = [...state.categories, category];
  await persist();
  emit();
  return category;
}

export async function removeCategory(id: string): Promise<void> {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat?.isCustom) return;
  state.categories = state.categories.filter((c) => c.id !== id);
  state.transactions = state.transactions.map((t) =>
    t.categoryId === id ? { ...t, categoryId: NOT_IN_BUDGET_ID } : t,
  );
  if (selectedSliceId === id) selectedSliceId = null;
  await persist({ skipAbsorb: true });
  emit();
}

/** Extra cash this period. Extra Funds activity, not a Settings income source. */
export async function addExtraFunds(amount: number): Promise<void> {
  const add = clampMoney(amount);
  if (add <= 0 || !state.income) return;
  rolloverIfNeeded();
  const tx: Transaction = {
    id: uid("tx"),
    categoryId: EXTRA_FUNDS_ID,
    amount: add,
    createdAt: Date.now(),
    kind: "in",
  };
  state.transactions = [...state.transactions, tx];
  await persist();
  emit();
  maybeOfferReview();
}

export async function addPurchase(categoryId: string, amount: number): Promise<void> {
  if (categoryId === EXTRA_FUNDS_ID) {
    await addExtraFunds(amount);
    return;
  }
  rolloverIfNeeded();
  const tx: Transaction = {
    id: uid("tx"),
    categoryId,
    amount: clampMoney(amount),
    createdAt: Date.now(),
    kind: "out",
  };
  state.transactions = [...state.transactions, tx];
  await persist();
  emit();
  maybeOfferReview();
}

export async function deletePurchase(id: string): Promise<void> {
  const tx = state.transactions.find((t) => t.id === id);
  const next = state.transactions.filter((t) => t.id !== id);
  if (!tx || next.length === state.transactions.length) return;
  const pack = removePurchaseFromArchives({ ...historyPack(), transactions: next }, tx);
  applyHistoryPack(pack);
  await persist({ skipAbsorb: true });
  emit();
}

export async function completeOnboarding(): Promise<void> {
  rolloverIfNeeded();
  state.onboardingComplete = true;
  if (!state.firstSetupAt) state.firstSetupAt = Date.now();
  noteOpenDay();
  await persist();
  if (!state.tutorialComplete) {
    startTour();
    return;
  }
  resetNav({ id: "home" });
}

export async function resetAll(): Promise<void> {
  state = emptyState();
  resetDraft();
  stack = [];
  selectedSliceId = null;
  toastMessage = null;
  tourStep = null;
  tourReplay = false;
  reviewPromptVisible = false;
  applyTheme(state.theme);
  await persist({ skipAbsorb: true });
  if (sessionUser) {
    resetNav({ id: "pay-type" });
  } else {
    resetNav({ id: "welcome" });
  }
}

// ---------------------------------------------------------------------------
// Live wheel — spend in the current month / quarter / year
// ---------------------------------------------------------------------------

export function categoryById(id: string): Category | undefined {
  return state.categories.find((c) => c.id === id);
}

export function sortedCategories(): Category[] {
  return [...state.categories].sort(compareCategories);
}

/** Spend in the current scale. Yearly also folds in quarter archives that have no live txs left. */
export function extraFundsInPeriod(now = new Date()): number {
  const scale = state.wheelScale;
  let sum = 0;
  for (const tx of state.transactions) {
    const add = extraFundsAdded(tx);
    if (add <= 0) continue;
    if (scale === "month" && !isSameMonth(tx.createdAt, now)) continue;
    if (scale === "quarter" && !isSameQuarter(tx.createdAt, now)) continue;
    if (scale === "year" && !isSameYear(tx.createdAt, now)) continue;
    sum += add;
  }
  return clampMoney(sum);
}

/** Take-home for the scale plus Extra Funds cash-in this period. */
export function periodIncome(now = new Date()): number {
  return clampMoney((state.income?.monthlyTakeHome ?? 0) * periodMultiplier() + extraFundsInPeriod(now));
}

export function periodSpentMap(now = new Date()): Map<string, number> {
  const map = new Map<string, number>();
  const scale = state.wheelScale;
  const year = now.getFullYear();
  for (const tx of state.transactions) {
    if (isFundsIn(tx)) continue;
    if (scale === "month" && !isSameMonth(tx.createdAt, now)) continue;
    if (scale === "quarter" && !isSameQuarter(tx.createdAt, now)) continue;
    if (scale === "year" && !isSameYear(tx.createdAt, now)) continue;
    map.set(tx.categoryId, (map.get(tx.categoryId) ?? 0) + tx.amount);
  }
  if (scale === "year") {
    const covered = new Set<string>();
    for (const tx of state.transactions) {
      if (!isSameYear(tx.createdAt, now)) continue;
      covered.add(quarterIdFromDate(new Date(tx.createdAt)));
    }
    for (const snap of state.quarterHistory ?? []) {
      const qid = snap.quarterId || snap.id;
      if (quarterYear(qid) !== year) continue;
      if (covered.has(qid) || covered.has(snap.id)) continue;
      for (const cat of snap.categories) {
        map.set(cat.id, (map.get(cat.id) ?? 0) + cat.spent);
      }
    }
  }
  return map;
}

export function wheelCategories(): Array<Category & { spent: number; remaining: number; envelope: number }> {
  const spent = periodSpentMap();
  const extraIn = extraFundsInPeriod();
  const rows = sortedCategories()
    .filter((c) => !c.hidden && (c.id === EXTRA_FUNDS_ID || c.budgeted > 0 || (spent.get(c.id) ?? 0) > 0))
    .map((c) => {
      const used = spent.get(c.id) ?? 0;
      const leftover = quarterlyBudget(c.budgeted);
      const envelope = c.id === EXTRA_FUNDS_ID ? leftover + extraIn : leftover;
      return { ...c, spent: used, envelope, remaining: envelope - used };
    });
  return withExtraFundsPool(rows);
}

export function isOverBudget(): boolean {
  const income = periodIncome();
  if (income <= 0) return allocatedMonthly() > 0;
  const allocated = allocatedMonthly() * periodMultiplier();
  const spent = [...periodSpentMap().values()].reduce((s, n) => s + n, 0);
  return allocated > income + 0.009 || spent > income + 0.009;
}

export async function refreshOnForeground(): Promise<void> {
  const changed = absorbAndroidBudget();
  const rolled = rolloverIfNeeded();
  const opened = noteOpenDay();
  applyTheme(state.theme);
  schedulePeriodWatch();
  if (changed || rolled || opened) await persist();
  resumeTourIfNeeded();
  maybeOfferReview();
  emit();
}

export interface CategoryActivityLine {
  id: string;
  amount: number;
  createdAt: number;
  kind?: "in" | "out";
  sourceName?: string;
  archiveLabel?: string;
}

function inCurrentScale(createdAt: number, now: Date): boolean {
  const scale = state.wheelScale;
  if (scale === "month") return isSameMonth(createdAt, now);
  if (scale === "quarter") return isSameQuarter(createdAt, now);
  if (scale === "year") return isSameYear(createdAt, now);
  return true;
}

/** Extra Funds list: adds plus purchases that drew from the pool. */
export function extraFundsActivityFromTxs(
  txs: Transaction[],
  slices: Array<{ id: string; name: string; envelope: number }>,
): CategoryActivityLine[] {
  const oobIds = new Set(
    slices.filter((s) => isOutOfBudgetSpend(s.id, s.envelope)).map((s) => s.id),
  );
  const names = new Map(slices.map((s) => [s.id, s.name]));
  const lines: CategoryActivityLine[] = [];
  for (const t of txs) {
    if (t.categoryId === EXTRA_FUNDS_ID) {
      lines.push({
        id: t.id,
        amount: t.amount,
        createdAt: t.createdAt,
        kind: t.kind === "in" ? "in" : "out",
      });
      continue;
    }
    if (!oobIds.has(t.categoryId) || isFundsIn(t)) continue;
    lines.push({
      id: t.id,
      amount: t.amount,
      createdAt: t.createdAt,
      kind: "out",
      sourceName: names.get(t.categoryId) ?? categoryById(t.categoryId)?.name ?? "Out of budget",
    });
  }
  return lines.sort((a, b) => b.createdAt - a.createdAt);
}

export function categoryPeriodActivity(categoryId: string): CategoryActivityLine[] {
  const now = new Date();
  const scale = state.wheelScale;
  const year = now.getFullYear();
  const periodTxs = state.transactions.filter((t) => inCurrentScale(t.createdAt, now));

  if (categoryId === EXTRA_FUNDS_ID) {
    const lines = extraFundsActivityFromTxs(periodTxs, wheelCategories());
    if (scale !== "year") return lines;
    const covered = new Set<string>();
    for (const t of periodTxs) covered.add(quarterIdFromDate(new Date(t.createdAt)));
    for (const snap of state.quarterHistory ?? []) {
      const qid = snap.quarterId || snap.id;
      if (quarterYear(qid) !== year) continue;
      if (covered.has(qid) || covered.has(snap.id)) continue;
      const end = Date.parse(snap.endIso);
      const at = Number.isFinite(end) ? end : snap.capturedAt;
      for (const cat of snap.categories) {
        if (cat.spent <= 0.009) continue;
        if (cat.id === EXTRA_FUNDS_ID) {
          lines.push({ id: `archive:${snap.id}:${cat.id}`, amount: cat.spent, createdAt: at, archiveLabel: snap.label });
          continue;
        }
        const envelope = cat.budgetedMonthly * (snap.periodMonths || 3);
        if (!isOutOfBudgetSpend(cat.id, envelope)) continue;
        lines.push({
          id: `archive:${snap.id}:${cat.id}`,
          amount: cat.spent,
          createdAt: at,
          kind: "out",
          sourceName: cat.name,
          archiveLabel: snap.label,
        });
      }
    }
    return lines.sort((a, b) => b.createdAt - a.createdAt);
  }

  const lines: CategoryActivityLine[] = [];
  for (const t of periodTxs) {
    if (t.categoryId !== categoryId) continue;
    lines.push({ id: t.id, amount: t.amount, createdAt: t.createdAt, kind: t.kind === "in" ? "in" : "out" });
  }

  if (scale === "year") {
    const covered = new Set<string>();
    for (const t of periodTxs) covered.add(quarterIdFromDate(new Date(t.createdAt)));
    for (const snap of state.quarterHistory ?? []) {
      const qid = snap.quarterId || snap.id;
      if (quarterYear(qid) !== year) continue;
      if (covered.has(qid) || covered.has(snap.id)) continue;
      const cat = snap.categories.find((c) => c.id === categoryId);
      if (!cat || cat.spent <= 0) continue;
      const end = Date.parse(snap.endIso);
      lines.push({
        id: `archive:${snap.id}`,
        amount: cat.spent,
        createdAt: Number.isFinite(end) ? end : snap.capturedAt,
        archiveLabel: snap.label,
      });
    }
  }

  return lines.sort((a, b) => b.createdAt - a.createdAt);
}

export function recentTransactions(categoryId: string, limit = 5): Transaction[] {
  return categoryPeriodActivity(categoryId)
    .filter((line): line is CategoryActivityLine & { archiveLabel?: undefined } => !line.archiveLabel)
    .slice(0, limit)
    .map((line) => ({
      id: line.id,
      categoryId,
      amount: line.amount,
      createdAt: line.createdAt,
      kind: line.kind === "in" ? "in" as const : "out" as const,
    }));
}
