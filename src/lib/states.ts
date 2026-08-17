/**
 * 2026 state wage-income tax rules for a single filer.
 * Brackets, standard deductions, and exemptions follow Tax Foundation
 * "State Individual Income Tax Rates and Brackets, 2026" (as of Jan 1, 2026),
 * plus West Virginia's 2026 rate cut (S.B. 392) and DC OTR published rates.
 * Washington does not tax wages. Credits are applied after tax is computed.
 */
export interface TaxBracket {
  /** Inclusive lower bound of taxable income for this rate. */
  min: number;
  rate: number;
}

export interface UsState {
  code: string;
  name: string;
  brackets: TaxBracket[];
  standardDeduction: number;
  personalExemption: number;
  taxCredit: number;
}

export const US_STATES: UsState[] = [
  { code: "AL", name: "Alabama", brackets: [{ min: 0, rate: 0.02 }, { min: 500, rate: 0.04 }, { min: 3000, rate: 0.05 }], standardDeduction: 3000, personalExemption: 1500, taxCredit: 0 },
  { code: "AK", name: "Alaska", brackets: [], standardDeduction: 0, personalExemption: 0, taxCredit: 0 },
  { code: "AZ", name: "Arizona", brackets: [{ min: 0, rate: 0.025 }], standardDeduction: 8350, personalExemption: 0, taxCredit: 0 },
  { code: "AR", name: "Arkansas", brackets: [{ min: 0, rate: 0.02 }, { min: 4600, rate: 0.039 }], standardDeduction: 2470, personalExemption: 0, taxCredit: 29 },
  { code: "CA", name: "California", brackets: [
    { min: 0, rate: 0.01 }, { min: 11079, rate: 0.02 }, { min: 26264, rate: 0.04 },
    { min: 41452, rate: 0.06 }, { min: 57542, rate: 0.08 }, { min: 72724, rate: 0.093 },
    { min: 371479, rate: 0.103 }, { min: 445771, rate: 0.113 }, { min: 742953, rate: 0.123 },
    { min: 1_000_000, rate: 0.133 },
  ], standardDeduction: 5540, personalExemption: 0, taxCredit: 153 },
  { code: "CO", name: "Colorado", brackets: [{ min: 0, rate: 0.044 }], standardDeduction: 16100, personalExemption: 0, taxCredit: 0 },
  { code: "CT", name: "Connecticut", brackets: [
    { min: 0, rate: 0.02 }, { min: 10000, rate: 0.045 }, { min: 50000, rate: 0.055 },
    { min: 100000, rate: 0.06 }, { min: 200000, rate: 0.065 }, { min: 250000, rate: 0.069 },
    { min: 500000, rate: 0.0699 },
  ], standardDeduction: 0, personalExemption: 15000, taxCredit: 0 },
  { code: "DE", name: "Delaware", brackets: [
    { min: 0, rate: 0 }, { min: 2000, rate: 0.022 }, { min: 5000, rate: 0.039 },
    { min: 10000, rate: 0.048 }, { min: 20000, rate: 0.052 }, { min: 25000, rate: 0.0555 },
    { min: 60000, rate: 0.066 },
  ], standardDeduction: 3250, personalExemption: 0, taxCredit: 110 },
  { code: "DC", name: "District of Columbia", brackets: [
    { min: 0, rate: 0.04 }, { min: 10000, rate: 0.06 }, { min: 40000, rate: 0.065 },
    { min: 60000, rate: 0.085 }, { min: 250000, rate: 0.0925 }, { min: 500000, rate: 0.0975 },
    { min: 1_000_000, rate: 0.1075 },
  ], standardDeduction: 16100, personalExemption: 0, taxCredit: 0 },
  { code: "FL", name: "Florida", brackets: [], standardDeduction: 0, personalExemption: 0, taxCredit: 0 },
  { code: "GA", name: "Georgia", brackets: [{ min: 0, rate: 0.0519 }], standardDeduction: 12000, personalExemption: 0, taxCredit: 0 },
  { code: "HI", name: "Hawaii", brackets: [
    { min: 0, rate: 0.014 }, { min: 9600, rate: 0.032 }, { min: 14400, rate: 0.055 },
    { min: 19200, rate: 0.064 }, { min: 24000, rate: 0.068 }, { min: 36000, rate: 0.072 },
    { min: 48000, rate: 0.076 }, { min: 125000, rate: 0.079 }, { min: 175000, rate: 0.0825 },
    { min: 225000, rate: 0.09 }, { min: 275000, rate: 0.1 }, { min: 325000, rate: 0.11 },
  ], standardDeduction: 4400, personalExemption: 1144, taxCredit: 0 },
  { code: "ID", name: "Idaho", brackets: [{ min: 0, rate: 0 }, { min: 4811, rate: 0.053 }], standardDeduction: 16100, personalExemption: 0, taxCredit: 0 },
  { code: "IL", name: "Illinois", brackets: [{ min: 0, rate: 0.0495 }], standardDeduction: 0, personalExemption: 2925, taxCredit: 0 },
  { code: "IN", name: "Indiana", brackets: [{ min: 0, rate: 0.0295 }], standardDeduction: 0, personalExemption: 1000, taxCredit: 0 },
  { code: "IA", name: "Iowa", brackets: [{ min: 0, rate: 0.038 }], standardDeduction: 16100, personalExemption: 0, taxCredit: 40 },
  { code: "KS", name: "Kansas", brackets: [{ min: 0, rate: 0.052 }, { min: 23000, rate: 0.0558 }], standardDeduction: 3605, personalExemption: 0, taxCredit: 0 },
  { code: "KY", name: "Kentucky", brackets: [{ min: 0, rate: 0.035 }], standardDeduction: 3360, personalExemption: 0, taxCredit: 0 },
  { code: "LA", name: "Louisiana", brackets: [{ min: 0, rate: 0.03 }], standardDeduction: 12875, personalExemption: 0, taxCredit: 0 },
  { code: "ME", name: "Maine", brackets: [
    { min: 0, rate: 0.058 }, { min: 27399, rate: 0.0675 }, { min: 64849, rate: 0.0715 },
  ], standardDeduction: 8350, personalExemption: 5300, taxCredit: 0 },
  { code: "MD", name: "Maryland", brackets: [
    { min: 0, rate: 0.02 }, { min: 1000, rate: 0.03 }, { min: 2000, rate: 0.04 },
    { min: 3000, rate: 0.0475 }, { min: 100000, rate: 0.05 }, { min: 125000, rate: 0.0525 },
    { min: 150000, rate: 0.055 }, { min: 250000, rate: 0.0575 }, { min: 500000, rate: 0.0625 },
    { min: 1_000_000, rate: 0.065 },
  ], standardDeduction: 3350, personalExemption: 3200, taxCredit: 0 },
  { code: "MA", name: "Massachusetts", brackets: [{ min: 0, rate: 0.05 }, { min: 1_083_150, rate: 0.09 }], standardDeduction: 0, personalExemption: 4400, taxCredit: 0 },
  { code: "MI", name: "Michigan", brackets: [{ min: 0, rate: 0.0425 }], standardDeduction: 0, personalExemption: 5900, taxCredit: 0 },
  { code: "MN", name: "Minnesota", brackets: [
    { min: 0, rate: 0.0535 }, { min: 33310, rate: 0.068 }, { min: 109430, rate: 0.0785 },
    { min: 203150, rate: 0.0985 },
  ], standardDeduction: 15300, personalExemption: 0, taxCredit: 0 },
  { code: "MS", name: "Mississippi", brackets: [{ min: 0, rate: 0 }, { min: 10000, rate: 0.04 }], standardDeduction: 2300, personalExemption: 6000, taxCredit: 0 },
  { code: "MO", name: "Missouri", brackets: [
    { min: 0, rate: 0 }, { min: 1348, rate: 0.02 }, { min: 2696, rate: 0.025 },
    { min: 4044, rate: 0.03 }, { min: 5392, rate: 0.035 }, { min: 6740, rate: 0.04 },
    { min: 8088, rate: 0.045 }, { min: 9436, rate: 0.047 },
  ], standardDeduction: 16100, personalExemption: 0, taxCredit: 0 },
  { code: "MT", name: "Montana", brackets: [{ min: 0, rate: 0.047 }, { min: 47500, rate: 0.0565 }], standardDeduction: 16100, personalExemption: 0, taxCredit: 0 },
  { code: "NE", name: "Nebraska", brackets: [
    { min: 0, rate: 0.0246 }, { min: 4130, rate: 0.0351 }, { min: 24760, rate: 0.0455 },
  ], standardDeduction: 8850, personalExemption: 0, taxCredit: 176 },
  { code: "NV", name: "Nevada", brackets: [], standardDeduction: 0, personalExemption: 0, taxCredit: 0 },
  { code: "NH", name: "New Hampshire", brackets: [], standardDeduction: 0, personalExemption: 0, taxCredit: 0 },
  { code: "NJ", name: "New Jersey", brackets: [
    { min: 0, rate: 0.014 }, { min: 20000, rate: 0.0175 }, { min: 35000, rate: 0.035 },
    { min: 40000, rate: 0.05525 }, { min: 75000, rate: 0.0637 }, { min: 500000, rate: 0.0897 },
    { min: 1_000_000, rate: 0.1075 },
  ], standardDeduction: 0, personalExemption: 1000, taxCredit: 0 },
  { code: "NM", name: "New Mexico", brackets: [
    { min: 0, rate: 0.015 }, { min: 5500, rate: 0.032 }, { min: 16500, rate: 0.043 },
    { min: 33500, rate: 0.047 }, { min: 66500, rate: 0.049 }, { min: 210000, rate: 0.059 },
  ], standardDeduction: 16100, personalExemption: 0, taxCredit: 0 },
  { code: "NY", name: "New York", brackets: [
    { min: 0, rate: 0.039 }, { min: 8500, rate: 0.044 }, { min: 11700, rate: 0.0515 },
    { min: 13900, rate: 0.054 }, { min: 80650, rate: 0.059 }, { min: 215400, rate: 0.0685 },
    { min: 1_077_550, rate: 0.0965 }, { min: 5_000_000, rate: 0.103 }, { min: 25_000_000, rate: 0.109 },
  ], standardDeduction: 8000, personalExemption: 0, taxCredit: 0 },
  { code: "NC", name: "North Carolina", brackets: [{ min: 0, rate: 0.0399 }], standardDeduction: 12750, personalExemption: 0, taxCredit: 0 },
  { code: "ND", name: "North Dakota", brackets: [
    { min: 0, rate: 0 }, { min: 48475, rate: 0.0195 }, { min: 244825, rate: 0.025 },
  ], standardDeduction: 16100, personalExemption: 0, taxCredit: 0 },
  { code: "OH", name: "Ohio", brackets: [{ min: 0, rate: 0 }, { min: 26050, rate: 0.0275 }], standardDeduction: 0, personalExemption: 2400, taxCredit: 0 },
  { code: "OK", name: "Oklahoma", brackets: [
    { min: 0, rate: 0 }, { min: 3750, rate: 0.025 }, { min: 4900, rate: 0.035 }, { min: 7200, rate: 0.045 },
  ], standardDeduction: 6350, personalExemption: 1000, taxCredit: 0 },
  { code: "OR", name: "Oregon", brackets: [
    { min: 0, rate: 0.0475 }, { min: 4550, rate: 0.0675 }, { min: 11400, rate: 0.0875 }, { min: 125000, rate: 0.099 },
  ], standardDeduction: 2910, personalExemption: 0, taxCredit: 256 },
  { code: "PA", name: "Pennsylvania", brackets: [{ min: 0, rate: 0.0307 }], standardDeduction: 0, personalExemption: 0, taxCredit: 0 },
  { code: "RI", name: "Rhode Island", brackets: [
    { min: 0, rate: 0.0375 }, { min: 82050, rate: 0.0475 }, { min: 186450, rate: 0.0599 },
  ], standardDeduction: 11200, personalExemption: 5250, taxCredit: 0 },
  { code: "SC", name: "South Carolina", brackets: [
    { min: 0, rate: 0 }, { min: 3640, rate: 0.03 }, { min: 18230, rate: 0.06 },
  ], standardDeduction: 8350, personalExemption: 0, taxCredit: 0 },
  { code: "SD", name: "South Dakota", brackets: [], standardDeduction: 0, personalExemption: 0, taxCredit: 0 },
  { code: "TN", name: "Tennessee", brackets: [], standardDeduction: 0, personalExemption: 0, taxCredit: 0 },
  { code: "TX", name: "Texas", brackets: [], standardDeduction: 0, personalExemption: 0, taxCredit: 0 },
  { code: "UT", name: "Utah", brackets: [{ min: 0, rate: 0.045 }], standardDeduction: 0, personalExemption: 0, taxCredit: 966 },
  { code: "VT", name: "Vermont", brackets: [
    { min: 0, rate: 0.0335 }, { min: 49400, rate: 0.066 }, { min: 119700, rate: 0.076 }, { min: 249700, rate: 0.0875 },
  ], standardDeduction: 7650, personalExemption: 5300, taxCredit: 0 },
  { code: "VA", name: "Virginia", brackets: [
    { min: 0, rate: 0.02 }, { min: 3000, rate: 0.03 }, { min: 5000, rate: 0.05 }, { min: 17000, rate: 0.0575 },
  ], standardDeduction: 8750, personalExemption: 930, taxCredit: 0 },
  { code: "WA", name: "Washington", brackets: [], standardDeduction: 0, personalExemption: 0, taxCredit: 0 },
  { code: "WV", name: "West Virginia", brackets: [
    { min: 0, rate: 0.0211 }, { min: 10000, rate: 0.0281 }, { min: 25000, rate: 0.0316 },
    { min: 40000, rate: 0.0422 }, { min: 60000, rate: 0.0458 },
  ], standardDeduction: 0, personalExemption: 2000, taxCredit: 0 },
  { code: "WI", name: "Wisconsin", brackets: [
    { min: 0, rate: 0.035 }, { min: 14680, rate: 0.044 }, { min: 50480, rate: 0.053 }, { min: 323290, rate: 0.0765 },
  ], standardDeduction: 6702, personalExemption: 700, taxCredit: 0 },
  { code: "WY", name: "Wyoming", brackets: [], standardDeduction: 0, personalExemption: 0, taxCredit: 0 },
];

export function findState(code: string): UsState | undefined {
  return US_STATES.find((s) => s.code === code);
}

export function taxedBrackets(state: UsState): TaxBracket[] {
  return state.brackets.filter((b) => b.rate > 0);
}

export function stateTaxLabel(state: UsState): string {
  const taxed = taxedBrackets(state);
  if (taxed.length === 0) return "No income tax";
  if (taxed.length === 1) {
    const pct = formatRate(taxed[0].rate);
    return taxed[0].min > 0 ? `${pct} over ${formatK(taxed[0].min)}` : `${pct} flat`;
  }
  const low = taxed[0].rate;
  const high = taxed[taxed.length - 1].rate;
  return `${formatRate(low)}–${formatRate(high)}`;
}

export function progressiveTax(taxable: number, brackets: TaxBracket[]): number {
  if (taxable <= 0 || brackets.length === 0) return 0;
  const ordered = [...brackets].sort((a, b) => a.min - b.min);
  let tax = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const start = ordered[i].min;
    const end = i + 1 < ordered.length ? ordered[i + 1].min : Number.POSITIVE_INFINITY;
    if (taxable <= start) break;
    const slice = Math.min(taxable, end) - start;
    if (slice > 0) tax += slice * ordered[i].rate;
  }
  return tax;
}

export function estimateStateIncomeTax(annualGross: number, state: UsState): number {
  const taxable = Math.max(0, annualGross - state.standardDeduction - state.personalExemption);
  const raw = progressiveTax(taxable, state.brackets);
  return Math.max(0, raw - state.taxCredit);
}

function formatRate(rate: number): string {
  const pct = rate * 100;
  const text = pct >= 10 || Number.isInteger(pct) ? pct.toFixed(pct >= 10 && pct % 1 !== 0 ? 2 : pct % 1 === 0 ? 0 : 2) : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${text}%`;
}

function formatK(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
}
