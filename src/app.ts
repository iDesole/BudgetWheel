import {
  renderAddCustom,
  renderBudgetAmount,
  renderCatalog,
  renderExtraIncome,
  renderHourlyHours,
  renderHourlyWage,
  renderIncomeAdjust,
  renderIncomeConfirm,
  renderPayDay,
  renderPayType,
  renderSideAmount,
  renderSalaryAmount,
  renderSalaryPeriod,
  renderState,
  renderWelcome,
} from "./screens/onboarding.ts";
import { renderCategoryActivity, renderHistoryPeriod, renderHome, renderPastQuarter, renderPurchaseAmount, renderPurchaseCategory, renderSettings } from "./screens/main.ts";
import { renderWidget } from "./screens/widget.ts";
import { isWidgetPath } from "./lib/widget.ts";
import { applyTheme, watchSystemTheme } from "./lib/theme.ts";
import { watchWidgetOwned } from "./lib/android.ts";
import { refreshUi, screen, state, subscribe, toastMessage, tourStep } from "./store.ts";
import { mountReviewPrompt } from "./ui/review-prompt.ts";
import { mountTour } from "./ui/tour.ts";
import { fitWheelCenter } from "./ui/wheel.ts";

const root = document.querySelector<HTMLDivElement>("#app");
const scrollPos = new Map<string, Record<string, number>>();
let lastScreenId = "";

const SCROLL_SEL = ".budget-chart, .catalog-list, .state-list, .history-body, .screen-body, .screen, [data-scroll]";

function scrollers(host: ParentNode): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(SCROLL_SEL)];
}

function scrollerKey(el: HTMLElement): string {
  const named = el.getAttribute("data-scroll");
  if (named) return `ds:${named}`;
  if (el.classList.contains("catalog-list")) return "catalog-list";
  if (el.classList.contains("budget-chart")) return "budget-chart";
  if (el.classList.contains("state-list")) return "state-list";
  if (el.classList.contains("history-body")) return "history-body";
  if (el.classList.contains("screen-body")) return "screen-body";
  if (el.classList.contains("screen")) return "screen";
  return "other";
}

function captureScroll(host: ParentNode): Record<string, number> {
  const out: Record<string, number> = {};
  for (const el of scrollers(host)) {
    if (el.scrollTop > 0) out[scrollerKey(el)] = el.scrollTop;
  }
  return out;
}

function restoreScroll(host: ParentNode, saved: Record<string, number> | undefined): void {
  if (!saved) return;
  for (const el of scrollers(host)) {
    const y = saved[scrollerKey(el)];
    if (y != null) el.scrollTop = y;
  }
}

function paint(): void {
  if (!root) return;
  if (lastScreenId) scrollPos.set(lastScreenId, captureScroll(root));

  let view: HTMLElement;
  if (isWidgetPath()) {
    view = renderWidget();
  } else switch (screen.id) {
    case "welcome":
      view = renderWelcome();
      break;
    case "pay-type":
      view = renderPayType();
      break;
    case "salary-period":
      view = renderSalaryPeriod();
      break;
    case "salary-amount":
      view = renderSalaryAmount();
      break;
    case "hourly-wage":
      view = renderHourlyWage();
      break;
    case "hourly-hours":
      view = renderHourlyHours();
      break;
    case "state":
      view = renderState();
      break;
    case "pay-day":
      view = renderPayDay();
      break;
    case "income-confirm":
      view = renderIncomeConfirm();
      break;
    case "income-adjust":
      view = renderIncomeAdjust();
      break;
    case "extra-income":
      view = renderExtraIncome();
      break;
    case "side-amount":
      view = renderSideAmount();
      break;
    case "catalog":
      view = renderCatalog(screen);
      break;
    case "budget-amount":
      view = renderBudgetAmount(screen);
      break;
    case "add-custom":
      view = renderAddCustom(screen);
      break;
    case "home":
      view = renderHome();
      break;
    case "category-activity":
      view = renderCategoryActivity(screen.categoryId, screen.periodId);
      break;
    case "purchase-amount":
      view = renderPurchaseAmount();
      break;
    case "purchase-category":
      view = renderPurchaseCategory(screen.amount);
      break;
    case "past-quarter":
      view = renderPastQuarter();
      break;
    case "history-period":
      view = renderHistoryPeriod(screen.periodId);
      break;
    case "settings":
      view = renderSettings();
      break;
    default:
      view = renderWelcome();
  }

  const viewId = isWidgetPath() ? "widget" : screen.id;
  const entering = viewId !== lastScreenId && viewId !== "widget";
  const section = view.querySelector(".screen");
  if (section && entering && tourStep == null) section.classList.add("screen-enter");

  const keepTour = root.querySelector<HTMLElement>(".tour-root");
  const sameTour = Boolean(keepTour && tourStep != null && keepTour.dataset.step === String(tourStep));
  root.replaceChildren(view);
  if (toastMessage) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = toastMessage;
    root.append(toast);
  }
  if (sameTour && keepTour) root.append(keepTour);

  // The tour scrolls Settings rows itself. Restoring the last paint would
  // leave the hole sitting on the previous row (usually Add Income).
  const touring = tourStep != null;
  const saved = !entering && !touring ? scrollPos.get(viewId) : undefined;
  if (saved) restoreScroll(root, saved);
  if (!isWidgetPath()) {
    mountTour(root);
    mountReviewPrompt(root);
  }
  requestAnimationFrame(() => {
    fitWheelCenter(root);
    if (saved) {
      restoreScroll(root, saved);
      requestAnimationFrame(() => restoreScroll(root, saved));
    }
  });
  lastScreenId = viewId;
  document.title = isWidgetPath() ? "Add a purchase · Budget Wheel" : "Budget Wheel";
  document.body.classList.toggle("is-widget", isWidgetPath());
}

export function startApp(): void {
  applyTheme(state.theme);
  watchSystemTheme(
    () => state.theme,
    () => applyTheme(state.theme),
  );
  watchWidgetOwned(() => refreshUi());
  subscribe(paint);
  paint();
}
