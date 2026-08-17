import puppeteer from "puppeteer-core";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const chrome = process.env.CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const name = `Alex${String(Date.now()).slice(-6)}`;
const password = "correcthorse";

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox", "--window-size=390,844"],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();

try {
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-signup]");
  const welcome = await page.$eval("h1.brand", (el) => el.textContent);
  if (welcome !== "Budget Wheel") throw new Error(`welcome title: ${welcome}`);

  await page.click("[data-signup]");
  await page.waitForSelector("form.auth-form");
  await page.type("[name=name]", name);
  await page.type("[name=password]", password);
  await page.type("[name=confirm]", password);
  await page.click("button[type=submit]");

  await page.waitForSelector("[data-type=salary]", { timeout: 8000 });
  const headline = await page.$eval(".headline", (el) => el.textContent);
  if (!/salary or hourly/i.test(headline)) throw new Error(`expected income onboarding, got ${headline}`);

  await page.click("[data-type=salary]");
  await page.waitForSelector("[data-period=annual]");
  await page.click("[data-period=annual]");
  await page.waitForSelector("[data-key='7']");
  for (const key of ["7", "2", "0", "0", "0"]) {
    await page.click(`[data-key='${key}']`);
  }
  await page.click("[data-submit]");
  await page.waitForSelector(".search");
  await page.type(".search", "Texas");
  await page.waitForSelector("[data-state=TX]");
  await page.click("[data-state=TX]");
  await page.waitForSelector("[data-confirm]");
  const takeHome = await page.$eval(".income-hero-value", (el) => el.textContent);
  if (!takeHome.includes("$")) throw new Error(`take-home missing: ${takeHome}`);
  await page.click("[data-confirm]");
  await page.waitForSelector("[data-done]");

  await page.goto(base, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-done], .quarter-title, [data-buy]");
  const stillOnboarded = await page.$("[data-done]");
  if (!stillOnboarded) throw new Error("session did not restore signed-in catalog");

  console.log(`E2E passed as ${name}; take-home ${takeHome}; session restored`);
} catch (err) {
  console.error("E2E failed:", err);
  console.error(await page.content().then((h) => h.slice(0, 2000)));
  process.exitCode = 1;
} finally {
  await browser.close();
}
