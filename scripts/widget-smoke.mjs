import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const base = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const chrome = process.env.CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const budget = {
  version: 1,
  onboardingComplete: true,
  income: {
    type: "salary",
    salaryPeriod: "annual",
    salaryAmount: 72000,
    state: "TX",
    monthlyGross: 6000,
    monthlyTakeHome: 4800,
    estimatedTaxAnnual: 14400,
    sources: [
      {
        id: "inc_smoke",
        kind: "primary",
        type: "salary",
        salaryPeriod: "annual",
        salaryAmount: 72000,
        monthlyGross: 6000,
        monthlyTakeHome: 4800,
        estimatedTaxAnnual: 14400,
      },
    ],
  },
  categories: [
    {
      id: "cat_rent",
      name: "Rent / Mortgage",
      isCustom: false,
      budgeted: 1800,
      color: "#ED0A3F",
      order: 0,
      hidden: false,
    },
    {
      id: "cat_groceries",
      name: "Groceries",
      isCustom: false,
      budgeted: 500,
      color: "#01A368",
      order: 2,
      hidden: false,
    },
  ],
  transactions: [],
  activeQuarterId: "2026-Q3",
  activeMonthId: "2026-08",
  periodMonths: 2,
  previousSnapshot: null,
  monthHistory: [],
  quarterHistory: [],
  yearHistory: [],
  wheelScale: "month",
  homeChart: "wheel",
  updatedAt: Date.now(),
};

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
page.setDefaultTimeout(15000);
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

async function hasText(needle) {
  return page.evaluate((text) => document.body.innerText.includes(text), needle);
}

async function waitText(needle) {
  await page.waitForFunction((text) => document.body.innerText.includes(text), {}, needle);
}

try {
  await page.goto(`${base}/widget`, { waitUntil: "networkidle0" });
  await waitText("Sign in to log purchases");
  assert(await hasText("Sign in to log purchases"), "logged-out widget should ask to sign in");
  assert(await hasText("Open Budget Wheel"), "logged-out widget should offer open app");

  const name = `Smoke${String(Date.now()).slice(-6)}`;
  const signup = await page.evaluate(async (nm) => {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nm, password: "password12" }),
    });
    return { ok: res.ok, status: res.status, body: await res.json() };
  }, name);
  assert(signup.ok, `signup failed ${signup.status} ${JSON.stringify(signup.body)}`);

  const saved = await page.evaluate(
    async (token, payload) => {
      const res = await fetch("/api/data", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ budget: payload }),
      });
      return { ok: res.ok, status: res.status };
    },
    signup.body.token,
    budget,
  );
  assert(saved.ok, `save budget failed ${saved.status}`);

  await page.evaluate(
    (token, user) => {
      localStorage.setItem("bw_token", token);
      localStorage.setItem("bw_user", JSON.stringify(user));
    },
    signup.body.token,
    signup.body.user,
  );

  await page.goto(`${base}/widget`, { waitUntil: "networkidle0" });
  await waitText("I purchased");
  assert(Boolean(await page.$("svg.wheel-svg")), "widget should show the wheel");
  assert(!(await page.$(".tabbar")), "widget should not show the app tab bar");

  await page.click("[data-buy]");
  await page.waitForSelector(".numpad");
  assert(!(await page.$("svg.wheel-svg")), "numpad should replace the wheel");
  assert(await hasText("How much?"), "amount prompt missing");

  for (const key of ["3", "2", ".", "5"]) {
    await page.click(`[data-key="${key}"]`);
  }
  const shown = await page.$eval("#pad-display", (el) => el.textContent);
  assert(shown === "$32.5", `pad display was ${shown}`);

  await page.click("[data-next]");
  await waitText("Which category?");
  await waitText("Logging $32.50");
  await page.click("[data-cat='cat_groceries']");
  await waitText("Logged $32.50");
  await waitText("I purchased");
  assert(Boolean(await page.$("svg.wheel-svg")), "wheel should return after save");

  let txs = [];
  for (let i = 0; i < 10; i += 1) {
    await new Promise((r) => setTimeout(r, 400));
    const home = await page.evaluate(async (token) => {
      const res = await fetch("/api/data", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    }, signup.body.token);
    txs = home.budget?.transactions ?? [];
    if (txs.some((t) => t.categoryId === "cat_groceries" && t.amount === 32.5)) break;
  }
  assert(
    txs.some((t) => t.categoryId === "cat_groceries" && t.amount === 32.5),
    `purchase not persisted: ${JSON.stringify(txs)}`,
  );
} catch (err) {
  failures.push(`crashed: ${err instanceof Error ? err.message : String(err)}`);
  const html = await page.content();
  console.error("HTML snippet:", html.slice(0, 2000));
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `- ${f}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Widget smoke passed: lock screen, wheel, numpad takeover, purchase persist");
}
