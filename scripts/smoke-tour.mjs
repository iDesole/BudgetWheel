/** Headless walkthrough: 6 live-UI steps, Settings rows, light theme, replay + skip. */
import puppeteer from "puppeteer-core";

const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const base = "http://127.0.0.1:5173";
const failures = [];
const assert = (cond, msg) => {
  if (!cond) failures.push(msg);
};

async function tapKey(page, key) {
  await page.click(`[data-key="${key}"]`);
}

async function typeAmount(page, digits) {
  for (const d of String(digits)) await tapKey(page, d);
}

async function tapText(page, needle) {
  const clicked = await page.evaluate((text) => {
    const hit = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes(text));
    if (!hit) return false;
    hit.click();
    return true;
  }, needle);
  if (!clicked) throw new Error(`no button containing ${needle}`);
}

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox", "--window-size=360,800"],
  defaultViewport: { width: 360, height: 800, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
page.setDefaultTimeout(12000);
page.on("pageerror", (err) => failures.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") failures.push(`console: ${msg.text()}`);
});

try {
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.waitForSelector("h1.brand");
  await page.click("[data-start]");

  await page.waitForSelector(".choice-card");
  await tapText(page, "Salary");
  await page.waitForSelector(".choice-card");
  await tapText(page, "Annual");

  await page.waitForSelector("[data-key='7']");
  await typeAmount(page, "72000");
  await page.click("[data-submit]");

  await page.waitForSelector("input, .state-row");
  const search = await page.$("input");
  if (search) {
    await search.type("Texas");
  }
  await page.waitForSelector(".state-row");
  await page.click(".state-row");

  await page.waitForSelector("[data-confirm]");
  await page.click("[data-confirm]");

  await page.waitForSelector("[data-continue]");
  await page.click("[data-continue]");

  await page.waitForSelector("[data-done], .cat-row");
  const hasRent = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("Rent")),
  );
  if (hasRent) {
    await tapText(page, "Rent");
    await page.waitForSelector("[data-key='1']");
    await typeAmount(page, "1800");
    await page.click("[data-submit]");
    await page.waitForSelector("[data-done], .cat-row");
  }
  await page.waitForSelector("[data-done]");
  await page.click("[data-done]");

  await page.waitForSelector(".tour-root");
  const cardBg = await page.evaluate(() => getComputedStyle(document.querySelector(".tour-card")).backgroundColor);
  assert(cardBg !== "rgba(0, 0, 0, 0)" && cardBg !== "transparent", `tour card transparent: ${cardBg}`);
  const step1 = await page.$eval("#tour-title", (el) => el.textContent);
  assert(step1.includes("This is your wheel"), `step1 title: ${step1}`);
  assert(await page.$('[data-tour="wheel"]'), "missing wheel spotlight target");
  const headerOverlap = await page.evaluate(() => {
    const title = document.querySelector(".home-head-title");
    const toggle = document.querySelector(".home-head-toggle");
    const period = document.querySelector(".period-wrap");
    if (!title || !toggle || !period) return "missing header parts";
    const hits = (a, b) => a.right > b.left + 6 && a.left < b.right - 6 && a.bottom > b.top + 6 && a.top < b.bottom - 6;
    const t = title.getBoundingClientRect();
    const s = toggle.getBoundingClientRect();
    const p = period.getBoundingClientRect();
    if (hits(t, s)) return "title overlaps chart toggle";
    if (hits(t, p)) return "title overlaps period";
    return "";
  });
  assert(!headerOverlap, `header layout: ${headerOverlap}`);
  await page.evaluate(() => document.querySelector("[data-buy]")?.click());
  await new Promise((r) => setTimeout(r, 80));
  const stayedHome = await page.evaluate(
    () => Boolean(document.querySelector(".tour-root") && document.querySelector("[data-buy]") && document.querySelector(".screen-home")),
  );
  assert(stayedHome, "purchase during tour should stay on home");
  await page.waitForSelector("[data-tour-next]");
  await page.click("[data-tour-next]");

  await page.waitForFunction(() => document.querySelector("#tour-title")?.textContent.includes("Tap a slice"));
  await new Promise((r) => setTimeout(r, 550));
  const step2 = await page.$eval("#tour-title", (el) => el.textContent);
  assert(step2.includes("Tap a slice"), `step2 title: ${step2}`);
  assert(await page.$('[data-tour="slice"]'), "step 2 should open a slice card");
  const sliceSpot = await page.evaluate(() => {
    const slice = document.querySelector("[data-tour='slice']");
    const hole = document.querySelector(".tour-spot");
    if (!slice || !hole) return false;
    const a = slice.getBoundingClientRect();
    const b = hole.getBoundingClientRect();
    return Math.abs(a.top - b.top) < 40;
  });
  assert(sliceSpot, "step 2 spotlight should track the slice card, not the wheel");
  await page.click("[data-tour-next]");

  await page.waitForFunction(() => document.querySelector("#tour-title")?.textContent.includes("Wheel or graph"));
  assert(await page.$('[data-tour="chart-toggle"]'), "missing chart toggle");
  assert(await page.$(".home-head-toggle"), "chart toggle should be the icon button");
  await page.click("[data-tour-next]");

  await page.waitForFunction(() => document.querySelector("#tour-title")?.textContent.includes("Add another income"));
  assert(await page.$("#tour-income"), "missing income spotlight");
  await page.click("[data-tour-next]");

  await page.waitForFunction(() => document.querySelector("#tour-title")?.textContent.includes("home screen"));
  assert(await page.$("#tour-widget"), "missing add-widget row");
  await page.click("[data-tour-next]");

  await page.waitForFunction(() => document.querySelector("#tour-title")?.textContent.includes("Past months"));
  assert(await page.$("#tour-history"), "missing spending history spotlight");
  const finalCta = await page.$eval("[data-tour-next]", (el) => el.textContent);
  assert(finalCta.includes("Start using Budget Wheel"), `final cta: ${finalCta}`);
  await page.click("[data-tour-next]");

  await page.waitForFunction(() => !document.querySelector(".tour-root"));
  await page.waitForSelector("[data-buy]");

  await page.click('[data-nav="settings"]');
  await page.waitForSelector("[data-appearance]");
  const settingsText = await page.$eval(".screen-settings", (el) => el.innerText);
  assert(settingsText.includes("Appearance"), "appearance row");
  assert(settingsText.includes("Add Widget"), "widget row");
  assert(settingsText.includes("Spending History"), "history row");
  assert(!settingsText.includes("Download your wheel"), "download row should be gone");
  assert(settingsText.includes("Rate Budget Wheel"), "rate row");
  assert(settingsText.includes("Help"), "help row");

  await tapText(page, "Appearance");
  await page.waitForSelector('[data-theme="light"]');
  await page.evaluate(() => document.querySelector('[data-theme="light"]')?.click());
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.waitForSelector(".screen-settings");
  await page.waitForFunction(() => !document.querySelector(".over-sheet"));
  assert((await page.evaluate(() => document.documentElement.dataset.theme)) === "light", "light theme applied");

  await page.evaluate(() => document.querySelector("[data-help]")?.click());
  await page.waitForSelector("[data-replay]");
  await page.evaluate(() => document.querySelector("[data-replay]")?.click());
  await page.waitForSelector(".tour-root");
  const replay = await page.$eval("#tour-title", (el) => el.textContent);
  assert(replay.includes("This is your wheel"), `replay title: ${replay}`);
  await page.click("[data-tour-next]");
  await page.waitForFunction(() => document.querySelector("#tour-title")?.textContent.includes("Tap a slice"));
  await page.click("[data-tour-next]");
  await page.waitForFunction(() => document.querySelector("#tour-title")?.textContent.includes("Wheel or graph"));
  await page.click("[data-tour-next]");
  await page.evaluate(() => document.querySelector("[data-tour-skip]")?.click());
  await new Promise((r) => setTimeout(r, 700));
  const afterMorphSkip = await page.evaluate(() => ({
    tour: Boolean(document.querySelector(".tour-root")),
    title: document.querySelector("#tour-title")?.textContent ?? "",
  }));
  assert(!afterMorphSkip.tour, `skip during graph morph restarted tour: ${afterMorphSkip.title}`);

  if (failures.length) {
    console.error("FAILURES:\n" + failures.map((f) => `- ${f}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("SMOKE passed: tour 6 steps, settings rows, light theme, replay");
  }
} catch (err) {
  console.error("SMOKE crashed:", err);
  const html = await page.content();
  console.error("HTML snippet:", html.slice(0, 2500));
  process.exitCode = 1;
} finally {
  await browser.close();
}
