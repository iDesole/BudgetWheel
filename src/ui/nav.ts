/** Bottom tabs. Tour swallows nav taps so the walkthrough cannot be left mid-step. */
import { resetNav, screen, state, toggleHomeChart, tourStep } from "../store.ts";

export const wheelIcon = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>`;
export const graphIcon = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 19V10M12 19V6M19 19v-7"/></svg>`;

let lastHomeTap = 0;
const DOUBLE_TAP_MS = 380;

export function navBar(active: "home" | "categories" | "settings"): string {
  const graph = state.homeChart === "bars";
  return `
    <nav class="tabbar" aria-label="Main">
      <button type="button" class="tab${active === "categories" ? " is-on" : ""}" data-nav="categories">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>
        Categories
      </button>
      <button type="button" class="tab${active === "home" ? " is-on" : ""}" data-nav="home">
        ${graph ? graphIcon : wheelIcon}
        ${graph ? "Graph" : "Wheel"}
      </button>
      <button type="button" class="tab${active === "settings" ? " is-on" : ""}" data-nav="settings">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 13a7.7 7.7 0 0 0 .1-2l2-1.5-2-3.5-2.4 1a7.4 7.4 0 0 0-1.7-1L15 4h-6l-.4 2a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.5L4.5 11a7.7 7.7 0 0 0 .1 2l-2 1.5 2 3.5 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2h6l.4-2a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5Z"/></svg>
        Settings
      </button>
    </nav>`;
}

export function bindNav(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (tourStep != null) return;
      const dest = btn.dataset.nav;
      if (dest === "home") {
        const now = Date.now();
        const doubled = now - lastHomeTap < DOUBLE_TAP_MS;
        lastHomeTap = doubled ? 0 : now;
        if (doubled) {
          void toggleHomeChart();
          if (screen.id !== "home") resetNav({ id: "home" });
          return;
        }
        if (screen.id !== "home") resetNav({ id: "home" });
        return;
      }
      if (dest === "categories") {
        if (screen.id !== "catalog") resetNav({ id: "catalog", from: "settings" });
        return;
      }
      if (dest === "settings" && screen.id !== "settings") resetNav({ id: "settings" });
    });
  });
}
