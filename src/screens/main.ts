/**
 * In-app screens after onboarding: home wheel/graph, spend history,
 * purchases, archived periods, and settings (appearance, widget pin, Help).
 * Shared chrome (graph header, top bar, Extra Funds / out-of-budget totals)
 * lives at the top so home and history render the same cards. Extra Funds is
 * leftover take-home plus cash-in activity — not a second income source.
 * Selected Extra Funds uses Add Funds. Tour spotlight ids live on the
 * wheel, slice card, chart toggle, Add Income, Add Widget, and history rows.
 */
import { incomeSlotLabel, listedSources, nextIncomeNumber, sourceTypeLabel } from "../lib/income.ts";
import { formatMoney, formatPct, formatTxMoney, parsePad, padDisplay, appendPad, escapeHtml } from "../lib/money.ts";
import { formatQuarterRange, getQuarter } from "../lib/quarter.ts";
import { findState } from "../lib/states.ts";
import {
  addExtraFunds,
  addPurchase,
  back,
  categoryById,
  categoryPeriodActivity,
  type CategoryActivityLine,
  deleteHistorySnapshots,
  deletePurchase,
  extraFundsActivityFromTxs,
  extraFundsInPeriod,
  findHistorySnapshot,
  go,
  historySnapsForScale,
  historyWheelSlices,
  isOverBudget,
  periodIncome as livePeriodIncome,
  removeIncomeSource,
  periodSpentMap,
  quarterlyBudget,
  resetAll,
  resetNav,
  setHomeChart,
  setSelectedSlice,
  setTheme,
  setWheelScale,
  showToast,
  startTour,
  snapshotSpentTotal,
  sortedCategories,
  transactionsForSnapshot,
  state,
  selectedSliceId,
  wheelCategories,
} from "../store.ts";
import type { HistoryScale, WheelSnapshot } from "../types.ts";
import { EXTRA_FUNDS_ID, NOT_IN_BUDGET_ID, budgetSpendTotals, extraFundsCardStats } from "../lib/categories.ts";
import { buyHomeWidget, openPlayStore, pinHomeWidget, redeemWidgetCode, widgetPriceLabel, widgetUnlockState } from "../lib/android.ts";
import { downloadHistoryWheels } from "../lib/history-export.ts";
import { extraInFromTransactions, periodLabel, periodWord } from "../lib/history.ts";
import { openCategoryBudget, openColorPicker, openIncomeSource } from "./onboarding.ts";
import { backChevron, forwardChevron, logoMark, trashCan } from "../ui/icons.ts";
import { bindNav, graphIcon, navBar, wheelIcon } from "../ui/nav.ts";
import { bindNumpad, numpadMarkup } from "../ui/numpad.ts";
import { wheelCenterMarkup, wheelSvg, type WheelSlice } from "../ui/wheel.ts";

let purchasePad = "";
let historyScale: HistoryScale = "month";
let historySelect: { mode: "download" | "delete"; ids: Set<string> } | null = null;

export function seedPurchasePad(value = ""): void {
  purchasePad = value;
}

function budgetChartMarkup(
  slices: Array<{ id: string; name: string; color: string; spent: number; envelope: number; remaining: number }>,
  opts: { selectedId: string | null },
): string {
  if (!slices.length) {
    return `<div class="budget-chart"><p class="hint center-hint">Set category amounts in Settings</p></div>`;
  }
  const rows = slices
    .map((s) => {
      const extra = s.id === EXTRA_FUNDS_ID;
      const over = s.envelope > 0 && s.spent > s.envelope + 0.009;
      const pct = s.envelope > 0 ? Math.min(100, (s.spent / s.envelope) * 100) : s.spent > 0 ? 100 : 0;
      const left = s.envelope - s.spent;
      const amt = extra
        ? `${formatMoney(s.spent)} lost of ${s.envelope > 0 ? formatMoney(s.envelope) : "—"}`
        : `${formatMoney(s.spent)} of ${s.envelope > 0 ? formatMoney(s.envelope) : "—"}`;
      return `
        <button type="button" class="budget-bar-row${opts.selectedId === s.id ? " is-selected" : ""}" data-slice="${s.id}">
          <span class="budget-bar-top">
            <span class="budget-bar-name">${escapeHtml(s.name)}</span>
            <span class="budget-bar-amt">${amt}</span>
          </span>
          <span class="budget-bar-track">
            <span class="budget-bar-fill${over ? " is-over" : ""}" style="width:${pct}%;background:${over ? "" : s.color}"></span>
          </span>
          <span class="budget-bar-meta">
            <span>${s.envelope > 0 ? formatPct(pct, pct < 10 && pct > 0 ? 1 : 0) : extra ? "Pool" : "No budget"}</span>
            <span class="${left < 0 ? "is-warn" : ""}">${left < 0 ? `${formatMoney(-left)} over` : `${formatMoney(left)} left`}</span>
          </span>
        </button>`;
    })
    .join("");
  return `
    <div class="budget-chart">
      ${rows}
    </div>`;
}



function wheelCornerTotalsMarkup(totals: { outOfBudget: number; remaining: number }): string {
  const oob = totals.outOfBudget > 0.009;
  return `<div class="wheel-corner-totals is-oob">
    <div class="graph-stat">
      <span class="graph-stat-val${oob ? " is-neg" : ""}">${formatMoney(totals.outOfBudget)}</span>
      <span class="graph-stat-lbl">out of budget</span>
    </div>
  </div>
  <div class="wheel-corner-totals is-left">
    ${budgetLeftStat(totals.remaining)}
  </div>`;
}

function budgetLeftStat(remaining: number): string {
  const over = remaining < 0;
  return `<div class="graph-stat">
      <span class="graph-stat-val ${over ? "is-neg" : ""}">${formatMoney(over ? -remaining : remaining)}</span>
      <span class="graph-stat-lbl">${over ? "over-Budget" : "budget-left"}</span>
    </div>`;
}

function wheelBlockMarkup(
  slices: Array<WheelSlice & { remaining: number }>,
  opts: {
    selected: { id: string; name: string; remaining: number; spent: number; envelope: number } | null;
    totals: { outOfBudget: number; remaining: number; envelope: number; spent: number };
    periodIncome: number;
    tour?: boolean;
  },
): string {
  const selected = opts.selected;
  const centerValue = selected ? selected.remaining : opts.periodIncome;
  return `<div class="wheel-wrap">
        <div class="wheel-stage"${opts.tour ? ` id="tour-wheel" data-tour="wheel"` : ""}>
        ${wheelSvg(slices, { selectedId: selectedSliceId, interactive: true })}
        ${wheelCenterMarkup({
          label: selected ? selected.name : "Income",
          value: formatMoney(centerValue),
          negative: centerValue < 0,
          subPrimary: selected ? selectedSliceSub(selected) : `${formatMoney(opts.totals.spent)} spent`,
          subSecondary: selected ? undefined : `of ${formatMoney(opts.totals.envelope)} budget`,
        })}
        </div>
        ${wheelCornerTotalsMarkup(opts.totals)}
        ${
          slices.length
            ? `<button type="button" class="wheel-cycle-btn is-left" data-cycle="1" aria-label="Previous category">${backChevron}</button>
               <button type="button" class="wheel-cycle-btn is-right" data-cycle="-1" aria-label="Next category">${forwardChevron}</button>`
            : ""
        }
      </div>`;
}

function bindWheelBlock(el: HTMLElement, slices: Array<{ id: string }>): void {
  el.querySelectorAll<HTMLElement>("[data-slice]").forEach((path) => {
    path.addEventListener("click", () => {
      const id = path.dataset.slice ?? null;
      setSelectedSlice(selectedSliceId === id ? null : id);
    });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-cycle]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const dir = Number(btn.dataset.cycle) === -1 ? -1 : 1;
      const ids = slices.map((s) => s.id);
      if (!ids.length) return;
      const current = selectedSliceId ? ids.indexOf(selectedSliceId) : dir > 0 ? -1 : 0;
      const next = ids[(current + dir + ids.length) % ids.length];
      setSelectedSlice(next);
    });
  });
}

function bindSliceDetail(el: HTMLElement, open: () => void): void {
  el.querySelector("[data-slice-detail]")?.addEventListener("click", open);
  el.querySelector("[data-slice-detail]")?.addEventListener("keydown", (ev) => {
    if (!(ev instanceof KeyboardEvent)) return;
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    open();
  });
}

function budgetSpentOverMarkup(selected: { envelope: number; spent: number; remaining: number }): string {
  return `<div class="graph-detail-stats">
    <div class="graph-stat">
      <span class="graph-stat-val">${selected.envelope > 0 ? formatMoney(selected.envelope) : "—"}</span>
      <span class="graph-stat-lbl">budgeted</span>
    </div>
    <div class="graph-stat">
      <span class="graph-stat-val">${formatMoney(selected.spent)}</span>
      <span class="graph-stat-lbl">spent</span>
    </div>
    ${budgetLeftStat(selected.remaining)}
  </div>`;
}

function extraFundsStatsMarkup(
  selected: { envelope: number; spent: number },
  addedFunds: number,
  periodWord: string,
): string {
  const stats = extraFundsCardStats(selected, addedFunds);
  return `<div class="graph-detail-stats">
    <div class="graph-stat">
      <span class="graph-stat-val">${formatMoney(stats.monthFunds)}</span>
      <span class="graph-stat-lbl">${periodWord} funds</span>
    </div>
    <div class="graph-stat">
      <span class="graph-stat-val${stats.addedFunds > 0.009 ? " is-in" : ""}">${formatMoney(stats.addedFunds)}</span>
      <span class="graph-stat-lbl">added funds</span>
    </div>
    <div class="graph-stat">
      <span class="graph-stat-val${stats.fundsLost > 0.009 ? " is-neg" : ""}">${formatMoney(stats.fundsLost)}</span>
      <span class="graph-stat-lbl">funds lost</span>
    </div>
  </div>`;
}

function selectedSliceSub(selected: { id: string; spent: number; envelope: number }): string {
  if (selected.id === EXTRA_FUNDS_ID) {
    return `${formatMoney(selected.spent)} lost of ${formatMoney(selected.envelope)}`;
  }
  return `${formatMoney(selected.spent)} of ${formatMoney(selected.envelope)}`;
}

function totalsStatsMarkup(totals: { envelope: number; spent: number; remaining: number }): string {
  return budgetSpentOverMarkup(totals);
}

function incomeShareLabel(budgeted: number, monthlyIncome: number, categoryId?: string): string {
  if (categoryId === EXTRA_FUNDS_ID) return "Leftover cash pool";
  if (budgeted > 0) {
    return `${formatPct(monthlyIncome > 0 ? (budgeted / monthlyIncome) * 100 : 0, 0)} of income`;
  }
  return "Not in your budget";
}

function txAmountCell(kind: "in" | "out" | undefined, amount: number): string {
  const inn = kind === "in";
  return `<span${inn ? ` class="is-in"` : ""}>${formatTxMoney(amount, inn ? "in" : "out")}</span>`;
}

function activityLineLabel(
  line: CategoryActivityLine,
  dateFmt: Intl.DateTimeFormatOptions,
  periodWord: string,
): string {
  const when = line.archiveLabel
    ? `${escapeHtml(line.archiveLabel)}<span class="muted"> · saved ${periodWord === "year" ? "quarter" : periodWord}</span>`
    : escapeHtml(new Date(line.createdAt).toLocaleDateString("en-US", dateFmt));
  if (!line.sourceName) return when;
  const who = escapeHtml(line.sourceName);
  return line.archiveLabel ? `${who} · ${when}` : `${who}<span class="muted"> · ${when}</span>`;
}

function graphDetailMarkup(opts: {
  selected: {
    id: string;
    name: string;
    color: string;
    budgeted: number;
    envelope: number;
    spent: number;
    remaining: number;
  } | null;
  totals: { envelope: number; spent: number; outOfBudget: number; remaining: number };
  monthlyIncome: number;
  periodIncome: number;
  totalBudgeted: number;
  periodWord: string;
  addedFunds?: number;
  canAddBudget?: boolean;
  interactive?: boolean;
}): string {
  if (opts.selected) {
    const extraCard =
      opts.selected.id === EXTRA_FUNDS_ID
        ? extraFundsStatsMarkup(opts.selected, opts.addedFunds ?? 0, opts.periodWord)
        : budgetSpentOverMarkup(opts.selected);
    return `<div class="graph-detail"${opts.interactive ? ` data-slice-detail role="button" tabindex="0"` : ""}>
              <div class="graph-detail-head">
                <button type="button" class="cat-swatch" data-color-for="${opts.selected.id}" style="background:${opts.selected.color}" aria-label="Change color"></button>
                <span class="graph-detail-copy">
                  <strong>${escapeHtml(opts.selected.name)}</strong>
                  <span class="muted">${incomeShareLabel(opts.selected.budgeted, opts.monthlyIncome, opts.selected.id)}</span>
                </span>
                ${opts.canAddBudget ? `<button type="button" class="slice-add-budget" data-add-budget>Add to budget</button>` : ""}
              </div>
              ${extraCard}
            </div>`;
  }
  const oob = opts.totals.outOfBudget > 0.009;
  return `<div class="graph-detail">
              <div class="graph-detail-head is-totals">
                <span class="graph-detail-copy">
                  <span class="muted">Income</span>
                  <strong>${formatMoney(opts.periodIncome)}</strong>
                </span>
                <span class="graph-detail-copy is-end">
                  <span class="muted">Out of budget</span>
                  <strong${oob ? ` class="is-neg"` : ""}>${formatMoney(opts.totals.outOfBudget)}</strong>
                </span>
              </div>
              ${totalsStatsMarkup(opts.totals)}
            </div>`;
}

function chartToggleMarkup(graphMode: boolean): string {
  return `<button type="button" class="icon-btn home-head-toggle" id="tour-chart" data-toggle-chart data-tour="chart-toggle" aria-label="${
    graphMode ? "Show wheel" : "Show graph"
  }">${graphMode ? wheelIcon : graphIcon}</button>`;
}

function bindChartToggle(el: HTMLElement): void {
  el.querySelector("[data-toggle-chart]")?.addEventListener("click", () => {
    void setHomeChart(state.homeChart === "bars" ? "wheel" : "bars");
  });
}

function themeLabel(): string {
  if (state.theme === "light") return "Light";
  if (state.theme === "system") return "System default";
  return "Dark";
}

function topBar(title: string): string {
  return `
    <header class="topbar">
      <button type="button" class="icon-btn" data-back aria-label="Back">${backChevron}</button>
      <h1 class="topbar-title">${title}</h1>
      <span class="icon-btn-spacer"></span>
    </header>`;
}

// ---------------------------------------------------------------------------
// Home — live wheel / graph for the current month, quarter, or year
// ---------------------------------------------------------------------------

export function renderHome(): HTMLElement {
  historySelect = null;
  const q = getQuarter();
  const slices = wheelCategories();
  const selected = slices.find((s) => s.id === selectedSliceId) ?? null;
  const totals = budgetSpendTotals(slices);
  const monthlyIncome = state.income?.monthlyTakeHome ?? 0;
  const periodIncome = livePeriodIncome();
  const scale = state.wheelScale;
  const monthLabel = new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" });
  const yearLabel = String(new Date().getFullYear());
  const over = isOverBudget() && !selected;
  const periodWord = scale === "year" ? "year" : scale === "quarter" ? "quarter" : "month";
  const scaleLabel = scale === "year" ? "Yearly" : scale === "quarter" ? "Quarterly" : "Monthly";
  const titleLabel = scale === "year" ? yearLabel : scale === "quarter" ? q.label : monthLabel;

  const graphMode = state.homeChart === "bars";
  const totalBudgeted = totals.budgeted;
  const shareLabel = selected ? incomeShareLabel(selected.budgeted, monthlyIncome, selected.id) : "";
  const canAddBudget = Boolean(
    selected &&
      selected.budgeted <= 0 &&
      selected.id !== EXTRA_FUNDS_ID &&
      selected.id !== NOT_IN_BUDGET_ID,
  );
  const previewFmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const txMarkup = selected
    ? categoryPeriodActivity(selected.id)
        .slice(0, 3)
        .map(
          (line) =>
            `<div class="tx-row"><span>${activityLineLabel(line, previewFmt, periodWord)}</span>${txAmountCell(line.kind, line.amount)}</div>`,
        )
        .join("") ||
      `<p class="muted tiny">${selected.id === EXTRA_FUNDS_ID ? `No Extra Funds activity yet this ${periodWord}.` : `No purchases yet this ${periodWord}.`}</p>`
    : "";
  const graphDetail = graphMode
    ? graphDetailMarkup({
        selected,
        totals,
        monthlyIncome,
        periodIncome,
        totalBudgeted,
        periodWord,
        addedFunds: extraFundsInPeriod(),
        canAddBudget,
        interactive: true,
      })
    : "";
  const sliceDetail =
    !graphMode && selected
      ? `<div class="slice-card" id="tour-slice" data-tour="slice" data-slice-detail role="button" tabindex="0">
              <div class="slice-card-top">
                <button type="button" class="cat-swatch" data-color-for="${selected.id}" style="background:${selected.color}" aria-label="Change color"></button>
                <span class="slice-card-copy">
                  <strong>${escapeHtml(selected.name)}</strong>
                  <span class="muted">${shareLabel}</span>
                </span>
                ${canAddBudget ? `<button type="button" class="slice-add-budget" data-add-budget>Add to budget</button>` : ""}
              </div>
              ${txMarkup}
            </div>`
      : "";

  const el = document.createElement("div");
  el.innerHTML = `
    <section class="screen screen-home${graphMode ? " is-graph" : ""}">
      <div class="screen-body">
      <header class="home-head is-toolbar">
        <div class="period-wrap is-start">
          <button type="button" class="quarter-chip" data-period-toggle aria-haspopup="listbox">
            ${scaleLabel} ▾
          </button>
          <div class="period-drop" id="period-drop">
            <button type="button" class="period-opt${scale === "month" ? " is-on" : ""}" data-scale="month">Monthly</button>
            <button type="button" class="period-opt${scale === "quarter" ? " is-on" : ""}" data-scale="quarter">Quarterly</button>
            <button type="button" class="period-opt${scale === "year" ? " is-on" : ""}" data-scale="year">Yearly</button>
          </div>
        </div>
        <div class="home-head-title">
          <p class="brand-mini">Budget Wheel</p>
          <h1 class="quarter-title">${titleLabel}</h1>
        </div>
        ${chartToggleMarkup(graphMode)}
      </header>
      ${graphDetail}
      ${
        graphMode
          ? budgetChartMarkup(slices, {
              selectedId: selectedSliceId,
            })
          : wheelBlockMarkup(slices, { selected, totals, periodIncome, tour: true })
      }
      ${
        over
          ? `<button type="button" class="over-warn" data-over aria-label="Over budget">
              <span class="over-bang">!</span>
            </button>`
          : ""
      }
      ${graphMode ? "" : sliceDetail}
      ${
        selected
          ? ""
          : slices.length && graphMode
            ? ""
            : `<p class="hint center-hint">${
                slices.length
                  ? slices.some((s) => s.spent > 0.009)
                    ? "Tap a slice for details"
                    : "Tap I purchased to log your first spend."
                  : "Set category amounts in Settings"
              }</p>`
      }
      <button type="button" class="btn btn-primary btn-purchase" data-buy>${
        selected?.id === EXTRA_FUNDS_ID ? "Add Funds" : "I purchased"
      }</button>
      </div>
      ${navBar("home")}
    </section>`;

  bindWheelBlock(el, slices);
  bindSliceDetail(el, () => {
    if (selected) go({ id: "category-activity", categoryId: selected.id });
  });
  el.querySelector("[data-color-for]")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const id = (ev.currentTarget as HTMLElement).dataset.colorFor ?? "";
    openColorPicker(el, id);
  });
  el.querySelector("[data-add-budget]")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (selected) openCategoryBudget(selected.id, "home");
  });
  el.querySelector("[data-over]")?.addEventListener("click", () => {
    const sheet = document.createElement("div");
    sheet.className = "over-sheet";
    sheet.innerHTML = `
      <div class="over-card">
        <div class="over-warn static"><span class="over-bang">!</span></div>
        <h2 class="headline">Your budget is over your income</h2>
        <p class="sub">Consider bringing in more income, or re-evaluate the budget so it fits.</p>
        <button type="button" class="btn btn-primary btn-xl" data-add-inc>Add income</button>
        <button type="button" class="btn btn-ghost" data-review>Re-evaluate budget</button>
        <button type="button" class="btn btn-ghost" data-dismiss>Got it</button>
      </div>`;
    el.querySelector(".screen")?.append(sheet);
    sheet.querySelector("[data-dismiss]")?.addEventListener("click", () => sheet.remove());
    sheet.querySelector("[data-add-inc]")?.addEventListener("click", () => {
      go({ id: "extra-income" });
    });
    sheet.querySelector("[data-review]")?.addEventListener("click", () => {
      go({ id: "catalog", from: "settings" });
    });
  });
  const drop = el.querySelector<HTMLElement>(".period-drop");
  const closeDrop = () => drop?.classList.remove("is-open");
  el.querySelector("[data-period-toggle]")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    drop?.classList.toggle("is-open");
  });
  el.querySelectorAll<HTMLButtonElement>("[data-scale]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      closeDrop();
      const next = btn.dataset.scale;
      const scaleNext = next === "year" || next === "quarter" ? next : "month";
      await setWheelScale(scaleNext);
    });
  });
  const onDoc = (ev: Event) => {
    if (!el.contains(ev.target as Node)) return;
    const t = ev.target as HTMLElement;
    if (!t.closest(".period-wrap")) closeDrop();
  };
  el.addEventListener("click", onDoc);
  bindChartToggle(el);
  el.querySelector("[data-buy]")?.addEventListener("click", () => {
    seedPurchasePad("");
    go({ id: "purchase-amount" });
  });
  bindNav(el);
  return el;
}

// ---------------------------------------------------------------------------
// Slice details — itemized purchases for one category
// ---------------------------------------------------------------------------

export function renderCategoryActivity(categoryId: string, periodId?: string): HTMLElement {
  const snap = periodId ? findHistorySnapshot(periodId) : undefined;
  const scale = snap?.scale ?? state.wheelScale;
  const periodWord = scale === "year" ? "year" : scale === "quarter" ? "quarter" : "month";
  const historyCat = snap ? historyWheelSlices(snap).find((c) => c.id === categoryId) : undefined;
  const wheelCat = historyCat ?? wheelCategories().find((c) => c.id === categoryId);
  const cat = wheelCat ?? categoryById(categoryId);
  const lines = snap
    ? categoryId === EXTRA_FUNDS_ID
      ? extraFundsActivityFromTxs(transactionsForSnapshot(snap), historyWheelSlices(snap))
      : transactionsForSnapshot(snap)
          .filter((t) => t.categoryId === categoryId)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((t): CategoryActivityLine => ({
            id: t.id,
            amount: t.amount,
            createdAt: t.createdAt,
            kind: t.kind === "in" ? "in" : "out",
          }))
    : categoryPeriodActivity(categoryId);
  const dateFmt: Intl.DateTimeFormatOptions =
    scale === "year"
      ? { month: "short", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric" };
  const el = document.createElement("div");

  if (!cat) {
    el.innerHTML = `
      <section class="screen">
        ${topBar("Purchases")}
        <h2 class="headline">That category is gone</h2>
        <p class="sub">It may have been removed from this budget.</p>
        <button type="button" class="btn btn-primary btn-xl" data-back>Back</button>
      </section>`;
    el.querySelector("[data-back]")?.addEventListener("click", () => back());
    return el;
  }

  const spent = wheelCat?.spent ?? lines.filter((line) => line.kind !== "in").reduce((sum, line) => sum + line.amount, 0);
  const added = lines.filter((line) => line.kind === "in").reduce((sum, line) => sum + line.amount, 0);
  const envelope = wheelCat?.envelope ?? 0;
  const remaining = wheelCat?.remaining ?? envelope - spent;
  const extra = categoryId === EXTRA_FUNDS_ID;
  const extraStats = extra ? extraFundsCardStats({ envelope, spent }, added) : null;
  const rows = lines
    .map((line) => {
      const label = activityLineLabel(line, dateFmt, periodWord);
      const del = line.archiveLabel
        ? ""
        : `<button type="button" class="icon-btn icon-btn-danger activity-del" data-del="${escapeHtml(line.id)}" aria-label="${line.kind === "in" ? "Delete add" : "Delete purchase"}">${trashCan}</button>`;
      return `<div class="tx-row activity-row${line.archiveLabel ? " is-archive" : ""}"><span>${label}</span><span class="activity-row-end">${txAmountCell(line.kind, line.amount)}${del}</span></div>`;
    })
    .join("");

  el.innerHTML = `
    <section class="screen screen-list">
      ${topBar(escapeHtml(cat.name))}
      <header class="home-head">
        <div>
          <p class="brand-mini">${snap ? escapeHtml(periodLabel(snap)) : `This ${periodWord}`}</p>
          <h1 class="quarter-title">${escapeHtml(cat.name)}</h1>
        </div>
        <button type="button" class="cat-swatch" data-color-for="${escapeHtml(cat.id)}" style="background:${cat.color}" aria-label="Change color"></button>
      </header>
      <p class="sub activity-summary">${
        extraStats
          ? `${formatMoney(extraStats.monthFunds)} ${periodWord} funds · ${formatMoney(extraStats.addedFunds)} added · ${formatMoney(extraStats.fundsLost)} lost`
          : `${formatMoney(spent)} spent${
              envelope > 0
                ? ` of ${formatMoney(envelope)} · ${remaining < 0 ? `${formatMoney(-remaining)} over` : `${formatMoney(remaining)} left`}`
                : ""
            }`
      }</p>
      <div class="screen-body activity-list">
        ${rows || `<p class="muted tiny">${extra ? `No Extra Funds activity yet this ${periodWord}.` : `No purchases yet this ${periodWord}.`}</p>`}
      </div>
    </section>`;
  el.querySelector("[data-back]")?.addEventListener("click", () => back());
  el.querySelector("[data-color-for]")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const id = (ev.currentTarget as HTMLElement).dataset.colorFor ?? "";
    openColorPicker(el, id);
  });
  el.querySelector(".activity-list")?.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-del]");
    if (!btn || !el.contains(btn)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const id = btn.dataset.del ?? "";
    const line = lines.find((item) => item.id === id);
    if (!id || !line || line.archiveLabel) return;
    el.querySelector(".over-sheet")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "over-sheet";
    sheet.innerHTML = `
      <div class="over-card">
        <h2 class="headline">Delete this ${formatMoney(line.amount)} ${line.kind === "in" ? "add" : "purchase"}?</h2>
        <p class="sub">It will be removed from this ${periodWord}.</p>
        <button type="button" class="btn btn-primary btn-xl" data-del-yes>Yes, delete it</button>
        <button type="button" class="btn btn-ghost" data-del-no>Cancel</button>
      </div>`;
    el.querySelector(".screen")?.append(sheet);
    sheet.querySelector("[data-del-no]")?.addEventListener("click", () => sheet.remove());
    sheet.querySelector("[data-del-yes]")?.addEventListener("click", async () => {
      await deletePurchase(id);
    });
  });
  return el;
}

// ---------------------------------------------------------------------------
// I purchased — amount pad, then category (skipped when a slice is selected)
// ---------------------------------------------------------------------------

export function renderPurchaseAmount(): HTMLElement {
  const target = wheelCategories().find((c) => c.id === selectedSliceId) ?? null;
  const addingFunds = target?.id === EXTRA_FUNDS_ID;
  const el = document.createElement("div");
  el.innerHTML = `
    <section class="screen screen-pad">
      ${topBar(addingFunds ? "Add Funds" : "I purchased")}
      ${
        addingFunds
          ? `<p class="catalog-kicker">Extra cash that landed this month</p>`
          : target
            ? `<p class="catalog-kicker">Adding to ${escapeHtml(target.name)}</p>`
            : ""
      }
      <p class="display-amount" id="pad-display">${padDisplay(purchasePad)}</p>
      <div class="flex-spacer"></div>
      ${numpadMarkup()}
      <div class="pad-actions">
        <button type="button" class="btn btn-ghost" data-back>Back</button>
        <button type="button" class="btn btn-primary" data-next ${parsePad(purchasePad) > 0 ? "" : "disabled"}>${
          addingFunds ? "Add Funds" : target ? `Add to ${escapeHtml(target.name)}` : "Continue"
        }</button>
      </div>
    </section>`;
  el.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => back());
  });
  const display = el.querySelector("#pad-display");
  const next = el.querySelector<HTMLButtonElement>("[data-next]");
  const refresh = () => {
    if (display) display.textContent = padDisplay(purchasePad);
    if (next) next.disabled = parsePad(purchasePad) <= 0;
  };
  bindNumpad(el, (key) => {
    purchasePad = appendPad(purchasePad, key);
    refresh();
  });
  next?.addEventListener("click", async () => {
    const amount = parsePad(purchasePad);
    if (amount <= 0) return;
    if (addingFunds) {
      next.disabled = true;
      await addExtraFunds(amount);
      setSelectedSlice(EXTRA_FUNDS_ID);
      resetNav({ id: "home" });
      return;
    }
    if (target) {
      next.disabled = true;
      await addPurchase(target.id, amount);
      setSelectedSlice(target.id);
      resetNav({ id: "home" });
      return;
    }
    go({ id: "purchase-category", amount });
  });
  return el;
}

export function renderPurchaseCategory(amount: number): HTMLElement {
  const income = state.income?.monthlyTakeHome ?? 0;
  const cats = sortedCategories();
  const spentMap = periodSpentMap();
  const el = document.createElement("div");
  el.innerHTML = `
    <section class="screen screen-catalog">
      ${topBar("Which category?")}
      <p class="catalog-kicker">Logging ${formatMoney(amount)}</p>
      <div class="catalog-list">
        ${cats
          .filter((c) => !c.hidden && c.id !== EXTRA_FUNDS_ID)
          .map((c) => {
            const env = quarterlyBudget(c.budgeted);
            const spent = spentMap.get(c.id) ?? 0;
            const left = env - spent;
            const share = income > 0 ? (c.budgeted / income) * 100 : 0;
            return `
              <button type="button" class="cat-row" data-cat="${c.id}">
                <span class="cat-swatch" style="background:${c.color}"></span>
                <span class="cat-meta">
                  <span class="cat-name">${escapeHtml(c.name)}</span>
                  <span class="cat-left ${left < amount ? "is-warn" : ""}">${c.budgeted > 0 ? `${formatMoney(left)} left` : "No budget set"}</span>
                </span>
                <span class="cat-pct ${c.budgeted > 0 ? "has-value" : ""}">${c.budgeted > 0 ? formatPct(share, share < 10 ? 1 : 0) : "—"}</span>
              </button>`;
          })
          .join("")}
      </div>
    </section>`;
  el.querySelector("[data-back]")?.addEventListener("click", () => back());
  let logging = false;
  el.querySelectorAll<HTMLButtonElement>("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (logging) return;
      const id = btn.dataset.cat ?? "";
      if (!id) return;
      logging = true;
      el.querySelectorAll<HTMLButtonElement>("[data-cat]").forEach((b) => {
        b.disabled = true;
      });
      await addPurchase(id, amount);
      setSelectedSlice(id);
      resetNav({ id: "home" });
    });
  });
  return el;
}

// ---------------------------------------------------------------------------
// History list (months / quarters / years)
// ---------------------------------------------------------------------------

function historyRow(snap: WheelSnapshot, selecting: boolean, checked: boolean): string {
  const spent = snapshotSpentTotal(snap);
  return `
    <div class="history-block${selecting ? " is-select" : ""}${checked ? " is-checked" : ""}">
      <button type="button" class="settings-row history-row" data-period="${escapeHtml(snap.id)}"${
        selecting ? ` aria-pressed="${checked}"` : ""
      }>
        <span class="history-check" aria-hidden="true">${checked ? "✓" : ""}</span>
        <span class="history-row-copy">
          <strong>${escapeHtml(periodLabel(snap))}</strong>
          <span class="muted">${formatQuarterRange(snap.startIso, snap.endIso) || "Open wheel"}</span>
        </span>
        <span class="history-row-end">
          <span class="cat-pct has-value">${formatMoney(spent)}</span>
          ${selecting ? "" : `<span class="chevron">›</span>`}
        </span>
      </button>
    </div>`;
}

function cascadePrompt(scale: HistoryScale): {
  label: string;
  hint: string;
  quarters: boolean;
  years: boolean;
} | null {
  if (scale === "month") {
    return {
      label: "Also remove from quarterly and yearly history",
      hint: "Leave this off to keep those totals.",
      quarters: true,
      years: true,
    };
  }
  if (scale === "quarter") {
    return {
      label: "Also remove from yearly history",
      hint: "Leave this off to keep the year total.",
      quarters: false,
      years: true,
    };
  }
  return null;
}

/** Months / quarters / years list, with bulk download and delete. */
export function renderPastQuarter(): HTMLElement {
  const scale = historyScale;
  const scaleLabel = scale === "year" ? "Yearly" : scale === "quarter" ? "Quarterly" : "Monthly";
  const title = scale === "year" ? "Years" : scale === "quarter" ? "Quarters" : "Months";
  const snaps = historySnapsForScale(scale);
  const selecting = historySelect !== null;
  const selectedCount = historySelect ? [...historySelect.ids].filter((id) => snaps.some((s) => s.id === id)).length : 0;
  const emptyHint =
    scale === "year"
      ? "When a year ends, that year’s wheel is saved here."
      : scale === "quarter"
        ? "When a quarter ends, that quarter’s wheel is saved here."
        : "When a month ends, that month’s wheel is saved here.";
  const downloadLabel =
    historySelect?.mode === "download" && selectedCount > 0
      ? `Download ${selectedCount}`
      : "Download";
  const deleteLabel =
    historySelect?.mode === "delete" && selectedCount > 0 ? `Delete ${selectedCount}` : "Delete";
  const el = document.createElement("div");
  el.innerHTML = `
    <section class="screen screen-list${selecting ? " is-selecting" : ""}">
      <header class="home-head is-toolbar">
        <button type="button" class="icon-btn" data-back aria-label="${selecting ? "Cancel" : "Back"}">${backChevron}</button>
        <div class="home-head-title">
          <h1 class="quarter-title">${title}</h1>
        </div>
        <div class="period-wrap">
          <button type="button" class="quarter-chip" data-period-toggle aria-haspopup="listbox">
            ${scaleLabel} ▾
          </button>
          <div class="period-drop" id="period-drop">
            <button type="button" class="period-opt${scale === "month" ? " is-on" : ""}" data-scale="month">Monthly</button>
            <button type="button" class="period-opt${scale === "quarter" ? " is-on" : ""}" data-scale="quarter">Quarterly</button>
            <button type="button" class="period-opt${scale === "year" ? " is-on" : ""}" data-scale="year">Yearly</button>
          </div>
        </div>
      </header>
      <div class="screen-body history-body">
        ${
          snaps.length
            ? snaps
                .slice()
                .reverse()
                .map((snap) => historyRow(snap, selecting, Boolean(historySelect?.ids.has(snap.id))))
                .join("")
            : `<div class="empty-card">
          ${logoMark}
          <p>${emptyHint}</p>
        </div>`
        }
      </div>
      <div class="history-actions">
        <button type="button" class="btn history-action-dl${historySelect?.mode === "download" ? " is-on" : ""}" data-hist-download${snaps.length ? "" : " disabled"}>${downloadLabel}</button>
        <button type="button" class="btn history-action-del${historySelect?.mode === "delete" ? " is-on" : ""}" data-hist-delete${snaps.length ? "" : " disabled"}>${deleteLabel}</button>
      </div>
      ${navBar("settings")}
    </section>`;
  const selectedSnaps = () => snaps.filter((snap) => historySelect?.ids.has(snap.id));
  const paintSelect = () => {
    const on = historySelect !== null;
    const count = selectedSnaps().length;
    el.querySelector(".screen")?.classList.toggle("is-selecting", on);
    const back = el.querySelector("[data-back]");
    if (back) back.setAttribute("aria-label", on ? "Cancel" : "Back");
    el.querySelectorAll<HTMLButtonElement>("[data-period]").forEach((row) => {
      const id = row.dataset.period ?? "";
      const checked = Boolean(historySelect?.ids.has(id));
      row.closest(".history-block")?.classList.toggle("is-checked", checked);
      row.closest(".history-block")?.classList.toggle("is-select", on);
      if (on) row.setAttribute("aria-pressed", String(checked));
      else row.removeAttribute("aria-pressed");
      const mark = row.querySelector(".history-check");
      if (mark) mark.textContent = checked ? "✓" : "";
      const end = row.querySelector(".history-row-end");
      const chevron = end?.querySelector(".chevron");
      if (on) chevron?.remove();
      else if (end && !chevron) end.insertAdjacentHTML("beforeend", `<span class="chevron">›</span>`);
    });
    const dl = el.querySelector("[data-hist-download]");
    const del = el.querySelector("[data-hist-delete]");
    if (dl) {
      dl.classList.toggle("is-on", historySelect?.mode === "download");
      dl.textContent = historySelect?.mode === "download" && count > 0 ? `Download ${count}` : "Download";
    }
    if (del) {
      del.classList.toggle("is-on", historySelect?.mode === "delete");
      del.textContent = historySelect?.mode === "delete" && count > 0 ? `Delete ${count}` : "Delete";
    }
  };
  el.querySelector("[data-back]")?.addEventListener("click", () => {
    if (historySelect) {
      historySelect = null;
      paintSelect();
      return;
    }
    if (state.onboardingComplete) resetNav({ id: "settings" });
    else back();
  });
  const drop = el.querySelector<HTMLElement>(".period-drop");
  const closeDrop = () => drop?.classList.remove("is-open");
  el.querySelector("[data-period-toggle]")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    drop?.classList.toggle("is-open");
  });
  el.querySelectorAll<HTMLButtonElement>("[data-scale]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeDrop();
      const next = btn.dataset.scale;
      historyScale = next === "year" || next === "quarter" ? next : "month";
      historySelect = null;
      go({ id: "past-quarter" }, { replace: true });
    });
  });
  el.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    if (!t.closest(".period-wrap")) closeDrop();
  });
  el.querySelectorAll<HTMLButtonElement>("[data-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const periodId = btn.dataset.period ?? "";
      if (!periodId) return;
      if (historySelect) {
        if (historySelect.ids.has(periodId)) historySelect.ids.delete(periodId);
        else historySelect.ids.add(periodId);
        paintSelect();
        return;
      }
      go({ id: "history-period", periodId });
    });
  });
  el.querySelector("[data-hist-download]")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget as HTMLButtonElement;
    if (!snaps.length) return;
    if (!historySelect || historySelect.mode !== "download") {
      historySelect = { mode: "download", ids: historySelect?.ids ?? new Set() };
      paintSelect();
      return;
    }
    const picked = selectedSnaps();
    if (!picked.length) {
      showToast("Select at least one period.");
      return;
    }
    btn.disabled = true;
    try {
      showToast(await downloadHistoryWheels(picked));
      historySelect = null;
      paintSelect();
    } catch {
      showToast("Could not save those wheels.");
    } finally {
      btn.disabled = false;
    }
  });
  el.querySelector("[data-hist-delete]")?.addEventListener("click", () => {
    if (!snaps.length) return;
    if (!historySelect || historySelect.mode !== "delete") {
      historySelect = { mode: "delete", ids: historySelect?.ids ?? new Set() };
      paintSelect();
      return;
    }
    const picked = selectedSnaps();
    if (!picked.length) {
      showToast("Select at least one period.");
      return;
    }
    const count = picked.length;
    const noun = count === 1 ? periodLabel(picked[0]) : `${count} periods`;
    const cascade = cascadePrompt(scale);
    el.querySelector(".over-sheet")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "over-sheet";
    sheet.innerHTML = `
      <div class="over-card">
        <h2 class="headline">Delete ${escapeHtml(noun)}?</h2>
        <p class="sub">If this data has not been downloaded, it will be deleted forever.</p>
        ${
          cascade
            ? `<label class="check-row">
          <input type="checkbox" data-cascade />
          <span>
            <strong>${escapeHtml(cascade.label)}</strong>
            <span class="muted">${escapeHtml(cascade.hint)}</span>
          </span>
        </label>`
            : ""
        }
        <button type="button" class="btn btn-primary btn-xl" data-del-yes>Delete forever</button>
        <button type="button" class="btn btn-ghost" data-del-no>Cancel</button>
      </div>`;
    el.querySelector(".screen")?.append(sheet);
    sheet.querySelector("[data-del-no]")?.addEventListener("click", () => sheet.remove());
    sheet.querySelector("[data-del-yes]")?.addEventListener("click", async () => {
      const checked = Boolean(sheet.querySelector<HTMLInputElement>("[data-cascade]")?.checked);
      const removed = await deleteHistorySnapshots(
        picked.map((snap) => snap.id),
        {
          cascadeQuarters: Boolean(cascade?.quarters && checked),
          cascadeYears: Boolean(cascade?.years && checked),
        },
      );
      historySelect = null;
      showToast(removed === 1 ? "That period is gone." : `Deleted ${removed} periods.`);
    });
  });
  bindNav(el);
  return el;
}

/** One saved period: same wheel / graph as home, frozen numbers. */
export function renderHistoryPeriod(periodId: string): HTMLElement {
  const snap = findHistorySnapshot(periodId);
  const el = document.createElement("div");
  if (!snap) {
    el.innerHTML = `
      <section class="screen">
        ${topBar("Spending history")}
        <h2 class="headline">That period is gone</h2>
        <p class="sub">It may have been deleted from this device.</p>
        <button type="button" class="btn btn-primary btn-xl" data-back>Back to history</button>
      </section>`;
    el.querySelector("[data-back]")?.addEventListener("click", () => {
      resetNav({ id: "past-quarter" });
    });
    return el;
  }

  const slices = historyWheelSlices(snap);
  const selected = slices.find((s) => s.id === selectedSliceId) ?? null;
  const totals = budgetSpendTotals(slices);
  const monthlyIncome = snap.monthlyIncome;
  const periodIncome = monthlyIncome * snap.periodMonths;
  const word = periodWord(snap.scale);
  const graphMode = state.homeChart === "bars";
  const totalBudgeted = totals.budgeted;
  const shareLabel = selected ? incomeShareLabel(selected.budgeted, monthlyIncome, selected.id) : "";
  const snapTxs = transactionsForSnapshot(snap);
  const previewFmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const historyPreview =
    selected?.id === EXTRA_FUNDS_ID
      ? extraFundsActivityFromTxs(snapTxs, slices)
      : snapTxs
          .filter((t) => t.categoryId === selected?.id)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((t): CategoryActivityLine => ({
            id: t.id,
            amount: t.amount,
            createdAt: t.createdAt,
            kind: t.kind === "in" ? "in" : "out",
          }));
  const txMarkup = selected
    ? historyPreview
        .slice(0, 3)
        .map(
          (line) =>
            `<div class="tx-row"><span>${activityLineLabel(line, previewFmt, word)}</span>${txAmountCell(line.kind, line.amount)}</div>`,
        )
        .join("") ||
      `<p class="muted tiny">${selected.id === EXTRA_FUNDS_ID ? `No Extra Funds activity yet this ${word}.` : `No purchases yet this ${word}.`}</p>`
    : "";
  const graphDetail = graphMode
    ? graphDetailMarkup({
        selected,
        totals,
        monthlyIncome,
        periodIncome,
        totalBudgeted,
        periodWord: word,
        addedFunds: extraInFromTransactions(snapTxs),
      })
    : "";
  const wheelDetail =
    !graphMode && selected
      ? `<div class="slice-card" data-slice-detail role="button" tabindex="0">
              <div class="slice-card-top">
                <button type="button" class="cat-swatch" data-color-for="${selected.id}" style="background:${selected.color}" aria-label="Change color"></button>
                <span class="slice-card-copy">
                  <strong>${escapeHtml(selected.name)}</strong>
                  <span class="muted">${shareLabel}</span>
                </span>
              </div>
              ${txMarkup}
            </div>`
      : "";

  el.innerHTML = `
    <section class="screen screen-home${graphMode ? " is-graph" : ""}">
      <div class="screen-body">
      <header class="home-head is-toolbar">
        <button type="button" class="icon-btn" data-back aria-label="Back">${backChevron}</button>
        <div class="home-head-title">
          <h1 class="quarter-title">${escapeHtml(periodLabel(snap))}</h1>
        </div>
        ${chartToggleMarkup(graphMode)}
      </header>
      ${graphDetail}
      ${
        graphMode
          ? budgetChartMarkup(slices, { selectedId: selectedSliceId })
          : wheelBlockMarkup(slices, { selected, totals, periodIncome })
      }
      ${wheelDetail}
      ${
        selected
          ? ""
          : slices.length && graphMode
            ? ""
            : `<p class="hint center-hint">${slices.length ? (graphMode ? "Tap a bar for details" : "Tap a slice for details") : `No spending in this ${word}.`}</p>`
      }
      </div>
    </section>`;

  el.querySelector("[data-back]")?.addEventListener("click", () => back());
  bindChartToggle(el);
  bindWheelBlock(el, slices);
  bindSliceDetail(el, () => {
    if (selected) go({ id: "category-activity", categoryId: selected.id, periodId: snap.id });
  });
  el.querySelector("[data-color-for]")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const id = (ev.currentTarget as HTMLElement).dataset.colorFor ?? "";
    openColorPicker(el, id);
  });
  return el;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function renderSettings(): HTMLElement {
  historySelect = null;
  const income = state.income;
  const st = income ? findState(income.state) : undefined;
  const sources = listedSources(income);
  const canDelete = sources.length > 1;
  const q = getQuarter();
  const el = document.createElement("div");
  const incomeCount = sources.length;
  const incomeTabTitle = incomeCount === 0 ? "Income" : incomeCount === 1 ? "1 Income" : `${incomeCount} Incomes`;
  const incomeRows = sources
    .map((source, i) => {
      const label = incomeSlotLabel(i + 1);
      const del = canDelete
        ? `<button type="button" class="icon-btn icon-btn-danger settings-del" data-del-inc="${escapeHtml(source.id)}" aria-label="Delete ${escapeHtml(label)}">${trashCan}</button>`
        : "";
      return `
      <div class="income-line">
        <button type="button" class="income-edit" data-inc="${escapeHtml(source.id)}">
          <span>
            <strong>${escapeHtml(label)}</strong>
            <span class="muted">${escapeHtml(sourceTypeLabel(source))} · ${formatMoney(source.monthlyTakeHome)}</span>
          </span>
          <span class="chevron">›</span>
        </button>
        ${del}
      </div>`;
    })
    .join("");
  el.innerHTML = `
    <section class="screen screen-settings">
      <div class="screen-body">
      <header class="home-head">
        <div>
          <p class="brand-mini">Settings</p>
          <h1 class="quarter-title">${q.label}</h1>
        </div>
      </header>
      <div class="account-card">
        <p class="account-kicker">This device</p>
        <p class="account-email">On-device budget</p>
        <p class="muted tiny">Your information stays on this device. It is not uploaded to any server.</p>
      </div>
      <div class="settings-row incomes-tab">
        <div class="incomes-tab-head">
          <span>
            <strong>${escapeHtml(incomeTabTitle)}</strong>
            <span class="muted">${
              income
                ? `${formatMoney(income.monthlyTakeHome)} / month · ${escapeHtml(st?.name ?? income.state)}`
                : "Not set"
            }</span>
          </span>
        </div>
        ${incomeRows}
        <button type="button" class="income-add" id="tour-income" data-extra>
          <span>
            <strong>Add ${incomeSlotLabel(nextIncomeNumber(income))}</strong>
            <span class="muted">Another paycheck or extra cash</span>
          </span>
          <span class="chevron">›</span>
        </button>
      </div>
      <button type="button" class="settings-row" data-appearance>
        <span>
          <strong>Appearance</strong>
          <span class="muted">${escapeHtml(themeLabel())}</span>
        </span>
        <span class="chevron">›</span>
      </button>
      <button type="button" class="settings-row" id="tour-widget" data-widget>
        <span>
          <strong>${widgetUnlockState() === "locked" ? "Home Widget" : "Add Widget"}</strong>
          <span class="muted">${
            widgetUnlockState() === "locked"
              ? `${escapeHtml(widgetPriceLabel())} one-time. Wheel and purchases on the home screen.`
              : "Home-screen wheel. Log purchases from there."
          }</span>
        </span>
        <span class="chevron">›</span>
      </button>
      <button type="button" class="settings-row" id="tour-history" data-past>
        <span>
          <strong>Spending History</strong>
          <span class="muted">Past months, and download</span>
        </span>
        <span class="chevron">›</span>
      </button>
      <button type="button" class="settings-row" data-rate>
        <span>
          <strong>Rate Budget Wheel</strong>
          <span class="muted">Open the Play Store listing</span>
        </span>
        <span class="chevron">›</span>
      </button>
      <button type="button" class="settings-row" data-help>
        <span>
          <strong>Help</strong>
          <span class="muted">FAQ and contact</span>
        </span>
        <span class="chevron">›</span>
      </button>
      <button type="button" class="settings-row" data-privacy>
        <span>
          <strong>Privacy</strong>
          <span class="muted">Your information stays on this device</span>
        </span>
        <span class="chevron">›</span>
      </button>
      <div class="settings-note">
        <p>Take-home is an estimate (single filer, no local tax). The wheel is monthly unless you change it on the home screen. Category budgets stay month to month. Spending starts over on the 1st. Every closed month, quarter, and year stays under Spending history on this device until you delete it.</p>
      </div>
      <div class="settings-reset-wrap">
        <button type="button" class="btn btn-ghost btn-danger settings-reset" data-reset>Reset Budget Data</button>
      </div>
      </div>
      ${navBar("settings")}
    </section>`;
  el.querySelectorAll<HTMLButtonElement>("[data-inc]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openIncomeSource(btn.dataset.inc ?? "");
    });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-del-inc]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.delInc ?? "";
      const source = sources.find((s) => s.id === id);
      if (!id || !source) return;
      const index = sources.findIndex((s) => s.id === id);
      const label = incomeSlotLabel(index + 1);
      el.querySelector(".over-sheet")?.remove();
      const sheet = document.createElement("div");
      sheet.className = "over-sheet";
      sheet.innerHTML = `
        <div class="over-card">
          <h2 class="headline">Delete ${escapeHtml(label)}?</h2>
          <p class="sub">${formatMoney(source.monthlyTakeHome)} / month will be removed.</p>
          <button type="button" class="btn btn-primary btn-xl" data-del-yes>Yes, delete it</button>
          <button type="button" class="btn btn-ghost" data-del-no>Cancel</button>
        </div>`;
      el.querySelector(".screen")?.append(sheet);
      sheet.querySelector("[data-del-no]")?.addEventListener("click", () => sheet.remove());
      sheet.querySelector("[data-del-yes]")?.addEventListener("click", async () => {
        await removeIncomeSource(id);
      });
    });
  });
  el.querySelector("[data-extra]")?.addEventListener("click", () => {
    go({ id: "extra-income" });
  });
  el.querySelector("[data-appearance]")?.addEventListener("click", () => {
    el.querySelector(".over-sheet")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "over-sheet";
    const on = state.theme;
    sheet.innerHTML = `
      <div class="over-card">
        <p class="brand-mini">Appearance</p>
        <h2 class="headline">How the wheel looks</h2>
        <p class="sub">Dark is the default. Light and System stay on this device.</p>
        <div class="choice-stack">
          <button type="button" class="choice-card${on === "dark" ? " is-on" : ""}" data-theme="dark">
            <span class="choice-title">Dark</span>
            <span class="choice-sub">Near-black canvas. Easier at night.</span>
          </button>
          <button type="button" class="choice-card${on === "light" ? " is-on" : ""}" data-theme="light">
            <span class="choice-title">Light</span>
            <span class="choice-sub">Paper-warm. The wheel keeps the same colors.</span>
          </button>
          <button type="button" class="choice-card${on === "system" ? " is-on" : ""}" data-theme="system">
            <span class="choice-title">System default</span>
            <span class="choice-sub">Follow this phone’s light or dark setting.</span>
          </button>
        </div>
        <button type="button" class="btn btn-ghost" data-close>Done</button>
      </div>`;
    el.querySelector(".screen")?.append(sheet);
    sheet.querySelector("[data-close]")?.addEventListener("click", () => sheet.remove());
    sheet.addEventListener("click", (ev) => {
      if (ev.target === sheet) sheet.remove();
    });
    sheet.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const next = btn.dataset.theme === "light" || btn.dataset.theme === "system" ? btn.dataset.theme : "dark";
        await setTheme(next);
      });
    });
  });
  el.querySelector("[data-widget]")?.addEventListener("click", async () => {
    if (widgetUnlockState() === "locked") {
      el.querySelector(".over-sheet")?.remove();
      const sheet = document.createElement("div");
      sheet.className = "over-sheet";
      const price = escapeHtml(widgetPriceLabel());
      sheet.innerHTML = `
        <div class="over-card">
          <p class="brand-mini">Home Widget</p>
          <h2 class="headline">Wheel on your home screen</h2>
          <p class="sub">See what’s left this month and log a purchase without opening the app.</p>
          <p class="sub">${price} one-time. Yours on this Google account after you buy.</p>
          <button type="button" class="btn btn-primary btn-xl" data-widget-buy>Unlock for ${price}</button>
          <label class="field">
            <span class="field-label">Promo code</span>
            <input class="text-input" type="text" autocomplete="off" spellcheck="false" data-widget-code placeholder="Enter code" />
          </label>
          <p class="field-error" data-widget-code-err hidden></p>
          <button type="button" class="btn btn-ghost" data-widget-redeem>Redeem code</button>
          <button type="button" class="btn btn-ghost" data-widget-ok>Not now</button>
        </div>`;
      el.querySelector(".screen")?.append(sheet);
      const codeInput = sheet.querySelector<HTMLInputElement>("[data-widget-code]");
      const codeErr = sheet.querySelector<HTMLElement>("[data-widget-code-err]");
      sheet.querySelector("[data-widget-buy]")?.addEventListener("click", () => {
        buyHomeWidget();
      });
      sheet.querySelector("[data-widget-redeem]")?.addEventListener("click", () => {
        const result = redeemWidgetCode(codeInput?.value ?? "");
        if (result === "ok") {
          sheet.remove();
          showToast("Widget unlocked");
          return;
        }
        if (codeErr) {
          codeErr.hidden = false;
          codeErr.textContent = "That code doesn’t work.";
        }
      });
      codeInput?.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        (sheet.querySelector("[data-widget-redeem]") as HTMLButtonElement | null)?.click();
      });
      sheet.querySelector("[data-widget-ok]")?.addEventListener("click", () => sheet.remove());
      sheet.addEventListener("click", (ev) => {
        if (ev.target === sheet) sheet.remove();
      });
      return;
    }
    const result = await pinHomeWidget();
    if (result === "pinned") return;
    if (result === "locked") return;
    el.querySelector(".over-sheet")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "over-sheet";
    sheet.innerHTML = `
      <div class="over-card">
        <p class="brand-mini">Add Widget</p>
        <h2 class="headline">Put the wheel on your home screen</h2>
        <p class="sub">Long-press your home screen, then open Widgets and choose Budget Wheel.</p>
        <p class="sub">You’ll see what’s left this month, and you can log a purchase, without opening the app.</p>
        <button type="button" class="btn btn-primary btn-xl" data-widget-ok>Got it</button>
      </div>`;
    el.querySelector(".screen")?.append(sheet);
    sheet.querySelector("[data-widget-ok]")?.addEventListener("click", () => sheet.remove());
    sheet.addEventListener("click", (ev) => {
      if (ev.target === sheet) sheet.remove();
    });
  });
  el.querySelector("[data-past]")?.addEventListener("click", () => {
    go({ id: "past-quarter" });
  });
  el.querySelector("[data-rate]")?.addEventListener("click", () => {
    openPlayStore();
  });
  el.querySelector("[data-help]")?.addEventListener("click", () => {
    el.querySelector(".over-sheet")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "over-sheet";
    sheet.innerHTML = `
      <div class="over-card help-card">
        <p class="brand-mini">Help</p>
        <h2 class="headline">How the wheel works</h2>
        <details class="faq">
          <summary>Add a Slice</summary>
          <p>Open Categories, then Other, to add a custom category. Tap a slice to change its color.</p>
        </details>
        <details class="faq">
          <summary>Switch Views</summary>
          <p>Tap the wheel or graph icon in the top right. Same money, two views.</p>
        </details>
        <details class="faq">
          <summary>Add Income</summary>
          <p>Settings → Add another paycheck. Extra income resizes what the wheel can hold. It does not import paychecks.</p>
        </details>
        <details class="faq">
          <summary>Add Widget</summary>
          <p>Settings → Home Widget. The home-screen widget is a $1.99 one-time unlock. After that, pin it and log purchases from there.</p>
        </details>
        <details class="faq">
          <summary>Spending History</summary>
          <p>When a month ends, it stays under Spending History. Open a past month, or download a picture and a CSV from there.</p>
        </details>
        <button type="button" class="settings-row" data-contact>
          <span>
            <strong>Contact</strong>
            <span class="muted">Play Store listing for Budget Wheel</span>
          </span>
          <span class="chevron">›</span>
        </button>
        <button type="button" class="btn btn-ghost" data-close>Close</button>
        <button type="button" class="btn btn-ghost help-replay" data-replay>Replay Tour</button>
      </div>`;
    el.querySelector(".screen")?.append(sheet);
    sheet.querySelector("[data-close]")?.addEventListener("click", () => sheet.remove());
    sheet.querySelector("[data-replay]")?.addEventListener("click", () => {
      startTour({ replay: true });
    });
    sheet.querySelector("[data-contact]")?.addEventListener("click", () => {
      openPlayStore();
    });
    sheet.addEventListener("click", (ev) => {
      if (ev.target === sheet) sheet.remove();
    });
  });
  el.querySelector("[data-privacy]")?.addEventListener("click", () => {
    el.querySelector(".over-sheet")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "over-sheet";
    sheet.innerHTML = `
      <div class="over-card">
        <p class="brand-mini">Privacy</p>
        <h2 class="headline">Your information stays on this device</h2>
        <p class="sub">Budget Wheel does not collect, transmit, or sell your personal or financial information. Your income and spending history are stored only on this device.</p>
        <p class="sub">Nothing is uploaded to any server or shared with third parties. If you uninstall the app or erase this device, that information cannot be recovered.</p>
        <button type="button" class="btn btn-primary btn-xl" data-privacy-ok>Got it</button>
      </div>`;
    el.querySelector(".screen")?.append(sheet);
    sheet.querySelector("[data-privacy-ok]")?.addEventListener("click", () => sheet.remove());
    sheet.addEventListener("click", (ev) => {
      if (ev.target === sheet) sheet.remove();
    });
  });
  el.querySelector("[data-reset]")?.addEventListener("click", () => {
    el.querySelector(".over-sheet")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "over-sheet";
    sheet.innerHTML = `
      <div class="over-card">
        <h2 class="headline">Reset budget data?</h2>
        <p class="sub">Income, categories, purchases, and spending history on this device will be erased. This cannot be undone.</p>
        <button type="button" class="btn btn-primary btn-xl" data-reset-yes>Erase everything</button>
        <button type="button" class="btn btn-ghost" data-reset-no>Cancel</button>
      </div>`;
    el.querySelector(".screen")?.append(sheet);
    sheet.querySelector("[data-reset-no]")?.addEventListener("click", () => sheet.remove());
    sheet.querySelector("[data-reset-yes]")?.addEventListener("click", async () => {
      await resetAll();
    });
  });
  bindNav(el);
  return el;
}
