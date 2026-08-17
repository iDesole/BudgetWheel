/**
 * In-app screens after onboarding: home wheel/graph, spend history,
 * purchases, archived periods, and settings.
 * Shared chrome (graph header, top bar) lives at the top so home and
 * history render the same cards.
 */
import { incomeSlotLabel, listedSources, nextIncomeNumber, sourceTypeLabel } from "../lib/income.ts";
import { formatMoney, formatPct, parsePad, padDisplay, appendPad, escapeHtml } from "../lib/money.ts";
import { formatQuarterRange, getQuarter } from "../lib/quarter.ts";
import { findState } from "../lib/states.ts";
import {
  addPurchase,
  back,
  categoryById,
  categoryPeriodActivity,
  type CategoryActivityLine,
  deleteHistorySnapshots,
  deletePurchase,
  findHistorySnapshot,
  go,
  historySnapsForScale,
  historyWheelSlices,
  isOverBudget,
  periodMultiplier,
  removeIncomeSource,
  periodSpentMap,
  quarterlyBudget,
  recentTransactions,
  resetAll,
  resetNav,
  setSelectedSlice,
  setWheelScale,
  showToast,
  toggleHomeChart,
  snapshotSpentTotal,
  sortedCategories,
  transactionsForSnapshot,
  state,
  selectedSliceId,
  wheelCategories,
} from "../store.ts";
import type { HistoryScale, WheelSnapshot } from "../types.ts";
import { EXTRA_FUNDS_ID, NOT_IN_BUDGET_ID } from "../lib/categories.ts";
import { downloadHistoryWheels } from "../lib/history-export.ts";
import { periodLabel, periodWord } from "../lib/history.ts";
import { openCategoryBudget, openColorPicker, openIncomeSource } from "./onboarding.ts";
import { backChevron, forwardChevron, logoSvg, trashCan } from "../ui/icons.ts";
import { bindNav, graphIcon, navBar, wheelIcon } from "../ui/nav.ts";
import { bindNumpad, numpadMarkup } from "../ui/numpad.ts";
import { wheelCenterMarkup, wheelSvg } from "../ui/wheel.ts";

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
      const over = s.envelope > 0 && s.spent > s.envelope + 0.009;
      const pct = s.envelope > 0 ? Math.min(100, (s.spent / s.envelope) * 100) : s.spent > 0 ? 100 : 0;
      const left = s.envelope - s.spent;
      return `
        <button type="button" class="budget-bar-row${opts.selectedId === s.id ? " is-selected" : ""}" data-slice="${s.id}">
          <span class="budget-bar-top">
            <span class="budget-bar-name">${escapeHtml(s.name)}</span>
            <span class="budget-bar-amt">${formatMoney(s.spent)} of ${s.envelope > 0 ? formatMoney(s.envelope) : "—"}</span>
          </span>
          <span class="budget-bar-track">
            <span class="budget-bar-fill${over ? " is-over" : ""}" style="width:${pct}%;background:${over ? "" : s.color}"></span>
          </span>
          <span class="budget-bar-meta">
            <span>${s.envelope > 0 ? formatPct(pct, pct < 10 && pct > 0 ? 1 : 0) : "No budget"}</span>
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

/** Assigned budgets only. Extra Funds is leftover income, not something the user set. */
function graphPeriodTotals(
  slices: Array<{ id: string; envelope: number; spent: number; budgeted: number }>,
): { envelope: number; spent: number; remaining: number; budgeted: number } {
  const assigned = slices.filter((s) => s.id !== EXTRA_FUNDS_ID);
  const envelope = assigned.reduce((sum, c) => sum + c.envelope, 0);
  const spent = slices.reduce((sum, c) => sum + c.spent, 0);
  const budgeted = assigned.reduce((sum, c) => sum + c.budgeted, 0);
  return { envelope, spent, remaining: envelope - spent, budgeted };
}

function budgetSpentOverMarkup(selected: { envelope: number; spent: number; remaining: number }): string {
  const over = selected.remaining < 0;
  return `<div class="graph-detail-stats">
    <div class="graph-stat">
      <span class="graph-stat-val">${selected.envelope > 0 ? formatMoney(selected.envelope) : "—"}</span>
      <span class="graph-stat-lbl">budgeted</span>
    </div>
    <div class="graph-stat">
      <span class="graph-stat-val">${formatMoney(selected.spent)}</span>
      <span class="graph-stat-lbl">spent</span>
    </div>
    <div class="graph-stat">
      <span class="graph-stat-val ${over ? "is-neg" : ""}">${formatMoney(over ? -selected.remaining : selected.remaining)}</span>
      <span class="graph-stat-lbl">${over ? "over-Budget" : "budget-left"}</span>
    </div>
  </div>`;
}

function incomeShareLabel(budgeted: number, monthlyIncome: number): string {
  if (budgeted > 0) {
    return `${formatPct(monthlyIncome > 0 ? (budgeted / monthlyIncome) * 100 : 0, 0)} of income`;
  }
  return "Not in your budget";
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
  totals: { envelope: number; spent: number; remaining: number };
  monthlyIncome: number;
  periodIncome: number;
  totalBudgeted: number;
  periodWord: string;
  canAddBudget?: boolean;
  interactive?: boolean;
}): string {
  if (opts.selected) {
    return `<div class="graph-detail"${opts.interactive ? ` data-slice-detail role="button" tabindex="0"` : ""}>
              <div class="graph-detail-head">
                <button type="button" class="cat-swatch" data-color-for="${opts.selected.id}" style="background:${opts.selected.color}" aria-label="Change color"></button>
                <span class="graph-detail-copy">
                  <strong>${escapeHtml(opts.selected.name)}</strong>
                  <span class="muted">${incomeShareLabel(opts.selected.budgeted, opts.monthlyIncome)}</span>
                </span>
                ${opts.canAddBudget ? `<button type="button" class="slice-add-budget" data-add-budget>Add to budget</button>` : ""}
              </div>
              ${budgetSpentOverMarkup(opts.selected)}
            </div>`;
  }
  return `<div class="graph-detail">
              <div class="graph-detail-head is-totals">
                <span class="graph-detail-copy">
                  <span class="muted">Income</span>
                  <strong>${formatMoney(opts.periodIncome)}</strong>
                </span>
              </div>
              ${budgetSpentOverMarkup(opts.totals)}
            </div>`;
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
  const totals = graphPeriodTotals(slices);
  const totalEnv = totals.envelope;
  const totalSpent = totals.spent;
  const totalLeft = totals.remaining;
  const monthlyIncome = state.income?.monthlyTakeHome ?? 0;
  const periodIncome = monthlyIncome * periodMultiplier();
  const scale = state.wheelScale;
  const monthLabel = new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" });
  const yearLabel = String(new Date().getFullYear());
  const over = isOverBudget() && !selected;
  const periodWord = scale === "year" ? "year" : scale === "quarter" ? "quarter" : "month";
  const centerLabel = selected ? selected.name : "Income";
  const scaleLabel = scale === "year" ? "Yearly" : scale === "quarter" ? "Quarterly" : "Monthly";
  const titleLabel = scale === "year" ? yearLabel : scale === "quarter" ? q.label : monthLabel;
  const centerValue = selected ? selected.remaining : periodIncome;

  const graphMode = state.homeChart === "bars";
  const totalBudgeted = totals.budgeted;
  const shareLabel = selected ? incomeShareLabel(selected.budgeted, monthlyIncome) : "";
  const canAddBudget = Boolean(
    selected &&
      selected.budgeted <= 0 &&
      selected.id !== EXTRA_FUNDS_ID &&
      selected.id !== NOT_IN_BUDGET_ID,
  );
  const txMarkup = selected
    ? recentTransactions(selected.id, 3)
        .map(
          (t) =>
            `<div class="tx-row"><span>${new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span><span>−${formatMoney(t.amount)}</span></div>`,
        )
        .join("") || `<p class="muted tiny">No purchases yet this ${periodWord}.</p>`
    : "";
  const graphDetail = graphMode
    ? graphDetailMarkup({
        selected,
        totals: { envelope: totalEnv, spent: totalSpent, remaining: totalLeft },
        monthlyIncome,
        periodIncome,
        totalBudgeted,
        periodWord,
        canAddBudget,
        interactive: true,
      })
    : "";
  const sliceDetail =
    !graphMode && selected
      ? `<div class="slice-card" data-slice-detail role="button" tabindex="0">
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
        <button type="button" class="icon-btn home-head-toggle" data-toggle-chart aria-label="${graphMode ? "Show wheel" : "Show graph"}">${graphMode ? wheelIcon : graphIcon}</button>
      </header>
      ${graphDetail}
      ${
        graphMode
          ? budgetChartMarkup(slices, {
              selectedId: selectedSliceId,
            })
          : `<div class="wheel-wrap">
        ${wheelSvg(slices, { selectedId: selectedSliceId, interactive: true, income: periodIncome })}
        ${wheelCenterMarkup({
          label: centerLabel,
          value: formatMoney(centerValue),
          negative: centerValue < 0,
          subPrimary: selected ? `${formatMoney(selected.spent)} of ${formatMoney(selected.envelope)}` : `${formatMoney(totalSpent)} spent`,
          subSecondary: selected ? undefined : `of ${formatMoney(totalEnv)} budget`,
        })}
        ${
          slices.length
            ? `<button type="button" class="wheel-cycle-btn is-left" data-cycle="1" aria-label="Previous category">${backChevron}</button>
               <button type="button" class="wheel-cycle-btn is-right" data-cycle="-1" aria-label="Next category">${forwardChevron}</button>`
            : ""
        }
      </div>`
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
            : `<p class="hint center-hint">${slices.length ? "Tap a slice for details" : "Set category amounts in Settings"}</p>`
      }
      <button type="button" class="btn btn-primary btn-purchase" data-buy>I purchased</button>
      </div>
      ${navBar("home")}
    </section>`;

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
  el.querySelector("[data-slice-detail]")?.addEventListener("click", () => {
    if (selected) go({ id: "category-activity", categoryId: selected.id });
  });
  el.querySelector("[data-slice-detail]")?.addEventListener("keydown", (ev) => {
    if (!(ev instanceof KeyboardEvent)) return;
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
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
  el.querySelector("[data-toggle-chart]")?.addEventListener("click", () => {
    void toggleHomeChart();
  });
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
    ? transactionsForSnapshot(snap)
        .filter((t) => t.categoryId === categoryId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((t): CategoryActivityLine => ({ id: t.id, amount: t.amount, createdAt: t.createdAt }))
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

  const spent = wheelCat?.spent ?? lines.reduce((sum, line) => sum + line.amount, 0);
  const envelope = wheelCat?.envelope ?? 0;
  const remaining = wheelCat?.remaining ?? envelope - spent;
  const rows = lines
    .map((line) => {
      const label = line.archiveLabel
        ? `${escapeHtml(line.archiveLabel)}<span class="muted"> · saved ${periodWord === "year" ? "quarter" : periodWord}</span>`
        : escapeHtml(new Date(line.createdAt).toLocaleDateString("en-US", dateFmt));
      const del = line.archiveLabel
        ? ""
        : `<button type="button" class="icon-btn icon-btn-danger activity-del" data-del="${escapeHtml(line.id)}" aria-label="Delete purchase">${trashCan}</button>`;
      return `<div class="tx-row activity-row${line.archiveLabel ? " is-archive" : ""}"><span>${label}</span><span class="activity-row-end"><span>−${formatMoney(line.amount)}</span>${del}</span></div>`;
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
      <p class="sub activity-summary">${formatMoney(spent)} spent${
        envelope > 0 ? ` of ${formatMoney(envelope)} · ${remaining < 0 ? `${formatMoney(-remaining)} over` : `${formatMoney(remaining)} left`}` : ""
      }</p>
      <div class="screen-body activity-list">
        ${rows || `<p class="muted tiny">No purchases yet this ${periodWord}.</p>`}
      </div>
    </section>`;
  el.querySelector("[data-back]")?.addEventListener("click", () => back());
  el.querySelector("[data-color-for]")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const id = (ev.currentTarget as HTMLElement).dataset.colorFor ?? "";
    openColorPicker(el, id);
  });
  el.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.del ?? "";
      const line = lines.find((item) => item.id === id);
      if (!id || !line || line.archiveLabel) return;
      el.querySelector(".over-sheet")?.remove();
      const sheet = document.createElement("div");
      sheet.className = "over-sheet";
      sheet.innerHTML = `
        <div class="over-card">
          <h2 class="headline">Delete this ${formatMoney(line.amount)} purchase?</h2>
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
  });
  return el;
}

// ---------------------------------------------------------------------------
// I purchased — amount pad, then category (skipped when a slice is selected)
// ---------------------------------------------------------------------------

export function renderPurchaseAmount(): HTMLElement {
  const target = wheelCategories().find((c) => c.id === selectedSliceId) ?? null;
  const el = document.createElement("div");
  el.innerHTML = `
    <section class="screen screen-pad">
      ${topBar("I purchased")}
      ${target ? `<p class="catalog-kicker">Adding to ${escapeHtml(target.name)}</p>` : ""}
      <p class="display-amount" id="pad-display">${padDisplay(purchasePad)}</p>
      <div class="flex-spacer"></div>
      ${numpadMarkup()}
      <div class="pad-actions">
        <button type="button" class="btn btn-ghost" data-back>Back</button>
        <button type="button" class="btn btn-primary" data-next ${parsePad(purchasePad) > 0 ? "" : "disabled"}>${
          target ? `Add to ${escapeHtml(target.name)}` : "Continue"
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
          ${logoSvg}
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
  const totals = graphPeriodTotals(slices);
  const totalEnv = totals.envelope;
  const totalSpent = totals.spent;
  const totalLeft = totals.remaining;
  const monthlyIncome = snap.monthlyIncome;
  const periodIncome = monthlyIncome * snap.periodMonths;
  const word = periodWord(snap.scale);
  const centerLabel = selected ? selected.name : "Income";
  const centerValue = selected ? selected.remaining : periodIncome;
  const graphMode = state.homeChart === "bars";
  const totalBudgeted = totals.budgeted;
  const shareLabel = selected ? incomeShareLabel(selected.budgeted, monthlyIncome) : "";
  const txMarkup = selected
    ? transactionsForSnapshot(snap)
        .filter((t) => t.categoryId === selected.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 3)
        .map(
          (t) =>
            `<div class="tx-row"><span>${new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span><span>−${formatMoney(t.amount)}</span></div>`,
        )
        .join("") || `<p class="muted tiny">No purchases yet this ${word}.</p>`
    : "";
  const graphDetail = graphMode
    ? graphDetailMarkup({
        selected,
        totals: { envelope: totalEnv, spent: totalSpent, remaining: totalLeft },
        monthlyIncome,
        periodIncome,
        totalBudgeted,
        periodWord: word,
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
        <button type="button" class="icon-btn home-head-toggle" data-toggle-chart aria-label="${graphMode ? "Show wheel" : "Show graph"}">${graphMode ? wheelIcon : graphIcon}</button>
      </header>
      ${graphDetail}
      ${
        graphMode
          ? budgetChartMarkup(slices, { selectedId: selectedSliceId })
          : `<div class="wheel-wrap">
        ${wheelSvg(slices, { selectedId: selectedSliceId, interactive: true, income: periodIncome })}
        ${wheelCenterMarkup({
          label: centerLabel,
          value: formatMoney(centerValue),
          negative: centerValue < 0,
          subPrimary: selected ? `${formatMoney(selected.spent)} of ${formatMoney(selected.envelope)}` : `${formatMoney(totalSpent)} spent`,
          subSecondary: selected ? undefined : `of ${formatMoney(totalEnv)} budget`,
        })}
        ${
          slices.length
            ? `<button type="button" class="wheel-cycle-btn is-left" data-cycle="1" aria-label="Previous category">${backChevron}</button>
               <button type="button" class="wheel-cycle-btn is-right" data-cycle="-1" aria-label="Next category">${forwardChevron}</button>`
            : ""
        }
      </div>`
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
  el.querySelector("[data-toggle-chart]")?.addEventListener("click", () => {
    void toggleHomeChart();
  });
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
  el.querySelector("[data-slice-detail]")?.addEventListener("click", () => {
    if (selected) go({ id: "category-activity", categoryId: selected.id, periodId: snap.id });
  });
  el.querySelector("[data-slice-detail]")?.addEventListener("keydown", (ev) => {
    if (!(ev instanceof KeyboardEvent)) return;
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
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
        <button type="button" class="income-add" data-extra>
          <span>
            <strong>Add ${incomeSlotLabel(nextIncomeNumber(income))}</strong>
            <span class="muted">Another paycheck or extra cash</span>
          </span>
          <span class="chevron">›</span>
        </button>
      </div>
      <button type="button" class="settings-row" data-past>
        <span>
          <strong>Spending history</strong>
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
        <button type="button" class="btn btn-ghost btn-danger settings-reset" data-reset>Reset budget data</button>
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
  el.querySelector("[data-past]")?.addEventListener("click", () => {
    go({ id: "past-quarter" });
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
