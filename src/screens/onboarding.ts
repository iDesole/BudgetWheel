import {
  estimateTaxes,
  incomeOrdinal,
  incomeSlotLabel,
  isSideSource,
  listedSources,
  monthlyGrossFromDraft,
  nextIncomeNumber,
} from "../lib/income.ts";
import { formatMoney, formatPct, parsePad, padDisplay, appendPad, escapeHtml } from "../lib/money.ts";
import { findState, stateTaxLabel, US_STATES } from "../lib/states.ts";
import {
  addCustomCategory,
  allocatedMonthly,
  allocatedPct,
  back,
  canGoBack,
  categoryById,
  completeOnboarding,
  draft,
  go,
  loadDraftFromSource,
  resetDraft,
  resetNav,
  removeCategory,
  saveIncomeFromDraft,
  setCategoryBudget,
  setCategoryColor,
  setCategoryHidden,
  setStateFilter,
  showToast,
  sortedCategories,
  state,
  stateFilter,
  updateDraft,
} from "../store.ts";
import { canHideCategory, CRAYOLA_64, EMERGENCY_ID, EXTRA_FUNDS_ID, NOT_IN_BUDGET_ID } from "../lib/categories.ts";
import { backChevron, eyeOff, eyeOpen, trashCan } from "../ui/icons.ts";
import { bindNav, navBar } from "../ui/nav.ts";
import { bindNumpad, numpadMarkup } from "../ui/numpad.ts";
import type { Screen } from "../types.ts";

let pad = "";
let customName = "";
let amountUnit: "money" | "percent" = "money";
let hideMode = false;
let incomeSaving = false;

function stepDots(current: number, total = 5): string {
  return `<div class="dots" aria-hidden="true">${Array.from({ length: total }, (_, i) => `<span class="dot${i === current ? " is-on" : ""}"></span>`).join("")}</div>`;
}

function topBar(title: string, showBack = true, rightHtml = ""): string {
  return `
    <header class="topbar">
      ${
        showBack
          ? `<button type="button" class="icon-btn" data-back aria-label="Back">${backChevron}</button>`
          : `<span class="icon-btn-spacer"></span>`
      }
      <h1 class="topbar-title">${title}</h1>
      ${rightHtml || `<span class="icon-btn-spacer"></span>`}
    </header>`;
}

function amountScreen(opts: {
  kicker: string;
  title: string;
  hint?: string;
  submitLabel: string;
  extra?: string;
  allowZero?: boolean;
  unit?: "money" | "hours" | "percent";
  modeToggle?: boolean;
  rightHtml?: string;
}): string {
  const unit = opts.unit ?? "money";
  const disabled = opts.allowZero ? "" : parsePad(pad) > 0 ? "" : "disabled";
  return `
    <section class="screen screen-pad">
      ${topBar(opts.kicker, true, opts.rightHtml)}
      ${
        opts.modeToggle
          ? `<div class="mode-toggle" role="tablist">
              <button type="button" class="mode-btn${unit === "money" ? " is-on" : ""}" data-mode="money">$</button>
              <button type="button" class="mode-btn${unit === "percent" ? " is-on" : ""}" data-mode="percent">%</button>
            </div>`
          : ""
      }
      <p class="display-label">${opts.title}</p>
      <p class="display-amount" id="pad-display">${padDisplay(pad, unit)}</p>
      ${opts.hint ? `<p class="hint">${opts.hint}</p>` : ""}
      ${opts.extra ?? ""}
      <div class="flex-spacer"></div>
      ${numpadMarkup()}
      <div class="pad-actions">
        <button type="button" class="btn btn-ghost" data-back>Back</button>
        <button type="button" class="btn btn-primary" data-submit ${disabled}>${opts.submitLabel}</button>
      </div>
    </section>`;
}

function bindBack(root: HTMLElement): void {
  root.querySelectorAll("[data-back]").forEach((el) => {
    el.addEventListener("click", () => back());
  });
}

function bindAmount(
  root: HTMLElement,
  onSubmit: (amount: number) => void,
  opts: { allowZero?: boolean; unit?: "money" | "hours" | "percent" } = {},
): void {
  bindBack(root);
  const display = root.querySelector("#pad-display");
  const submit = root.querySelector<HTMLButtonElement>("[data-submit]");
  const extra = () => root.querySelector("#live-extra");
  const unit = () => opts.unit ?? "money";
  const refresh = () => {
    if (display) display.textContent = padDisplay(pad, unit());
    if (submit) submit.disabled = opts.allowZero ? false : parsePad(pad) <= 0;
    const box = extra();
    if (box) box.innerHTML = liveHintHtml(unit());
  };
  bindNumpad(root, (key) => {
    pad = appendPad(pad, key);
    refresh();
  });
  submit?.addEventListener("click", () => {
    const raw = parsePad(pad);
    if (!opts.allowZero && raw <= 0) return;
    if (unit() === "percent") {
      const income = state.income?.monthlyTakeHome ?? 0;
      onSubmit(clampMoneyFromPct(raw, income));
      return;
    }
    onSubmit(raw);
  });
}

function clampMoneyFromPct(pct: number, income: number): number {
  if (income <= 0) return 0;
  return Math.round(((pct / 100) * income) * 100) / 100;
}

function liveHintHtml(unit: "money" | "hours" | "percent"): string {
  const income = state.income?.monthlyTakeHome ?? 0;
  if (income <= 0) return "";
  const n = parsePad(pad);
  if (unit === "percent") {
    return `That’s <strong>${formatMoney(clampMoneyFromPct(n, income))}</strong> / month`;
  }
  const pct = (n / income) * 100;
  return `That’s <strong>${formatPct(pct, pct < 10 ? 1 : 0)}</strong> of your monthly income`;
}

export { renderWelcomeAuth as renderWelcome } from "./auth.ts";

export function openColorPicker(host: HTMLElement, categoryId: string): void {
  if (!categoryId) return;
  host.querySelector(".color-pop")?.remove();
  const pop = document.createElement("div");
  pop.className = "color-pop";
  pop.innerHTML = `
    <div class="color-pop-card">
      <p class="color-pop-title">Pick a color</p>
      <div class="color-grid" role="listbox" aria-label="Classic Crayola 64">
        ${CRAYOLA_64.map(
          (c) =>
            `<button type="button" class="color-dot${c.hex === "#FFFFFF" || c.hex === "#FBE870" || c.hex === "#ECEBBD" ? " is-light" : ""}" data-hex="${c.hex}" style="background:${c.hex}" aria-label="${c.name}" title="${c.name}"></button>`,
        ).join("")}
      </div>
      <button type="button" class="btn btn-ghost" data-close-colors>Cancel</button>
    </div>`;
  host.querySelector(".screen")?.append(pop);
  pop.addEventListener("click", (ev) => {
    if (ev.target === pop) pop.remove();
  });
  pop.querySelector("[data-close-colors]")?.addEventListener("click", () => pop.remove());
  pop.querySelectorAll<HTMLButtonElement>("[data-hex]").forEach((dot) => {
    dot.addEventListener("click", async () => {
      await setCategoryColor(categoryId, dot.dataset.hex ?? "");
    });
  });
}

function seedPad(value: number | undefined): void {
  pad = value && value > 0 ? String(value % 1 === 0 ? value : value.toFixed(2)) : "";
}

function draftSlotNumber(): number {
  const sources = listedSources(state.income);
  if (draft.sourceId) {
    const i = sources.findIndex((s) => s.id === draft.sourceId);
    if (i >= 0) return i + 1;
  }
  return nextIncomeNumber(state.income);
}

function draftSlotLabel(): string {
  return incomeSlotLabel(draftSlotNumber());
}

function afterIncomeSaved(): void {
  if (state.onboardingComplete) {
    resetNav({ id: "settings" });
    return;
  }
  go({ id: "extra-income" });
}

export function openIncomeSource(sourceId: string): void {
  if (!loadDraftFromSource(sourceId)) return;
  if (isSideSource({ kind: draft.slot ?? "primary", type: draft.type ?? "salary" })) {
    seedPad(draft.monthlyTakeHomeOverride);
    go({ id: "side-amount" });
    return;
  }
  pad = "";
  go({ id: "pay-type" });
}

export function renderPayType(): HTMLElement {
  const extra = Boolean(draft.slot && draft.slot !== "primary");
  const extraLabel = draftSlotLabel();
  const extraJob = incomeOrdinal(draftSlotNumber()).toLowerCase();
  const el = document.createElement("div");
  el.innerHTML = `
    <section class="screen">
      ${topBar(extra ? extraLabel : "Income", canGoBack())}
      ${stepDots(0)}
      <h2 class="headline">${extra ? `Is the ${extraJob} job salary or hourly?` : "Do you get paid salary or hourly?"}</h2>
      <p class="sub">We’ll turn it into a monthly take-home estimate you can adjust.</p>
      <div class="choice-stack">
        <button type="button" class="choice-card${draft.type === "salary" ? " is-on" : ""}" data-type="salary">
          <span class="choice-title">Salary</span>
          <span class="choice-sub">Annual or monthly pay</span>
        </button>
        <button type="button" class="choice-card${draft.type === "hourly" ? " is-on" : ""}" data-type="hourly">
          <span class="choice-title">Hourly</span>
          <span class="choice-sub">Wage × hours per week</span>
        </button>
      </div>
    </section>`;
  bindBack(el);
  el.querySelectorAll<HTMLButtonElement>("[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.type === "hourly" ? "hourly" : "salary";
      updateDraft({ type });
      if (type === "hourly") {
        seedPad(draft.hourlyWage);
        go({ id: "hourly-wage" });
      } else {
        pad = "";
        go({ id: "salary-period" });
      }
    });
  });
  return el;
}

export function renderSalaryPeriod(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `
    <section class="screen">
      ${topBar("Salary")}
      ${stepDots(1)}
      <h2 class="headline">Is that annual or monthly?</h2>
      <p class="sub">Pick how you know the number. We’ll convert it to monthly.</p>
      <div class="choice-stack">
        <button type="button" class="choice-card" data-period="annual">
          <span class="choice-title">Annual</span>
          <span class="choice-sub">What you make per year before tax</span>
        </button>
        <button type="button" class="choice-card" data-period="monthly">
          <span class="choice-title">Monthly</span>
          <span class="choice-sub">What you make per month before tax</span>
        </button>
      </div>
    </section>`;
  bindBack(el);
  el.querySelectorAll<HTMLButtonElement>("[data-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const salaryPeriod = btn.dataset.period === "monthly" ? "monthly" : "annual";
      updateDraft({ salaryPeriod });
      pad = draft.salaryAmount ? String(draft.salaryAmount) : "";
      go({ id: "salary-amount" });
    });
  });
  return el;
}

export function renderSalaryAmount(): HTMLElement {
  const period = draft.salaryPeriod === "monthly" ? "monthly" : "annual";
  const el = document.createElement("div");
  el.innerHTML = amountScreen({
    kicker: "Salary",
    title: period === "monthly" ? "Monthly salary before tax" : "Annual salary before tax",
    hint: "Gross pay — we’ll estimate take-home next.",
    submitLabel: "Continue",
  });
  bindAmount(el, (amount) => {
    updateDraft({ salaryAmount: amount });
    go(draft.slot && draft.slot !== "primary" && draft.state ? { id: "income-confirm" } : { id: "state" });
  });
  return el;
}

export function renderHourlyWage(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = amountScreen({
    kicker: "Hourly",
    title: "What’s your hourly wage?",
    hint: "Use your typical rate before tax.",
    submitLabel: "Continue",
  });
  bindAmount(el, (amount) => {
    updateDraft({ hourlyWage: amount });
    pad = draft.hoursPerWeek ? String(draft.hoursPerWeek) : "";
    go({ id: "hourly-hours" });
  });
  return el;
}

export function renderHourlyHours(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = amountScreen({
    kicker: "Hourly",
    title: "Average hours per week?",
    hint: "Include overtime you can count on.",
    submitLabel: "Continue",
    unit: "hours",
  });
  bindAmount(
    el,
    (amount) => {
      updateDraft({ hoursPerWeek: amount });
      go(draft.slot && draft.slot !== "primary" && draft.state ? { id: "income-confirm" } : { id: "state" });
    },
    { unit: "hours" },
  );
  return el;
}

function filteredStates(filter: string) {
  const q = filter.trim().toLowerCase();
  return US_STATES.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
  );
}

function stateListHtml(filter: string): string {
  const list = filteredStates(filter);
  if (list.length === 0) return `<p class="empty-inline">No states match that search.</p>`;
  return list
    .map(
      (s) => `
          <button type="button" class="state-row${draft.state === s.code ? " is-on" : ""}" data-state="${s.code}">
            <span class="state-code">${s.code}</span>
            <span class="state-name">${s.name}</span>
            <span class="state-tax">${stateTaxLabel(s)}</span>
          </button>`,
    )
    .join("");
}

function bindStateRows(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-state]").forEach((btn) => {
    btn.addEventListener("click", () => {
      updateDraft({ state: btn.dataset.state, monthlyTakeHomeOverride: undefined });
      setStateFilter("", { silent: true });
      go({ id: "income-confirm" });
    });
  });
}

export function renderState(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `
    <section class="screen screen-list">
      ${topBar("State")}
      ${stepDots(3)}
      <h2 class="headline">Which state do you live in?</h2>
      <p class="sub">Used to estimate state wage tax for a single filer. City and county tax aren’t included.</p>
      <label class="search-wrap">
        <span class="visually-hidden">Search states</span>
        <input class="search" type="search" inputmode="search" placeholder="Search states" value="${escapeHtml(stateFilter)}" />
      </label>
      <div class="state-list">
        ${stateListHtml(stateFilter)}
      </div>
    </section>`;
  bindBack(el);
  const input = el.querySelector<HTMLInputElement>(".search");
  const list = el.querySelector(".state-list");
  input?.addEventListener("input", () => {
    setStateFilter(input.value, { silent: true });
    if (!list) return;
    list.innerHTML = stateListHtml(input.value);
    bindStateRows(el);
  });
  bindStateRows(el);
  return el;
}

export function renderIncomeConfirm(): HTMLElement {
  incomeSaving = false;
  const gross = monthlyGrossFromDraft(draft);
  const tax = draft.state ? estimateTaxes(gross, draft.state) : null;
  const takeHome = draft.monthlyTakeHomeOverride ?? tax?.monthlyTakeHome ?? 0;
  const st = draft.state ? findState(draft.state) : undefined;
  const overridden = draft.monthlyTakeHomeOverride != null;
  const el = document.createElement("div");
  el.innerHTML = `
    <section class="screen">
      ${topBar("Confirm income")}
      ${stepDots(4)}
      <h2 class="headline">Your monthly income</h2>
      <p class="sub">Estimate only — single filer, standard deduction, 2026 federal brackets, FICA, and published 2026 state rates. No local tax, 401(k), or other deductions. Tap the number if your real take-home is different.</p>
      <button type="button" class="income-hero" data-adjust>
        <span class="income-hero-label">Monthly take-home</span>
        <span class="income-hero-value">${formatMoney(takeHome)}</span>
        <span class="income-hero-cta">${overridden ? "Custom amount · tap to edit" : "Tap to adjust"}</span>
      </button>
      ${
        tax
          ? `<div class="tax-card">
              <div class="tax-row"><span>Gross / month</span><strong>${formatMoney(tax.monthlyGross)}</strong></div>
              <div class="tax-row"><span>Est. federal / month</span><span>${formatMoney(tax.federal / 12)}</span></div>
              <div class="tax-row"><span>Est. FICA / month</span><span>${formatMoney(tax.fica / 12)}</span></div>
              <div class="tax-row"><span>Est. ${escapeHtml(st?.name ?? "state")} tax / month</span><span>${formatMoney(tax.state / 12)}</span></div>
              <div class="tax-row tax-total"><span>Est. taxes / month</span><strong>${formatMoney(tax.annualTax / 12)}</strong></div>
            </div>`
          : ""
      }
      <div class="flex-spacer"></div>
      <button type="button" class="btn btn-primary btn-xl" data-confirm ${takeHome > 0 ? "" : "disabled"}>Use ${formatMoney(takeHome)}</button>
    </section>`;
  bindBack(el);
  el.querySelector("[data-adjust]")?.addEventListener("click", () => {
    pad = takeHome ? String(takeHome % 1 === 0 ? takeHome : takeHome.toFixed(2)) : "";
    go({ id: "income-adjust" });
  });
  el.querySelector("[data-confirm]")?.addEventListener("click", async () => {
    if (incomeSaving) return;
    incomeSaving = true;
    const btn = el.querySelector<HTMLButtonElement>("[data-confirm]");
    if (btn) btn.disabled = true;
    try {
      const income = await saveIncomeFromDraft();
      if (!income) {
        incomeSaving = false;
        if (btn) btn.disabled = takeHome <= 0;
        return;
      }
      afterIncomeSaved();
    } catch {
      incomeSaving = false;
      if (btn) btn.disabled = false;
    }
  });
  return el;
}

export function renderIncomeAdjust(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = amountScreen({
    kicker: "Take-home",
    title: "Adjust monthly take-home",
    hint: "This is the number every category percentage uses.",
    submitLabel: "Save",
  });
  bindAmount(el, (amount) => {
    updateDraft({ monthlyTakeHomeOverride: amount });
    back();
  });
  return el;
}

export function renderExtraIncome(): HTMLElement {
  const takeHome = state.income?.monthlyTakeHome ?? 0;
  const sources = listedSources(state.income);
  const nextLabel = incomeSlotLabel(nextIncomeNumber(state.income));
  const doneLabel = state.onboardingComplete ? "Done" : "Continue to budget";
  const el = document.createElement("div");
  el.innerHTML = `
    <section class="screen">
      ${topBar("More income", canGoBack())}
      <h2 class="headline">Any other income?</h2>
      <p class="sub">Estimated take-home is ${formatMoney(takeHome)} / month. Another paycheck is taxed together with your main pay. Side income is treated as already after tax.</p>
      ${
        sources.length
          ? `<div class="tax-card" style="margin-bottom:14px">${sources
              .map(
                (s, i) =>
                  `<div class="tax-row"><span>${incomeSlotLabel(i + 1)}${isSideSource(s) ? " · after tax" : ""}</span><strong>${formatMoney(s.monthlyTakeHome)}</strong></div>`,
              )
              .join("")}</div>`
          : ""
      }
      <div class="choice-stack">
        <button type="button" class="choice-card" data-second>
          <span class="choice-title">${nextLabel}</span>
          <span class="choice-sub">Another paycheck — estimated tax uses combined pay</span>
        </button>
        <button type="button" class="choice-card" data-side>
          <span class="choice-title">Side income</span>
          <span class="choice-sub">Already after tax — we won’t estimate tax on this</span>
        </button>
      </div>
      <div class="flex-spacer"></div>
      <button type="button" class="btn btn-primary btn-xl" data-continue>${doneLabel}</button>
    </section>`;
  bindBack(el);
  el.querySelector("[data-second]")?.addEventListener("click", () => {
    const st = state.income?.state;
    resetDraft();
    updateDraft({ slot: "second", state: st });
    pad = "";
    go({ id: "pay-type" });
  });
  el.querySelector("[data-side]")?.addEventListener("click", () => {
    const st = state.income?.state;
    resetDraft();
    updateDraft({ slot: "side", type: "side", state: st });
    pad = "";
    go({ id: "side-amount" });
  });
  el.querySelector("[data-continue]")?.addEventListener("click", () => {
    if (state.onboardingComplete) resetNav({ id: "settings" });
    else go({ id: "catalog", from: "onboarding" });
  });
  return el;
}

export function renderSideAmount(): HTMLElement {
  incomeSaving = false;
  const extraLabel = draftSlotLabel();
  const editing = Boolean(draft.sourceId);
  const el = document.createElement("div");
  el.innerHTML = amountScreen({
    kicker: extraLabel,
    title: "Typical monthly side income",
    hint: "Use take-home — what you actually keep after tax.",
    submitLabel: editing ? "Save" : "Add it",
  });
  bindAmount(el, async (amount) => {
    if (incomeSaving) return;
    incomeSaving = true;
    updateDraft({ monthlyTakeHomeOverride: amount, salaryAmount: amount, type: "side", slot: "side" });
    try {
      const saved = await saveIncomeFromDraft();
      if (saved) afterIncomeSaved();
      else incomeSaving = false;
    } catch {
      incomeSaving = false;
    }
  });
  return el;
}

export function renderCatalog(screen: Extract<Screen, { id: "catalog" }>): HTMLElement {
  const from = screen.from ?? (state.onboardingComplete ? "settings" : "onboarding");
  const onboarded = state.onboardingComplete;
  if (!onboarded) hideMode = false;
  const income = state.income?.monthlyTakeHome ?? 0;
  const pct = allocatedPct();
  const over = pct > 100.05;
  const cats = sortedCategories();
  const el = document.createElement("div");
  el.innerHTML = `
    <section class="screen screen-catalog">
      <header class="topbar topbar-catalog">
        ${
          onboarded
            ? `<button type="button" class="hide-pill${hideMode ? " is-on" : ""}" data-hide-toggle>${hideMode ? "Done" : "Hide"}</button>`
            : `<button type="button" class="icon-btn" data-back aria-label="Back">${backChevron}</button>`
        }
        <h1 class="topbar-title">${from === "onboarding" && !onboarded ? "Your budget" : "Categories"}</h1>
        <span class="icon-btn-spacer"></span>
      </header>
      <p class="catalog-kicker">${hideMode ? "Tap a category to hide or show it." : `Monthly income ${formatMoney(income)}`}</p>
      <div class="alloc-bar ${over ? "is-over" : ""}">
        <div class="alloc-top">
          <span>${formatPct(pct, pct < 10 && pct > 0 ? 1 : 0)} of income allocated</span>
          <span>${formatMoney(allocatedMonthly())}</span>
        </div>
        <div class="alloc-track">
          <div class="alloc-fill" style="width:${Math.min(pct, 100)}%"></div>
        </div>
      </div>
      <div class="catalog-list" data-scroll="catalog">
        ${
          hideMode
            ? ""
            : `<button type="button" class="cat-row cat-other" data-add>
          <span class="cat-swatch cat-swatch-add">+</span>
          <span class="cat-name">Other</span>
          <span class="cat-pct add-label">Add custom</span>
        </button>`
        }
        ${cats
          .map((c) => {
            const share = income > 0 ? (c.budgeted / income) * 100 : 0;
            const hideable = canHideCategory(c.id);
            return `
              <div class="cat-row-wrap${c.hidden ? " is-hidden-cat" : ""}">
                ${
                  hideMode && hideable
                    ? `<button type="button" class="eye-btn" data-eye="${c.id}" aria-label="${c.hidden ? "Show" : "Hide"} ${escapeHtml(c.name)}">${c.hidden ? eyeOff : eyeOpen}</button>`
                    : `<button type="button" class="cat-swatch" data-color-for="${c.id}" style="background:${c.color}" aria-label="Color ${escapeHtml(c.name)}"></button>`
                }
                <button type="button" class="cat-row" data-cat="${c.id}">
                  <span class="cat-name">${escapeHtml(c.name)}</span>
                  <span class="cat-pct ${c.budgeted > 0 && !c.hidden ? "has-value" : ""}">${c.hidden ? "Hidden" : c.budgeted > 0 ? formatPct(share, share < 10 ? 1 : 0) : "—"}</span>
                </button>
              </div>`;
          })
          .join("")}
      </div>
      ${
        onboarded
          ? navBar("categories")
          : `<div class="catalog-footer">
        <button type="button" class="btn btn-primary btn-xl" data-done>See my wheel</button>
      </div>`
      }
    </section>`;
  el.querySelector("[data-back]")?.addEventListener("click", () => back());
  el.querySelector("[data-hide-toggle]")?.addEventListener("click", () => {
    hideMode = !hideMode;
    go({ id: "catalog", from }, { replace: true });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-color-for]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openColorPicker(el, btn.dataset.colorFor ?? "");
    });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-eye], [data-cat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.eye ?? btn.dataset.cat ?? "";
      if (hideMode) {
        if (id === EXTRA_FUNDS_ID) {
          showToast("Extra Funds stays visible — it’s leftover income.");
          return;
        }
        if (id === NOT_IN_BUDGET_ID) {
          showToast("Not in the Budget stays visible.");
          return;
        }
        if (id === EMERGENCY_ID) {
          showToast("Emergency stays visible.");
          return;
        }
        const cat = categoryById(id);
        if (cat) await setCategoryHidden(id, !cat.hidden);
        return;
      }
      if (id === EXTRA_FUNDS_ID) {
        showToast("Extra Funds is leftover income you haven’t assigned.");
        return;
      }
      const cat = categoryById(id);
      if (cat?.hidden) return;
      openCategoryBudget(id, from);
    });
  });
  el.querySelector("[data-add]")?.addEventListener("click", () => {
    customName = "";
    go({ id: "add-custom", from });
  });
  el.querySelector("[data-done]")?.addEventListener("click", async () => {
    hideMode = false;
    await completeOnboarding();
  });
  if (onboarded) bindNav(el);
  return el;
}

export function renderBudgetAmount(screen: Extract<Screen, { id: "budget-amount" }>): HTMLElement {
  const isNew = screen.categoryId === "__new__";
  const cat = isNew ? undefined : categoryById(screen.categoryId);
  const income = state.income?.monthlyTakeHome ?? 0;
  const el = document.createElement("div");
  const unit = amountUnit;
  const custom = Boolean(isNew || cat?.isCustom);
  el.innerHTML = amountScreen({
    kicker: isNew ? customName || "Other" : (cat?.name ?? "Category"),
    title: unit === "percent" ? "Percent of monthly income" : "Monthly amount",
    extra: income > 0 ? `<p class="hint" id="live-extra">${liveHintHtml(unit)}</p>` : "",
    submitLabel: "Submit",
    allowZero: true,
    unit,
    modeToggle: true,
    rightHtml: custom
      ? `<button type="button" class="icon-btn icon-btn-danger" data-trash aria-label="Delete category">${trashCan}</button>`
      : undefined,
  });
  const opts = { allowZero: true, unit };
  bindAmount(
    el,
    async (amount) => {
      amountUnit = "money";
      if (isNew) {
        await submitNewCustom(amount, screen.from);
        return;
      }
      await setCategoryBudget(screen.categoryId, amount);
      leaveBudgetAmount(screen.from);
    },
    opts,
  );
  el.querySelector("[data-trash]")?.addEventListener("click", () => {
    if (isNew) {
      customName = "";
      leaveBudgetAmount(screen.from);
      return;
    }
    const name = cat?.name ?? "this category";
    const sheet = document.createElement("div");
    sheet.className = "over-sheet";
    sheet.innerHTML = `
      <div class="over-card">
        <h2 class="headline">Delete ${escapeHtml(name)}?</h2>
        <p class="sub">This custom category will be removed. Its purchases stay under Not in the Budget.</p>
        <button type="button" class="btn btn-primary btn-xl" data-del-yes>Yes, delete it</button>
        <button type="button" class="btn btn-ghost" data-del-no>Cancel</button>
      </div>`;
    el.querySelector(".screen")?.append(sheet);
    sheet.querySelector("[data-del-no]")?.addEventListener("click", () => sheet.remove());
    sheet.querySelector("[data-del-yes]")?.addEventListener("click", async () => {
      await removeCategory(screen.categoryId);
      if (screen.from === "home") resetNav({ id: "home" });
      else resetNav({ id: "catalog", from: screen.from ?? "settings" });
    });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.mode === "percent" ? "percent" : "money";
      if (next === amountUnit) return;
      const incomeNow = state.income?.monthlyTakeHome ?? 0;
      const current = parsePad(pad);
      if (next === "percent" && incomeNow > 0 && current > 0) {
        pad = String(Math.round((current / incomeNow) * 1000) / 10);
      } else if (next === "money" && incomeNow > 0 && current > 0) {
        pad = String(clampMoneyFromPct(current, incomeNow));
      }
      amountUnit = next;
      go({ id: "budget-amount", categoryId: screen.categoryId, from: screen.from }, { replace: true });
    });
  });
  return el;
}

export function renderAddCustom(screen: Extract<Screen, { id: "add-custom" }>): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `
    <section class="screen">
      ${topBar("Other")}
      <h2 class="headline">Name this category</h2>
      <p class="sub">Add as many custom categories as you need.</p>
      <label class="field">
        <span class="visually-hidden">Category name</span>
        <input class="text-input" type="text" maxlength="32" placeholder="e.g. Childcare" value="${escapeHtml(customName)}" />
      </label>
      <div class="flex-spacer"></div>
      <div class="pad-actions">
        <button type="button" class="btn btn-ghost" data-back>Back</button>
        <button type="button" class="btn btn-primary" data-next>Continue</button>
      </div>
    </section>`;
  bindBack(el);
  const input = el.querySelector<HTMLInputElement>(".text-input");
  queueMicrotask(() => input?.focus());
  input?.addEventListener("input", () => {
    customName = input.value;
  });
  const goAmount = () => {
    const name = (input?.value ?? customName).trim();
    if (!name) {
      input?.focus();
      return;
    }
    customName = name;
    pad = "";
    go({ id: "budget-amount", categoryId: "__new__", from: screen.from });
  };
  el.querySelector("[data-next]")?.addEventListener("click", goAmount);
  input?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      goAmount();
    }
  });
  return el;
}

export function openCategoryBudget(
  categoryId: string,
  from: "onboarding" | "settings" | "home" = "settings",
): void {
  if (!categoryId || categoryId === EXTRA_FUNDS_ID) return;
  const cat = categoryById(categoryId);
  pad = cat && cat.budgeted > 0 ? String(cat.budgeted % 1 === 0 ? cat.budgeted : cat.budgeted.toFixed(2)) : "";
  amountUnit = "money";
  go({ id: "budget-amount", categoryId, from });
}

function leaveBudgetAmount(from?: "onboarding" | "settings" | "home"): void {
  if (from === "home") {
    resetNav({ id: "home" });
    return;
  }
  if (canGoBack()) back();
  else resetNav({ id: "catalog", from });
}

/** Used when the pending custom category is being created via the amount screen. */
export async function submitNewCustom(
  amount: number,
  from?: "onboarding" | "settings" | "home",
): Promise<void> {
  const name = customName.trim() || "Other";
  await addCustomCategory(name, amount);
  customName = "";
  leaveBudgetAmount(from);
}

