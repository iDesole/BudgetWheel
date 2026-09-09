/**
 * In-app / PWA widget at /widget (add-to-home WebView).
 * Always this calendar month (income, envelopes, spend) — not quarter/year.
 * The launcher AppWidget is native Kotlin and must stay in lockstep with
 * this purchase flow: selected slice → log here, otherwise pick a category.
 */
import { formatMoney, formatPct, parsePad, padDisplay, appendPad, escapeHtml } from "../lib/money.ts";
import { isWidgetPath, openFullApp } from "../lib/widget.ts";
import {
  addExtraFunds,
  addPurchase,
  sessionUser,
  setSelectedSlice,
  showToast,
  sortedCategories,
  state,
  selectedSliceId,
} from "../store.ts";
import { EXTRA_FUNDS_ID, budgetSpendTotals, extraFundsAdded, isFundsIn, withExtraFundsPool } from "../lib/categories.ts";
import { backChevron } from "../ui/icons.ts";
import { bindNumpad, numpadMarkup } from "../ui/numpad.ts";
import { wheelCenterMarkup, wheelSvg } from "../ui/wheel.ts";

type WidgetPhase = "wheel" | "amount" | "category";

let phase: WidgetPhase = "wheel";
let pad = "";
let amount = 0;
let logging = false;

function monthSlices() {
  const now = new Date();
  const spent = new Map<string, number>();
  let extraIn = 0;
  for (const tx of state.transactions) {
    const at = new Date(tx.createdAt);
    if (at.getFullYear() !== now.getFullYear() || at.getMonth() !== now.getMonth()) continue;
    extraIn += extraFundsAdded(tx);
    if (isFundsIn(tx)) continue;
    spent.set(tx.categoryId, (spent.get(tx.categoryId) ?? 0) + tx.amount);
  }
  return withExtraFundsPool(
    sortedCategories()
      .filter((c) => !c.hidden && (c.id === EXTRA_FUNDS_ID || c.budgeted > 0 || (spent.get(c.id) ?? 0) > 0))
      .map((c) => {
        const used = spent.get(c.id) ?? 0;
        const envelope = c.id === EXTRA_FUNDS_ID ? c.budgeted + extraIn : c.budgeted;
        return { ...c, spent: used, envelope, remaining: envelope - used };
      }),
  );
}

function monthIncome(): number {
  const now = new Date();
  let extraIn = 0;
  for (const tx of state.transactions) {
    const at = new Date(tx.createdAt);
    if (at.getFullYear() !== now.getFullYear() || at.getMonth() !== now.getMonth()) continue;
    extraIn += extraFundsAdded(tx);
  }
  return (state.income?.monthlyTakeHome ?? 0) + extraIn;
}

function goPhase(next: WidgetPhase): void {
  const prev = phase;
  phase = next;
  if (next === "wheel") {
    pad = "";
    amount = 0;
    logging = false;
  }
  if (next === "amount" && prev !== "category") pad = "";
  paintCurrent();
}

function paintCurrent(): void {
  const el = document.querySelector<HTMLElement>("#app > div");
  if (el) paintWidget(el);
}

export function resetWidget(): void {
  phase = "wheel";
  pad = "";
  amount = 0;
  logging = false;
}

export function handleWidgetBack(): boolean {
  const inWidget = isWidgetPath() || document.body.classList.contains("is-widget");
  if (!inWidget || phase === "wheel") return false;
  if (phase === "category") {
    goPhase("amount");
  } else {
    goPhase("wheel");
  }
  try {
    window.history.pushState({ widget: phase }, "", "/widget");
  } catch {
    /* private mode / quota */
  }
  return true;
}

export function renderWidget(): HTMLElement {
  const el = document.createElement("div");
  paintWidget(el);
  return el;
}

function paintWidget(el: HTMLElement): void {
  if (!sessionUser) {
    el.innerHTML = lockedMarkup(
      "Open Budget Wheel first",
      "Open the app and set up your budget. Then this widget shows your wheel.",
    );
    bindLocked(el);
    return;
  }
  if (!state.onboardingComplete) {
    el.innerHTML = lockedMarkup(
      "Finish setup first",
      "Set income and categories in the app, then come back here to log purchases.",
    );
    bindLocked(el);
    return;
  }

  if (phase === "amount") {
    el.innerHTML = amountMarkup();
    bindAmount(el);
    return;
  }
  if (phase === "category") {
    el.innerHTML = categoryMarkup();
    bindCategory(el);
    return;
  }
  el.innerHTML = wheelMarkup();
  bindWheel(el);
}

function lockedMarkup(title: string, copy: string): string {
  return `
    <section class="screen screen-widget">
      <div class="screen-body">
        <header class="widget-head">
          <p class="brand-mini">Budget Wheel</p>
          <h1 class="quarter-title">${escapeHtml(title)}</h1>
        </header>
        <p class="sub">${escapeHtml(copy)}</p>
        <div class="flex-spacer"></div>
        <button type="button" class="btn btn-primary btn-xl" data-open-app>Open Budget Wheel</button>
      </div>
    </section>`;
}

function bindLocked(el: HTMLElement): void {
  el.querySelector("[data-open-app]")?.addEventListener("click", () => openFullApp());
}

function wheelMarkup(): string {
  const slices = monthSlices();
  const selected = slices.find((s) => s.id === selectedSliceId) ?? null;
  const totals = budgetSpendTotals(slices);
  const periodIncome = monthIncome();
  const centerLabel = selected ? selected.name : "Income";
  const centerValue = selected ? selected.remaining : periodIncome;
  return `
    <section class="screen screen-widget">
      <div class="screen-body">
        <header class="widget-head">
          <button type="button" class="widget-brand" data-open-app>
            <p class="brand-mini">Budget Wheel</p>
            <h1 class="quarter-title">${escapeHtml(centerLabel)}</h1>
          </button>
          <p class="widget-left ${centerValue < 0 ? "is-neg" : ""}">${formatMoney(centerValue)}</p>
        </header>
        <div class="widget-stage" data-phase="wheel">
          <div class="wheel-wrap">
            <div class="wheel-stage">
            ${wheelSvg(slices, { selectedId: selectedSliceId, interactive: true })}
            ${wheelCenterMarkup({
              label: centerLabel,
              value: formatMoney(centerValue),
              negative: centerValue < 0,
              subPrimary: selected
                ? selected.id === EXTRA_FUNDS_ID
                  ? `${formatMoney(selected.spent)} lost of ${formatMoney(selected.envelope)}`
                  : `${formatMoney(selected.spent)} of ${formatMoney(selected.envelope)}`
                : `${formatMoney(totals.spent)} spent`,
              subSecondary: selected ? undefined : `of ${formatMoney(totals.envelope)} budget`,
            })}
            </div>
            <div class="wheel-corner-totals is-oob">
              <div class="graph-stat">
                <span class="graph-stat-val${totals.outOfBudget > 0.009 ? " is-neg" : ""}">${formatMoney(totals.outOfBudget)}</span>
                <span class="graph-stat-lbl">out of budget</span>
              </div>
            </div>
            <div class="wheel-corner-totals is-left">
              <div class="graph-stat">
                <span class="graph-stat-val${totals.remaining < 0 ? " is-neg" : ""}">${formatMoney(totals.remaining < 0 ? -totals.remaining : totals.remaining)}</span>
                <span class="graph-stat-lbl">${totals.remaining < 0 ? "over-Budget" : "budget-left"}</span>
              </div>
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-purchase" data-buy>${
          selected?.id === EXTRA_FUNDS_ID ? "Add Funds" : "I purchased"
        }</button>
      </div>
    </section>`;
}

function bindWheel(el: HTMLElement): void {
  el.querySelector("[data-open-app]")?.addEventListener("click", () => openFullApp());
  el.querySelectorAll<HTMLElement>("[data-slice]").forEach((path) => {
    path.addEventListener("click", () => {
      const id = path.dataset.slice ?? null;
      setSelectedSlice(selectedSliceId === id ? null : id);
    });
  });
  el.querySelector("[data-buy]")?.addEventListener("click", () => {
    goPhase("amount");
  });
}

function amountMarkup(): string {
  const target = monthSlices().find((c) => c.id === selectedSliceId);
  const addingFunds = target?.id === EXTRA_FUNDS_ID;
  return `
    <section class="screen screen-widget screen-widget-pad">
      <div class="screen-body">
        <header class="topbar">
          <button type="button" class="icon-btn" data-back aria-label="Back">${backChevron}</button>
          <h1 class="topbar-title">${addingFunds ? "Add Funds" : "I purchased"}</h1>
          <span class="icon-btn-spacer"></span>
        </header>
        ${
          addingFunds
            ? `<p class="catalog-kicker">Extra cash that landed this month</p>`
            : target
              ? `<p class="catalog-kicker">Adding to ${escapeHtml(target.name)}</p>`
              : ""
        }
        <div class="widget-stage" data-phase="amount">
          <p class="display-amount" id="pad-display">${padDisplay(pad)}</p>
          <div class="flex-spacer"></div>
          ${numpadMarkup()}
        </div>
        <div class="pad-actions">
          <button type="button" class="btn btn-ghost" data-back>Back</button>
          <button type="button" class="btn btn-primary" data-next ${parsePad(pad) > 0 ? "" : "disabled"}>${
            addingFunds ? "Add Funds" : target ? `Add to ${escapeHtml(target.name)}` : "Continue"
          }</button>
        </div>
      </div>
    </section>`;
}

function bindAmount(el: HTMLElement): void {
  el.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => goPhase("wheel"));
  });
  const display = el.querySelector("#pad-display");
  const next = el.querySelector<HTMLButtonElement>("[data-next]");
  const refresh = () => {
    if (display) display.textContent = padDisplay(pad);
    if (next) next.disabled = parsePad(pad) <= 0;
  };
  bindNumpad(el, (key) => {
    pad = appendPad(pad, key);
    refresh();
  });
  next?.addEventListener("click", async () => {
    const value = parsePad(pad);
    if (value <= 0) return;
    amount = value;
    const target = monthSlices().find((c) => c.id === selectedSliceId);
    if (target) {
      if (next) next.disabled = true;
      pad = "";
      amount = 0;
      phase = "wheel";
      if (target.id === EXTRA_FUNDS_ID) {
        await addExtraFunds(value);
        setSelectedSlice(EXTRA_FUNDS_ID);
        return;
      }
      await addPurchase(target.id, value);
      setSelectedSlice(target.id);
      showToast(`Logged ${formatMoney(value)}`);
      return;
    }
    goPhase("category");
  });
}

function categoryMarkup(): string {
  const income = monthIncome();
  const cats = sortedCategories();
  const spentMap = new Map(monthSlices().map((c) => [c.id, c.spent]));
  return `
    <section class="screen screen-widget screen-widget-cats">
      <div class="screen-body">
        <header class="topbar">
          <button type="button" class="icon-btn" data-back aria-label="Back">${backChevron}</button>
          <h1 class="topbar-title">Which category?</h1>
          <span class="icon-btn-spacer"></span>
        </header>
        <p class="catalog-kicker">Logging ${formatMoney(amount)}</p>
        <div class="widget-stage" data-phase="category">
          <div class="catalog-list widget-cats">
            ${cats
              .filter((c) => !c.hidden && c.id !== EXTRA_FUNDS_ID)
              .map((c) => {
                const env = c.budgeted;
                const spent = spentMap.get(c.id) ?? 0;
                const left = env - spent;
                const share = income > 0 ? (c.budgeted / income) * 100 : 0;
                return `
                  <button type="button" class="cat-row" data-cat="${c.id}">
                    <span class="cat-swatch" style="background:${c.color}"></span>
                    <span class="cat-meta">
                      <span class="cat-name">${escapeHtml(c.name)}</span>
                      <span class="cat-left ${left < amount ? "is-warn" : ""}">${
                        c.budgeted > 0 ? `${formatMoney(left)} left` : "No budget set"
                      }</span>
                    </span>
                    <span class="cat-pct ${c.budgeted > 0 ? "has-value" : ""}">${
                      c.budgeted > 0 ? formatPct(share, share < 10 ? 1 : 0) : "—"
                    }</span>
                  </button>`;
              })
              .join("")}
          </div>
        </div>
      </div>
    </section>`;
}

function bindCategory(el: HTMLElement): void {
  el.querySelector("[data-back]")?.addEventListener("click", () => goPhase("amount"));
  el.querySelectorAll<HTMLButtonElement>("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (logging) return;
      const id = btn.dataset.cat ?? "";
      if (!id) return;
      logging = true;
      el.querySelectorAll<HTMLButtonElement>("[data-cat]").forEach((b) => {
        b.disabled = true;
      });
      const logged = amount;
      phase = "wheel";
      pad = "";
      amount = 0;
      await addPurchase(id, logged);
      setSelectedSlice(id);
      showToast(`Logged ${formatMoney(logged)}`);
      logging = false;
    });
  });
}
