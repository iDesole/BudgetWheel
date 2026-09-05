/**
 * Post-setup walkthrough. A glass coach-mark over the live home and Settings
 * screens. Skip stays on the card; replay lives in Settings → Help.
 *
 * Spotlight targets are stable ids (#tour-wheel, #tour-slice, #tour-chart,
 * #tour-income, #tour-widget, #tour-history). The hole is measured from the
 * overlay box after the row is scrolled into the gap above the card.
 */
import {
  advanceTour,
  finishTour,
  skipTour,
  tourStep,
  wheelCategories,
} from "../store.ts";

const TOTAL = 6;

function stepCopy(step: number, empty: boolean): { title: string; body: string; cta: string } {
  if (step === 1) {
    return {
      title: "This is your wheel",
      body: empty
        ? "Every slice is a category. Slices grow as you log spending."
        : "Every slice is a category. A bigger slice means more of this month’s budget went there.",
      cta: "Next",
    };
  }
  if (step === 2) {
    return {
      title: "Tap a slice",
      body: "Open any slice to see what’s inside, add a purchase, or tidy the category.",
      cta: "Next",
    };
  }
  if (step === 3) {
    return {
      title: "Wheel or graph",
      body: "Same money, two views. Tap the icon in the top right to switch.",
      cta: "Next",
    };
  }
  if (step === 4) {
    return {
      title: "Add another income",
      body: "Side hustle, second job, or a one-off payday. Add it here so the wheel knows what you have to spend.",
      cta: "Next",
    };
  }
  if (step === 5) {
    return {
      title: "Keep the wheel on your home screen",
      body: "Tap Add Widget. You’ll see what’s left this month, and you can log purchases, without opening the app.",
      cta: "Next",
    };
  }
  return {
    title: "Past months stay here",
    body: "When a month ends, it lands in Spending history. Open a past month, or download it from there.",
    cta: "Start using Budget Wheel",
  };
}

const TOUR_ID = {
  1: "tour-wheel",
  2: "tour-slice",
  3: "tour-chart",
  4: "tour-income",
  5: "tour-widget",
  6: "tour-history",
} as const;

function findTarget(step: number): HTMLElement | null {
  if (step === 2) {
    return document.getElementById("tour-slice") ?? document.getElementById("tour-wheel");
  }
  const id = TOUR_ID[step as keyof typeof TOUR_ID];
  return id ? document.getElementById(id) : null;
}

interface SpotBox {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: string;
}

function boxAround(overlay: DOMRect, el: Element, pad: number, radius: string): SpotBox {
  const r = el.getBoundingClientRect();
  return {
    x: r.left - overlay.left - pad,
    y: r.top - overlay.top - pad,
    w: r.width + pad * 2,
    h: r.height + pad * 2,
    radius,
  };
}

/** Union of slice boxes, plus 5px. Falls back to the SVG viewBox mapped through the CTM. */
function wheelSpot(overlay: DOMRect): SpotBox | null {
  const svg = document.querySelector<SVGSVGElement>("#tour-wheel svg.wheel-svg");
  if (!svg) return null;
  const parts = svg.querySelectorAll(".wheel-slice, .wheel-svg > g circle, circle");
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  parts.forEach((p) => {
    const b = p.getBoundingClientRect();
    if (b.width < 2 && b.height < 2) return;
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.right);
    bottom = Math.max(bottom, b.bottom);
  });
  if (!Number.isFinite(left)) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const map = (x: number, y: number) => {
      const p = svg.createSVGPoint();
      p.x = x;
      p.y = y;
      return p.matrixTransform(ctm);
    };
    const c = map(160, 160);
    const e = map(308, 160);
    const radius = Math.hypot(e.x - c.x, e.y - c.y) + 5;
    return { x: c.x - overlay.left - radius, y: c.y - overlay.top - radius, w: radius * 2, h: radius * 2, radius: "50%" };
  }
  const cx = (left + right) / 2 - overlay.left;
  const cy = (top + bottom) / 2 - overlay.top;
  const radius = Math.max(right - left, bottom - top) / 2 + 5;
  return { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2, radius: "50%" };
}

function spotFor(overlayEl: HTMLElement, step: number): SpotBox | null {
  const overlay = overlayEl.getBoundingClientRect();
  if (step === 1) return wheelSpot(overlay);
  const el = findTarget(step);
  if (!el) return null;
  if (step === 2 && el.id === "tour-wheel") return wheelSpot(overlay);
  if (step === 3) return boxAround(overlay, el, 4, "50%");
  return boxAround(overlay, el, 6, "20px");
}

/** Scroll a Settings row into the visible gap above the tour card. */
function scrollTargetIntoFit(overlay: HTMLElement, target: HTMLElement): void {
  const scroller = target.closest(".screen-body");
  if (!(scroller instanceof HTMLElement)) return;
  const card = overlay.querySelector(".tour-card");
  const s = scroller.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  const cardTop = card instanceof HTMLElement ? card.getBoundingClientRect().top : s.bottom;
  const fitTop = s.top + 16;
  const fitBottom = cardTop - 16;
  if (fitBottom <= fitTop) return;
  const fitMid = (fitTop + fitBottom) / 2;
  const tMid = t.top + t.height / 2;
  scroller.scrollTop += tMid - fitMid;
}

function revealTarget(overlay: HTMLElement, step: number): HTMLElement | null {
  const target = findTarget(step);
  if (!target) return null;
  if (step >= 4) overlay.classList.remove("is-high");
  scrollTargetIntoFit(overlay, target);
  return target;
}

function placeSpot(overlay: HTMLElement, step: number): void {
  const spot = overlay.querySelector<HTMLElement>(".tour-spot");
  const card = overlay.querySelector<HTMLElement>(".tour-card");
  if (!spot) return;
  if (step >= 4) overlay.classList.remove("is-high");
  const hole = spotFor(overlay, step);
  if (!hole) {
    spot.classList.remove("is-on");
    return;
  }
  if (step < 4) {
    const hostH = overlay.getBoundingClientRect().height;
    const cardH = card?.getBoundingClientRect().height ?? 160;
    overlay.classList.toggle("is-high", hole.y + hole.h > hostH - cardH - 30 && hole.y > cardH + 24);
  }
  spot.classList.add("is-on");
  spot.style.borderRadius = hole.radius;
  spot.style.left = `${Math.round(hole.x)}px`;
  spot.style.top = `${Math.round(hole.y)}px`;
  spot.style.width = `${Math.round(hole.w)}px`;
  spot.style.height = `${Math.round(hole.h)}px`;
}

export function mountTour(root: HTMLElement): void {
  document.body.classList.toggle("is-tour", tourStep != null);
  document.body.classList.toggle("tour-step-3", tourStep === 3);
  const existing = root.querySelector<HTMLElement>(".tour-root");
  if (tourStep == null) {
    existing?.remove();
    document.body.classList.remove("is-tour", "tour-step-3");
    return;
  }

  const step = tourStep;
  if (existing?.dataset.step === String(step)) {
    revealTarget(existing, step);
    placeSpot(existing, step);
    requestAnimationFrame(() => placeSpot(existing, step));
    return;
  }

  existing?.remove();
  const slices = wheelCategories();
  const empty = !slices.length;
  const copy = stepCopy(step, empty && step === 1);
  const overlay = document.createElement("div");
  overlay.className = "tour-root";
  overlay.dataset.step = String(step);
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "tour-title");
  overlay.innerHTML = `
    <div class="tour-spot" aria-hidden="true"></div>
    <div class="tour-card">
      <div class="tour-dots" aria-hidden="true">${Array.from({ length: TOTAL }, (_, i) => `<span class="tour-dot${i + 1 === step ? " is-on" : ""}"></span>`).join("")}</div>
      <h2 id="tour-title" class="tour-title">${copy.title}</h2>
      <p class="tour-body">${copy.body}</p>
      <div class="tour-actions">
        <button type="button" class="btn btn-primary btn-xl" data-tour-next>${copy.cta}</button>
        <button type="button" class="btn btn-ghost" data-tour-skip>Skip</button>
      </div>
    </div>`;
  root.append(overlay);
  const layout = () => {
    revealTarget(overlay, step);
    requestAnimationFrame(() => placeSpot(overlay, step));
  };
  layout();
  requestAnimationFrame(layout);

  overlay.querySelector("[data-tour-skip]")?.addEventListener("click", () => {
    void skipTour();
  });
  overlay.querySelector("[data-tour-next]")?.addEventListener("click", () => {
    if (step >= 6) {
      void finishTour();
      return;
    }
    void advanceTour();
  });
}
