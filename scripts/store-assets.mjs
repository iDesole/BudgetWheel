import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storeDir = path.join(root, "store");
const shotDir = path.join(storeDir, "screenshots");
const chrome = process.env.BROWSER_BIN ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const base = process.env.BASE_URL ?? "http://127.0.0.1:4173";

const USER = { id: "store-shot", name: "This device", createdAt: 1_700_000_000_000 };

function demoState() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const q = Math.floor(now.getMonth() / 3) + 1;
  const monthStart = new Date(y, now.getMonth(), 4).getTime();
  const cats = [
    ["cat_rent", "Rent / Mortgage", 1600, "#76D7EA", false],
    ["cat_carpay", "Car Payment", 385, "#FF7034", false],
    ["cat_groceries", "Groceries", 520, "#01A368", false],
    ["cat_utils", "Utilities", 175, "#FED85D", false],
    ["cat_gas", "Gas", 160, "#FF8833", false],
    ["cat_phone", "Phone", 85, "#6CDAE7", false],
    ["cat_internet", "Internet", 70, "#0095B7", false],
    ["cat_fun", "Fun Money", 150, "#F653A6", false],
    ["cat_save", "Savings", 400, "#5FA777", false],
    ["cat_subs", "Subscriptions", 40, "#8359A3", false],
    ["cat_fastfood", "Fast Food", 90, "#ED0A3F", false],
    ["cat_extra", "Extra Funds", 1175, "#C8B89A", false],
    ["cat_notinbudget", "Not in the Budget", 0, "#8B8680", false],
    ["cat_emergency", "Emergency", 0, "#C62D42", false],
    ["cat_carins", "Car Insurance", 0, "#FD0E35", true],
    ["cat_child", "Child Expenses", 0, "#CA3435", true],
    ["cat_copay", "Co-Pay", 0, "#B94E48", true],
    ["cat_debts", "Debt", 0, "#FF3F34", true],
    ["cat_gym", "Gym", 0, "#FE6F5E", true],
    ["cat_health", "Health Insurance", 0, "#FFAE42", true],
    ["cat_pet", "Pet Expenses", 0, "#FCD667", true],
    ["cat_tp", "TP Fund", 0, "#FBE870", true],
  ];
  const categories = cats.map(([id, name, budgeted, color, hidden], order) => ({
    id, name, isCustom: false, budgeted, color, order, hidden,
  }));
  const transactions = [
    { id: "tx1", categoryId: "cat_groceries", amount: 86.42, createdAt: monthStart },
    { id: "tx2", categoryId: "cat_gas", amount: 48.2, createdAt: monthStart + 86400000 },
    { id: "tx3", categoryId: "cat_fun", amount: 32, createdAt: monthStart + 172800000 },
    { id: "tx4", categoryId: "cat_fastfood", amount: 14.75, createdAt: monthStart + 259200000 },
    { id: "tx5", categoryId: "cat_subs", amount: 15.99, createdAt: monthStart + 345600000 },
    { id: "tx6", categoryId: "cat_utils", amount: 142.18, createdAt: monthStart + 432000000 },
  ];
  return {
    version: 1,
    onboardingComplete: true,
    income: {
      type: "salary",
      salaryPeriod: "annual",
      salaryAmount: 72000,
      state: "TX",
      monthlyGross: 6000,
      monthlyTakeHome: 4850,
      estimatedTaxAnnual: 13800,
      sources: [
        {
          id: "inc_primary",
          kind: "primary",
          type: "salary",
          salaryPeriod: "annual",
          salaryAmount: 72000,
          monthlyGross: 6000,
          monthlyTakeHome: 4850,
          estimatedTaxAnnual: 13800,
        },
      ],
    },
    categories,
    transactions,
    activeQuarterId: `${y}-Q${q}`,
    activeMonthId: `${y}-${m}`,
    periodMonths: 1,
    previousSnapshot: null,
    monthHistory: [],
    quarterHistory: [],
    yearHistory: [],
    wheelScale: "month",
    homeChart: "wheel",
    updatedAt: Date.now(),
  };
}

async function writeIdb(page, state) {
  await page.evaluate(async ({ user, state }) => {
    localStorage.setItem("bw_user", JSON.stringify(user));
    localStorage.setItem("bw_token", `local.${user.id}`);
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("budgetwheel", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(state, `state:${user.id}`);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { user: USER, state });
}

async function shot(page, name) {
  const dest = path.join(shotDir, `${name}.png`);
  await page.screenshot({ path: dest, type: "png" });
  console.log("wrote", dest);
}

async function tap(page, selector) {
  await page.waitForSelector(selector, { visible: true });
  await new Promise((r) => setTimeout(r, 150));
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing ${sel}`);
    el.click();
  }, selector);
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--hide-scrollbars", "--window-size=1080,1920"],
});

try {
  await mkdir(shotDir, { recursive: true });

  const graphic = await browser.newPage();
  await graphic.setViewport({ width: 1024, height: 500, deviceScaleFactor: 1 });
  await graphic.goto(pathToFileURL(path.join(storeDir, "feature-graphic.html")), { waitUntil: "networkidle0" });
  await graphic.evaluate(() => document.fonts.ready);
  await graphic.screenshot({ path: path.join(storeDir, "feature-graphic.png"), type: "png" });
  console.log("wrote feature-graphic.png");
  await graphic.close();

  const phone = {
    viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  };

  const welcome = await browser.newPage();
  await welcome.setViewport(phone.viewport);
  await welcome.goto(base, { waitUntil: "networkidle0" });
  await welcome.waitForSelector("[data-start]");
  await shot(welcome, "01-welcome");
  await welcome.close();

  const app = await browser.newPage();
  await app.setViewport(phone.viewport);
  await app.goto(base, { waitUntil: "networkidle0" });
  await writeIdb(app, demoState());
  await app.reload({ waitUntil: "networkidle0" });
  await app.waitForSelector("[data-buy]");
  await new Promise((r) => setTimeout(r, 400));
  await shot(app, "02-wheel");

  await tap(app, "[data-toggle-chart]");
  await shot(app, "03-graph");

  await tap(app, "[data-buy]");
  await app.waitForSelector("[data-key='1']");
  for (const key of ["3", "2", ".", "5", "0"]) {
    await tap(app, `[data-key='${key}']`);
  }
  await shot(app, "04-purchase");

  await tap(app, "[data-back]");
  await tap(app, '[data-nav="settings"]');
  await app.waitForSelector("[data-privacy]");
  await shot(app, "05-settings");

  await tap(app, '[data-nav="categories"]');
  await app.waitForSelector(".cat-row, .catalog-list");
  await shot(app, "06-categories");
} finally {
  await browser.close();
}

function pathToFileURL(p) {
  const resolved = path.resolve(p).replaceAll("\\", "/");
  return `file:///${resolved}`;
}
