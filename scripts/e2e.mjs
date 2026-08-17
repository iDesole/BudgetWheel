import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:4173";

async function tapKey(page, key) {
  await page.locator(`[data-key="${key}"]`).click();
}

async function typeAmount(page, digits) {
  for (const d of String(digits)) {
    await tapKey(page, d);
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Budget Wheel" }).waitFor();
  await page.getByRole("button", { name: "Get started" }).click();

  await page.getByRole("heading", { name: /salary or hourly/i }).waitFor();
  await page.getByRole("button", { name: /Salary/ }).click();
  await page.getByRole("button", { name: /Annual/ }).click();
  await typeAmount(page, "72000");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByPlaceholder("Search states").fill("Texas");
  await page.getByRole("button", { name: /Texas/ }).click();

  await page.getByRole("heading", { name: /monthly income/i }).waitFor();
  const takeHome = await page.locator(".income-hero-value").innerText();
  assert(/\$\d/.test(takeHome), `expected take-home, got ${takeHome}`);
  await page.getByRole("button", { name: /Use \$/ }).click();

  await page.getByText(/of income allocated/).waitFor();
  await page.getByRole("button", { name: /Rent/ }).click();
  await typeAmount(page, "1800");
  await page.getByRole("button", { name: "Submit" }).click();
  await page.getByText(/of income allocated/).waitFor();
  const rentPct = await page.locator(".cat-row").filter({ hasText: "Rent" }).locator(".cat-pct").innerText();
  assert(rentPct.includes("%"), `rent pct missing: ${rentPct}`);

  await page.getByRole("button", { name: /Groceries/ }).click();
  await typeAmount(page, "500");
  await page.getByRole("button", { name: "Submit" }).click();

  await page.getByRole("button", { name: /Other/ }).click();
  await page.getByPlaceholder("e.g. Childcare").fill("Haircuts");
  await page.getByRole("button", { name: "Continue" }).click();
  await typeAmount(page, "40");
  await page.getByRole("button", { name: "Submit" }).click();
  await page.getByText("Haircuts").waitFor();

  await page.getByRole("button", { name: "See my wheel" }).click();
  await page.getByRole("heading", { name: /Keep the wheel spinning/i }).waitFor();
  await page.getByRole("button", { name: "Not now" }).click();

  await page.getByRole("heading", { name: /Q3 2026/ }).waitFor();
  await page.getByRole("button", { name: "I purchased" }).click();
  await typeAmount(page, "32");
  await tapKey(page, ".");
  await tapKey(page, "5");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Groceries/ }).click();
  await page.getByText(/Logged/).waitFor();
  await page.getByRole("heading", { name: /Q3 2026/ }).waitFor();

  await page.getByRole("button", { name: "Past Quarter" }).click();
  await page.getByText(/No archive yet/).waitFor();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByText(/Monthly income/).waitFor();

  const manifest = await page.evaluate(async () => {
    const res = await fetch("/manifest.webmanifest");
    return { ok: res.ok, json: await res.json() };
  });
  assert(manifest.ok, "manifest not served");
  assert(manifest.json.display === "standalone", "manifest display not standalone");
  assert(manifest.json.name === "Budget Wheel", "manifest name");
  assert(Array.isArray(manifest.json.shortcuts) && manifest.json.shortcuts[0]?.url === "/widget", "widget shortcut");

  const sw = await page.evaluate(async () => {
    const res = await fetch("/sw.js");
    return res.ok;
  });
  assert(sw, "service worker file missing");

  if (failures.length) {
    console.error("FAILURES:\n" + failures.map((f) => `- ${f}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("E2E passed: onboarding, catalog %, custom category, wheel, purchase, past quarter, PWA files");
  }
} catch (err) {
  console.error("E2E crashed:", err);
  const html = await page.content();
  console.error("HTML snippet:", html.slice(0, 1500));
  process.exitCode = 1;
} finally {
  await browser.close();
}
