import type { Category, Transaction } from "../types.ts";

/** Classic Crayola 64-count box, Wikipedia / Crayola hexes. */
export const CRAYOLA_64: Array<{ name: string; hex: string }> = [
  { name: "Red", hex: "#ED0A3F" },
  { name: "Scarlet", hex: "#FD0E35" },
  { name: "Brick Red", hex: "#C62D42" },
  { name: "Mahogany", hex: "#CA3435" },
  { name: "Chestnut", hex: "#B94E48" },
  { name: "Red-Orange", hex: "#FF3F34" },
  { name: "Bittersweet", hex: "#FE6F5E" },
  { name: "Burnt Orange", hex: "#FF7034" },
  { name: "Orange", hex: "#FF8833" },
  { name: "Macaroni and Cheese", hex: "#FFB97B" },
  { name: "Yellow-Orange", hex: "#FFAE42" },
  { name: "Goldenrod", hex: "#FCD667" },
  { name: "Dandelion", hex: "#FED85D" },
  { name: "Yellow", hex: "#FBE870" },
  { name: "Green-Yellow", hex: "#F1E788" },
  { name: "Olive Green", hex: "#B5B35C" },
  { name: "Spring Green", hex: "#ECEBBD" },
  { name: "Yellow-Green", hex: "#C5E17A" },
  { name: "Asparagus", hex: "#7BA05B" },
  { name: "Granny Smith Apple", hex: "#9DE093" },
  { name: "Green", hex: "#01A368" },
  { name: "Forest Green", hex: "#5FA777" },
  { name: "Sea Green", hex: "#93DFB8" },
  { name: "Robin's Egg Blue", hex: "#00CCCC" },
  { name: "Turquoise Blue", hex: "#6CDAE7" },
  { name: "Sky Blue", hex: "#76D7EA" },
  { name: "Blue-Green", hex: "#0095B7" },
  { name: "Pacific Blue", hex: "#009DC4" },
  { name: "Cerulean", hex: "#02A4D3" },
  { name: "Cornflower", hex: "#93CCEA" },
  { name: "Blue", hex: "#0066FF" },
  { name: "Cadet Blue", hex: "#A9B2C3" },
  { name: "Periwinkle", hex: "#C3CDE6" },
  { name: "Bluetiful", hex: "#263A79" },
  { name: "Blue-Violet", hex: "#6456B7" },
  { name: "Purple Mountains' Majesty", hex: "#8071B4" },
  { name: "Violet", hex: "#8359A3" },
  { name: "Wisteria", hex: "#C9A0DC" },
  { name: "Orchid", hex: "#E29CD2" },
  { name: "Plum", hex: "#843179" },
  { name: "Red-Violet", hex: "#BB3385" },
  { name: "Magenta", hex: "#F653A6" },
  { name: "Wild Strawberry", hex: "#FF3399" },
  { name: "Lavender", hex: "#FBAED2" },
  { name: "Carnation Pink", hex: "#FFA6C9" },
  { name: "Violet-Red", hex: "#F7468A" },
  { name: "Tickle Me Pink", hex: "#FC80A5" },
  { name: "Mauvelous", hex: "#F091A9" },
  { name: "Salmon", hex: "#FF91A4" },
  { name: "Melon", hex: "#FEBAAD" },
  { name: "Burnt Sienna", hex: "#E97451" },
  { name: "Brown", hex: "#AF593E" },
  { name: "Sepia", hex: "#9E5B40" },
  { name: "Raw Sienna", hex: "#D27D46" },
  { name: "Tumbleweed", hex: "#DEA681" },
  { name: "Tan", hex: "#FA9D5A" },
  { name: "Peach", hex: "#FFCBA4" },
  { name: "Apricot", hex: "#FDD5B1" },
  { name: "Gold", hex: "#E6BE8A" },
  { name: "Silver", hex: "#C9C0BB" },
  { name: "Black", hex: "#000000" },
  { name: "Gray", hex: "#8B8680" },
  { name: "Timberwolf", hex: "#D9D6CF" },
  { name: "White", hex: "#FFFFFF" },
];

export const CATEGORY_PALETTE = CRAYOLA_64.map((c) => c.hex);

export const DEFAULT_CATEGORIES: Array<{ id: string; name: string }> = [
  { id: "cat_carins", name: "Car Insurance" },
  { id: "cat_carpay", name: "Car Payment" },
  { id: "cat_child", name: "Child Expenses" },
  { id: "cat_copay", name: "Co-Pay" },
  { id: "cat_debts", name: "Debt" },
  { id: "cat_emergency", name: "Emergency" },
  { id: "cat_extra", name: "Extra Funds" },
  { id: "cat_fastfood", name: "Fast Food" },
  { id: "cat_fun", name: "Fun Money" },
  { id: "cat_gas", name: "Gas" },
  { id: "cat_groceries", name: "Groceries" },
  { id: "cat_gym", name: "Gym" },
  { id: "cat_health", name: "Health Insurance" },
  { id: "cat_internet", name: "Internet" },
  { id: "cat_notinbudget", name: "Not in the Budget" },
  { id: "cat_pet", name: "Pet Expenses" },
  { id: "cat_phone", name: "Phone" },
  { id: "cat_rent", name: "Rent / Mortgage" },
  { id: "cat_save", name: "Savings" },
  { id: "cat_subs", name: "Subscriptions" },
  { id: "cat_tp", name: "TP Fund" },
  { id: "cat_utils", name: "Utilities" },
];

const RETIRED_DEBT_PAYMENTS_ID = "cat_debt";

export function compareCategories(a: Category, b: Category): number {
  const hidden = Number(a.hidden) - Number(b.hidden);
  if (hidden !== 0) return hidden;
  if (b.budgeted !== a.budgeted) return b.budgeted - a.budgeted;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function retireDebtPayments(
  categories: Category[],
  transactions: Transaction[],
): { categories: Category[]; transactions: Transaction[] } {
  const payments = categories.find(
    (c) => c.id === RETIRED_DEBT_PAYMENTS_ID || c.name.toLowerCase() === "debt payments",
  );
  if (!payments) return { categories, transactions };
  const rest = categories.filter((c) => c.id !== payments.id);
  const existing = rest.find((c) => c.id === "cat_debts" || c.name.toLowerCase() === "debt");
  const debt: Category = existing
    ? { ...existing, budgeted: existing.budgeted + payments.budgeted, hidden: existing.hidden && payments.hidden }
    : { ...payments, id: "cat_debts", name: "Debt", isCustom: false };
  const nextCats = existing ? rest.map((c) => (c.id === existing.id ? debt : c)) : [...rest, debt];
  const nextTx = transactions.map((t) => (t.categoryId === payments.id ? { ...t, categoryId: debt.id } : t));
  return { categories: nextCats, transactions: nextTx };
}

/** Leftover unassigned take-home. Not a user budget; Add Funds grows it. */
export const EXTRA_FUNDS_ID = "cat_extra";
export const EXTRA_FUNDS_NAME = "Extra Funds";
export const NOT_IN_BUDGET_ID = "cat_notinbudget";
export const EMERGENCY_ID = "cat_emergency";

export function canHideCategory(id: string): boolean {
  return id !== EXTRA_FUNDS_ID && id !== NOT_IN_BUDGET_ID && id !== EMERGENCY_ID;
}

/** User-set envelope, not leftover Extra Funds. */
export function isAssignedBudget(id: string, envelope: number): boolean {
  return id !== EXTRA_FUNDS_ID && envelope > 0.009;
}

/** Spend with no assigned envelope — Not in the Budget and other unbudgeted slices. */
export function isOutOfBudgetSpend(id: string, envelope: number): boolean {
  return id !== EXTRA_FUNDS_ID && envelope <= 0.009;
}

/** Extra Funds is leftover income, never budget spending. */
export function budgetSpendTotals(
  slices: Array<{ id: string; envelope: number; spent: number; budgeted?: number }>,
): { envelope: number; spent: number; outOfBudget: number; remaining: number; budgeted: number } {
  const assigned = slices.filter((s) => isAssignedBudget(s.id, s.envelope));
  const envelope = assigned.reduce((sum, c) => sum + c.envelope, 0);
  const spent = assigned.reduce((sum, c) => sum + c.spent, 0);
  const outOfBudget = slices
    .filter((s) => isOutOfBudgetSpend(s.id, s.envelope))
    .reduce((sum, c) => sum + c.spent, 0);
  const budgeted = assigned.reduce((sum, c) => sum + (c.budgeted ?? c.envelope), 0);
  return { envelope, spent, outOfBudget, remaining: envelope - spent, budgeted };
}

export function syncExtraFunds(categories: Category[], monthlyIncome: number): Category[] {
  const list = [...categories];
  let extra = list.find((c) => c.id === EXTRA_FUNDS_ID || c.name.toLowerCase() === EXTRA_FUNDS_NAME.toLowerCase());
  if (!extra) {
    extra = {
      id: EXTRA_FUNDS_ID,
      name: EXTRA_FUNDS_NAME,
      isCustom: false,
      budgeted: 0,
      color: "#C8B89A",
      order: list.length,
      hidden: false,
    };
    list.push(extra);
  }
  const others = list
    .filter((c) => c.id !== extra.id && !c.hidden)
    .reduce((sum, c) => sum + c.budgeted, 0);
  const leftover = Math.max(0, Math.round((monthlyIncome - others) * 100) / 100);
  return list.map((c) => {
    if (c.id === extra.id) return { ...c, name: EXTRA_FUNDS_NAME, budgeted: leftover, hidden: false };
    if (c.id === NOT_IN_BUDGET_ID || c.id === EMERGENCY_ID) return { ...c, hidden: false };
    return c;
  });
}

export function createDefaultCategories(): Category[] {
  return DEFAULT_CATEGORIES.map((item, index) => ({
    id: item.id,
    name: item.name,
    isCustom: false,
    budgeted: 0,
    color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
    order: index,
    hidden: false,
  }));
}

export function ensureDefaultCategories(existing: Category[]): Category[] {
  const haveName = new Set(existing.map((c) => c.name.toLowerCase()));
  const haveId = new Set(existing.map((c) => c.id));
  const missing = DEFAULT_CATEGORIES.filter(
    (item) => !haveName.has(item.name.toLowerCase()) && !haveId.has(item.id),
  );
  if (missing.length === 0) return existing;
  const added: Category[] = missing.map((item, index) => ({
    id: item.id,
    name: item.name,
    isCustom: false,
    budgeted: 0,
    color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
    order: index - missing.length,
    hidden: false,
  }));
  return [...added, ...existing].map((c, index) => ({ ...c, order: index }));
}

export function unusedColor(used: Iterable<string>): string {
  const taken = new Set([...used].map((hex) => hex.toUpperCase()));
  const next = CATEGORY_PALETTE.find((hex) => !taken.has(hex.toUpperCase()));
  return next ?? CATEGORY_PALETTE[taken.size % CATEGORY_PALETTE.length];
}

export function nextCustomColor(existing: Category[]): string {
  return unusedColor(existing.map((c) => c.color));
}
