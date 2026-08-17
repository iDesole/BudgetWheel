/**
 * Wheel geometry. Keep lockstep with android/.../WheelRenderer.kt.
 * 100% = take-home income. Assigned envelopes fill first (cheapest inner).
 * Spend past a category's envelope, and purchases with no envelope, wrap
 * onto thinner exterior rings — one income-length per ring — so a huge
 * purchase never blows past 360°. Out-of-budget slices use an unused color.
 */
import { EXTRA_FUNDS_ID, unusedColor } from "../lib/categories.ts";
import { escapeHtml } from "../lib/money.ts";
import { safeColor, safeId } from "../lib/sanitize.ts";

export interface WheelSlice {
  id: string;
  name: string;
  color: string;
  budgeted: number;
  spent: number;
  envelope: number;
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

export function donut(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const span = a1 - a0;
  if (span >= 359.9) {
    return [
      `M ${cx} ${cy - r1}`,
      `A ${r1} ${r1} 0 1 1 ${cx - 0.01} ${cy - r1}`,
      `L ${cx - 0.01} ${cy - r0}`,
      `A ${r0} ${r0} 0 1 0 ${cx} ${cy - r0}`,
      "Z",
    ].join(" ");
  }
  const large = span > 180 ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  return `M ${x0} ${y0} A ${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`;
}

export interface WheelArc {
  id: string;
  color: string;
  r0: number;
  r1: number;
  a0: number;
  a1: number;
}

function ringArcs(
  items: Array<WheelSlice & { weight: number }>,
  r0: number,
  r1: number,
  fullCircleAt?: number,
): WheelArc[] {
  const total = items.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return [];
  const circleAt = fullCircleAt && fullCircleAt > 0 ? fullCircleAt : total;
  let angle = 0;
  const seam = items.length > 1 ? 0.7 : 0;
  const arcs: WheelArc[] = [];
  for (const slice of items) {
    const sweep = Math.min(359.9, (slice.weight / circleAt) * 360);
    const a0 = angle;
    const a1 = angle + sweep - seam;
    angle += sweep;
    if (a1 <= a0) continue;
    arcs.push({
      id: safeId(slice.id, `slice_${arcs.length}`),
      color: safeColor(slice.color),
      r0,
      r1,
      a0,
      a1,
    });
  }
  return arcs;
}

function splitLayers(
  sized: Array<WheelSlice & { weight: number }>,
  unit: number,
): Array<Array<WheelSlice & { weight: number }>> {
  if (unit <= 0.009) return sized.length ? [sized] : [];
  const layers: Array<Array<WheelSlice & { weight: number }>> = [[]];
  let room = unit;
  for (const slice of sized) {
    let left = slice.weight;
    while (left > 0.009) {
      if (room <= 0.009) {
        layers.push([]);
        room = unit;
      }
      const take = Math.min(left, room);
      layers[layers.length - 1].push({ ...slice, weight: take });
      left -= take;
      room -= take;
    }
  }
  return layers.filter((layer) => layer.length > 0);
}

/** Cheapest items stay on the inner ring; higher-cost slices overflow to exterior rings. */
function layersByCost(
  items: Array<WheelSlice & { weight: number }>,
  unit: number,
): Array<Array<WheelSlice & { weight: number }>> {
  if (!items.length) return [];
  if (unit <= 0.009) return [items];
  const total = items.reduce((s, x) => s + x.weight, 0);
  if (total <= unit + 0.009) return [items];
  return splitLayers(
    items.slice().sort((a, b) => a.weight - b.weight),
    unit,
  );
}

function layoutRings(overCount: number): {
  size: number;
  hole: number;
  mainOuter: number;
  overThick: number;
  gap: number;
} {
  const size = 320;
  const maxR = 144;
  const gap = 2;
  const hole = 84;
  const preferredMain = 64;
  const preferredOver = 32;
  const needed = hole + preferredMain + overCount * (preferredOver + gap);
  if (overCount <= 0 || needed <= maxR) {
    return {
      size,
      hole,
      mainOuter: hole + preferredMain,
      overThick: preferredOver,
      gap,
    };
  }
  const remain = maxR - hole;
  const mainThick = Math.max(28, (remain - overCount * gap) / (1 + overCount / 2));
  return { size, hole, mainOuter: hole + mainThick, overThick: mainThick / 2, gap };
}

function isOutOfBudget(slice: WheelSlice): boolean {
  return slice.id !== EXTRA_FUNDS_ID && slice.envelope <= 0.009 && slice.spent > 0.009;
}

function paintOutOfBudget(slices: WheelSlice[]): WheelSlice[] {
  const used = new Set(
    slices.filter((s) => !isOutOfBudget(s)).map((s) => s.color.toUpperCase()),
  );
  return slices.map((slice) => {
    if (!isOutOfBudget(slice)) return slice;
    if (!used.has(slice.color.toUpperCase())) {
      used.add(slice.color.toUpperCase());
      return slice;
    }
    const color = unusedColor(used);
    used.add(color.toUpperCase());
    return { ...slice, color };
  });
}

type Weighted = WheelSlice & { weight: number };

function overflowWeight(slice: WheelSlice): number {
  if (slice.envelope <= 0.009) return Math.max(0, slice.spent);
  return Math.max(0, slice.spent - slice.envelope);
}

/** Fill leftover inner room, then wrap the rest onto income-sized exterior rings. */
function placeSpendOverflow(
  inner: Weighted[],
  assignedOnInner: number,
  overflow: Weighted[],
  unit: number,
): { inner: Weighted[]; over: Weighted[][] } {
  if (!overflow.length) return { inner, over: [] };
  const room = Math.max(0, unit - assignedOnInner);
  const leftover: Weighted[] = [];
  const nextInner = [...inner];
  if (room > 0.009) {
    let left = room;
    for (const item of overflow) {
      if (left <= 0.009) {
        leftover.push(item);
        continue;
      }
      const take = Math.min(item.weight, left);
      nextInner.push({ ...item, weight: take });
      left -= take;
      if (item.weight - take > 0.009) leftover.push({ ...item, weight: item.weight - take });
    }
  } else {
    leftover.push(...overflow);
  }
  const over = leftover.length
    ? splitLayers(
        leftover.slice().sort((a, b) => b.weight - a.weight),
        unit,
      ).slice(0, 8)
    : [];
  return { inner: nextInner, over };
}

export function wheelRingLayout(
  slices: WheelSlice[],
  income = 0,
): { size: number; hole: number; mainOuter: number; cx: number; cy: number; empty: boolean; arcs: WheelArc[] } {
  const painted = paintOutOfBudget(slices);
  const takeHome = Math.max(0, income);
  const envelopeTotal = painted.reduce((s, c) => s + Math.max(0, c.envelope), 0);
  const spentTotal = painted.reduce((s, c) => s + Math.max(0, c.spent), 0);
  if (painted.length === 0 || (takeHome <= 0 && envelopeTotal <= 0 && spentTotal <= 0)) {
    const { size, hole, mainOuter } = layoutRings(0);
    return { size, hole, mainOuter, cx: size / 2, cy: size / 2, empty: true, arcs: [] };
  }

  const unbudgetedSpend = painted.filter(isOutOfBudget).reduce((sum, s) => sum + Math.max(0, s.spent), 0);
  const cores = painted
    .map((s) => {
      if (s.id === EXTRA_FUNDS_ID) {
        return { ...s, weight: Math.max(0, s.envelope - unbudgetedSpend) };
      }
      if (s.envelope > 0.009) return { ...s, weight: s.envelope };
      return { ...s, weight: 0 };
    })
    .filter((s) => s.weight > 0.009);
  const overflow = painted
    .map((s) => ({ ...s, weight: overflowWeight(s) }))
    .filter((s) => s.weight > 0.009);
  const budgetTotal = cores.reduce((s, c) => s + c.weight, 0);
  const unit = takeHome > 0.009 ? takeHome : Math.max(budgetTotal, overflow.reduce((s, c) => s + c.weight, 0));
  const coreLayers = layersByCost(cores, unit);
  const assignedOver = coreLayers.slice(1);
  const placed = placeSpendOverflow(coreLayers[0] ?? [], Math.min(budgetTotal, unit), overflow, unit);
  const overLayers = [...assignedOver, ...placed.over].slice(0, 8);
  const { size, hole, mainOuter, overThick, gap } = layoutRings(overLayers.length);
  const arcs: WheelArc[] = [];
  if (placed.inner.length) {
    arcs.push(...ringArcs(placed.inner, hole, mainOuter, unit));
  }
  overLayers.forEach((layer, index) => {
    const r0 = mainOuter + gap + index * (overThick + gap);
    arcs.push(...ringArcs(layer, r0, r0 + overThick, unit));
  });
  return { size, hole, mainOuter, cx: size / 2, cy: size / 2, empty: false, arcs };
}

export function wheelSvg(
  slices: WheelSlice[],
  opts: { selectedId?: string | null; interactive?: boolean; income?: number } = {},
): string {
  const layout = wheelRingLayout(slices, opts.income ?? 0);
  const { size, hole, mainOuter, cx, cy } = layout;
  if (layout.empty) {
    return wrapWheelSvg(
      size,
      "Empty budget wheel",
      `<circle cx="${cx}" cy="${cy}" r="${(hole + mainOuter) / 2}" fill="none" stroke="var(--outline-variant)" stroke-width="${mainOuter - hole}" />`,
    );
  }

  const parts: string[] = [];
  const later: string[] = [];
  for (const arc of layout.arcs) {
    const selected = opts.selectedId === arc.id;
    const grow = selected ? 7 : 0;
    const sr0 = Math.max(8, arc.r0 - grow * 0.35);
    const sr1 = arc.r1 + grow;
    const dest = selected ? later : parts;
    dest.push(
      `<path class="wheel-slice${selected ? " is-selected" : ""}" data-slice="${arc.id}" d="${donut(cx, cy, sr0, sr1, arc.a0, arc.a1)}" fill="${arc.color}" />`,
    );
    if (opts.interactive) {
      dest.push(
        `<path class="wheel-hit" data-slice="${arc.id}" d="${donut(cx, cy, sr0 - 2, sr1 + 4, arc.a0, arc.a1)}" fill="transparent" />`,
      );
    }
  }
  parts.push(...later);
  return wrapWheelSvg(size, "Budget wheel", parts.join(""));
}

function wrapWheelSvg(size: number, label: string, inner: string): string {
  const pad = 32;
  return `
    <svg class="wheel-svg" viewBox="${-pad} ${-pad} ${size + pad * 2} ${size + pad * 2}" role="img" aria-label="${label}" shape-rendering="geometricPrecision">
      <defs>
        <filter id="wheel-depth" x="-30%" y="-30%" width="160%" height="170%" color-interpolation-filters="sRGB">
          <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.38"/>
        </filter>
      </defs>
      <g class="wheel-depth" filter="url(#wheel-depth)">${inner}</g>
    </svg>`;
}

export function wheelCenterMarkup(opts: {
  label: string;
  value: string;
  negative?: boolean;
  subPrimary: string;
  subSecondary?: string;
}): string {
  const sub = opts.subSecondary
    ? `<span>${escapeHtml(opts.subPrimary)}</span><span>${escapeHtml(opts.subSecondary)}</span>`
    : `<span>${escapeHtml(opts.subPrimary)}</span>`;
  return `
    <div class="wheel-center">
      <p class="wheel-center-label">${escapeHtml(opts.label)}</p>
      <p class="wheel-center-value${opts.negative ? " is-neg" : ""}">${escapeHtml(opts.value)}</p>
      <p class="wheel-center-sub">${sub}</p>
    </div>`;
}

export function fitWheelCenter(host: ParentNode = document): void {
  const box = host.querySelector<HTMLElement>(".wheel-center");
  if (!box) return;
  let fit = 1;
  box.style.setProperty("--center-fit", "1");
  for (let i = 0; i < 16; i += 1) {
    if (box.scrollWidth <= box.clientWidth + 1 && box.scrollHeight <= box.clientHeight + 1) break;
    fit *= 0.88;
    if (fit < 0.42) break;
    box.style.setProperty("--center-fit", String(fit));
  }
}
