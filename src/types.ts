export type IncomeKind = "primary" | "second" | "side";
export type WheelScale = "month" | "quarter" | "year";
export type HomeChart = "wheel" | "bars";

export interface IncomeSource {
  id: string;
  kind: IncomeKind;
  type: "salary" | "hourly" | "side";
  salaryPeriod?: "annual" | "monthly";
  salaryAmount?: number;
  hourlyWage?: number;
  hoursPerWeek?: number;
  monthlyGross: number;
  monthlyTakeHome: number;
  estimatedTaxAnnual: number;
}

export interface Income {
  type: "salary" | "hourly" | "side";
  salaryPeriod?: "annual" | "monthly";
  salaryAmount?: number;
  hourlyWage?: number;
  hoursPerWeek?: number;
  state: string;
  monthlyGross: number;
  monthlyTakeHome: number;
  estimatedTaxAnnual: number;
  sources: IncomeSource[];
}

export interface Category {
  id: string;
  name: string;
  isCustom: boolean;
  budgeted: number;
  color: string;
  order: number;
  hidden: boolean;
}

export interface Transaction {
  id: string;
  categoryId: string;
  amount: number;
  createdAt: number;
}

export interface SnapshotCategory {
  id: string;
  name: string;
  color: string;
  budgetedMonthly: number;
  spent: number;
}

export type HistoryScale = "month" | "quarter" | "year";

export interface WheelSnapshot {
  id: string;
  scale: HistoryScale;
  quarterId: string;
  label: string;
  startIso: string;
  endIso: string;
  periodMonths: number;
  monthlyIncome: number;
  categories: SnapshotCategory[];
  capturedAt: number;
}

export interface PersistedState {
  version: 1;
  onboardingComplete: boolean;
  income: Income | null;
  categories: Category[];
  transactions: Transaction[];
  activeQuarterId: string;
  activeMonthId: string;
  periodMonths: number;
  previousSnapshot: WheelSnapshot | null;
  monthHistory: WheelSnapshot[];
  quarterHistory: WheelSnapshot[];
  yearHistory: WheelSnapshot[];
  wheelScale: WheelScale;
  homeChart: HomeChart;
  updatedAt: number;
}

export type Screen =
  | { id: "welcome" }
  | { id: "pay-type" }
  | { id: "salary-period" }
  | { id: "salary-amount" }
  | { id: "hourly-wage" }
  | { id: "hourly-hours" }
  | { id: "state" }
  | { id: "income-confirm" }
  | { id: "income-adjust" }
  | { id: "extra-income" }
  | { id: "side-amount" }
  | { id: "catalog"; from?: "onboarding" | "settings" }
  | { id: "budget-amount"; categoryId: string; from?: "onboarding" | "settings" | "home" }
  | { id: "add-custom"; from?: "onboarding" | "settings" }
  | { id: "home" }
  | { id: "category-activity"; categoryId: string; periodId?: string }
  | { id: "purchase-amount" }
  | { id: "purchase-category"; amount: number }
  | { id: "past-quarter" }
  | { id: "history-period"; periodId: string }
  | { id: "settings" };

export interface IncomeDraft {
  type?: "salary" | "hourly" | "side";
  salaryPeriod?: "annual" | "monthly";
  salaryAmount?: number;
  hourlyWage?: number;
  hoursPerWeek?: number;
  state?: string;
  monthlyTakeHomeOverride?: number;
  slot?: IncomeKind;
  sourceId?: string;
}

export interface TaxBreakdown {
  monthlyGross: number;
  annualGross: number;
  standardDeduction: number;
  taxableIncome: number;
  federal: number;
  fica: number;
  state: number;
  stateRate: number;
  annualTax: number;
  monthlyTakeHome: number;
}
