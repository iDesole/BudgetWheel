/**
 * One-ring wheel. Keep lockstep with android/.../WheelRenderer.kt.
 * Slice size is the envelope, or spend if higher. Extra Funds is remaining.
 * 360° is the sum of those sizes.
 */
import { EXTRA_FUNDS_ID, isOutOfBudgetSpend, unusedColor } from "../lib/categories.ts";
import { escapeHtml } from "../lib/money.ts";
import { safeColor, safeId } from "../lib/sanitize.ts";

const VIEW = 320;
const HOLE = 84;
const RING = 64;
const PAD = 32;
const SEAM = 0.7;
const FULL = 359.9;
const EPS = 0.009;

export interface WheelSlice {
  id: string;
  name: string;
  color: string;
  budgeted: number;
  spent: number;
  envelope: number;
}

export interface WheelArc {
  id: string;
  color: string;
  r0: number;
  r1: number;
  a0: number;
  a1: number;
}

export interface WheelLayout {
  size: number;
  hole: number;
  mainOuter: number;
  cx: number;
  cy: number;
  empty: boolean;
  arcs: WheelArc[];
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

export function donut(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const span = a1 - a0;
  if (span >= FULL) {
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

function ringArcs(items: Array<WheelSlice & { weight: number }>, r0: number, r1: number): WheelArc[] {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return [];
  let angle = 0;
  const seam = items.length > 1 ? SEAM : 0;
  const arcs: WheelArc[] = [];
  for (const slice of items) {
    if (angle >= FULL) break;
    const sweep = Math.min(FULL - angle, (slice.weight / total) * 360);
    const gap = sweep > seam ? seam : 0;
    const a0 = angle;
    const a1 = angle + sweep - gap;
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

function isOutOfBudget(slice: WheelSlice): boolean {
  return isOutOfBudgetSpend(slice.id, slice.envelope) && slice.spent > EPS;
}

function paintOutOfBudget(slices: WheelSlice[]): WheelSlice[] {
  const used = new Set(slices.filter((s) => !isOutOfBudget(s)).map((s) => s.color.toUpperCase()));
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

function sliceWeight(slice: WheelSlice): number {
  if (slice.id === EXTRA_FUNDS_ID) return Math.max(0, slice.envelope - slice.spent);
  return Math.max(0, slice.envelope, slice.spent);
}

function emptyLayout(): WheelLayout {
  const mainOuter = HOLE + RING;
  return { size: VIEW, hole: HOLE, mainOuter, cx: VIEW / 2, cy: VIEW / 2, empty: true, arcs: [] };
}

export function wheelRingLayout(slices: WheelSlice[]): WheelLayout {
  const weighted = paintOutOfBudget(slices)
    .map((slice) => ({ ...slice, weight: sliceWeight(slice) }))
    .filter((slice) => slice.weight > EPS);
  if (!weighted.length) return emptyLayout();
  const mainOuter = HOLE + RING;
  return {
    size: VIEW,
    hole: HOLE,
    mainOuter,
    cx: VIEW / 2,
    cy: VIEW / 2,
    empty: false,
    arcs: ringArcs(weighted, HOLE, mainOuter),
  };
}

export function wheelSvg(
  slices: WheelSlice[],
  opts: { selectedId?: string | null; interactive?: boolean } = {},
): string {
  const layout = wheelRingLayout(slices);
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

let wheelFilterSeq = 0;

function wrapWheelSvg(size: number, label: string, inner: string): string {
  wheelFilterSeq += 1;
  const fid = `wheel-depth-${wheelFilterSeq}`;
  return `
    <svg class="wheel-svg" viewBox="${-PAD} ${-PAD} ${size + PAD * 2} ${size + PAD * 2}" role="img" aria-label="${label}" shape-rendering="geometricPrecision">
      <defs>
        <filter id="${fid}" x="-30%" y="-30%" width="160%" height="170%" color-interpolation-filters="sRGB">
          <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.38"/>
        </filter>
      </defs>
      <g class="wheel-depth" filter="url(#${fid})">${inner}</g>
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
