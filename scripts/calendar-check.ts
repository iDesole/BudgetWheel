import {
  advancePeriodCursor,
  compareMonthId,
  compareQuarterId,
  eachMonthId,
  eachQuarterId,
  eachYearId,
  formatMonthLabel,
  formatQuarterRange,
  getQuarter,
  isSameMonth,
  isSameQuarter,
  isSameYear,
  monthIdFromDate,
  nextLocalMidnight,
  parseMonthId,
  parseQuarterId,
  quarterIdFromDate,
  quarterIdFromMonthId,
  quarterYear,
} from "../src/lib/quarter.ts";

const failures: string[] = [];

function assert(cond: unknown, msg: string): void {
  if (!cond) failures.push(msg);
}

function at(y: number, m: number, d: number, hh = 12, mm = 0): Date {
  return new Date(y, m, d, hh, mm, 0, 0);
}

function ts(y: number, m: number, d: number, hh = 12): number {
  return at(y, m, d, hh).getTime();
}

// --- year boundaries ---
assert(quarterIdFromDate(at(2026, 11, 31, 23, 59)) === "2026-Q4", "Dec 31 is Q4 of that year");
assert(quarterIdFromDate(at(2027, 0, 1, 0, 0)) === "2027-Q1", "Jan 1 is Q1 of the new year");
assert(monthIdFromDate(at(2026, 11, 31)) === "2026-12", "Dec month id");
assert(monthIdFromDate(at(2027, 0, 1)) === "2027-01", "Jan month id next year");
assert(compareMonthId("2027-01", "2026-12") === 1, "Jan is one month after Dec");
assert(compareQuarterId("2027-Q1", "2026-Q4") === 1, "Q1 next year is one quarter after Q4");
assert(compareMonthId("2028-01", "2026-01") === 24, "two years is 24 months");
assert(compareQuarterId("2029-Q1", "2026-Q1") === 12, "three years is 12 quarters");
assert(quarterYear("2027-Q1") === 2027, "quarter year 2027");
assert(quarterYear("2026-Q4") === 2026, "quarter year 2026");

// --- all quarter edges ---
assert(getQuarter(at(2026, 0, 1)).id === "2026-Q1" && getQuarter(at(2026, 0, 1)).monthsRemaining === 3, "Jan remaining 3");
assert(getQuarter(at(2026, 1, 1)).monthsRemaining === 2, "Feb remaining 2");
assert(getQuarter(at(2026, 2, 1)).monthsRemaining === 1, "Mar remaining 1");
assert(getQuarter(at(2026, 2, 31)).id === "2026-Q1", "Mar 31 still Q1");
assert(getQuarter(at(2026, 3, 1)).id === "2026-Q2", "Apr 1 is Q2");
assert(getQuarter(at(2026, 5, 30)).id === "2026-Q2", "Jun 30 still Q2");
assert(getQuarter(at(2026, 6, 1)).id === "2026-Q3", "Jul 1 is Q3");
assert(getQuarter(at(2026, 8, 30)).id === "2026-Q3", "Sep 30 still Q3");
assert(getQuarter(at(2026, 9, 1)).id === "2026-Q4", "Oct 1 is Q4");
assert(getQuarter(at(2026, 11, 31)).id === "2026-Q4", "Dec 31 still Q4");

const q4 = parseQuarterId("2026-Q4");
assert(q4?.startIso === "2026-10-01" && q4.endIso === "2026-12-31", "Q4 2026 dates");
const q1 = parseQuarterId("2027-Q1");
assert(q1?.startIso === "2027-01-01" && q1.endIso === "2027-03-31", "Q1 2027 dates");
const q1Leap = parseQuarterId("2028-Q1");
assert(q1Leap?.endIso === "2028-03-31", "Q1 2028 still ends Mar 31");

// --- leap years ---
assert(monthIdFromDate(at(2028, 1, 29)) === "2028-02", "Feb 29 2028 exists");
assert(isoNext(at(2028, 1, 28)) === "2028-02-29", "night after Feb 28 2028 is Feb 29");
assert(isoNext(at(2027, 1, 28)) === "2027-03-01", "night after Feb 28 2027 is Mar 1");
assert(isoNext(at(2028, 1, 29)) === "2028-03-01", "night after Feb 29 2028 is Mar 1");

function isoNext(d: Date): string {
  const n = nextLocalMidnight(d);
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const day = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

assert(isoNext(at(2026, 11, 31, 23, 0)) === "2027-01-01", "midnight after Dec 31 is Jan 1 next year");
assert(isoNext(at(2027, 0, 31, 22, 0)) === "2027-02-01", "Jan 31 rolls to Feb 1");
assert(isoNext(at(2027, 2, 31, 22, 0)) === "2027-04-01", "Mar 31 rolls to Apr 1");

// --- same-period filters across New Year ---
assert(isSameMonth(ts(2026, 11, 15), at(2026, 11, 31)), "same December");
assert(!isSameMonth(ts(2026, 11, 31), at(2027, 0, 1)), "Dec vs Jan is a new month");
assert(!isSameQuarter(ts(2026, 11, 31), at(2027, 0, 1)), "Q4 vs Q1 is a new quarter");
assert(!isSameYear(ts(2026, 11, 31), at(2027, 0, 1)), "2026 vs 2027 is a new year");
assert(isSameQuarter(ts(2027, 0, 1), at(2027, 2, 31)), "Jan and Mar are Q1");
assert(!isSameQuarter(ts(2027, 2, 31), at(2027, 3, 1)), "Mar vs Apr is a new quarter");
assert(isSameYear(ts(2027, 0, 1), at(2027, 11, 31)), "all of 2027 is the same year");
assert(!isSameMonth(0, at(2027, 0, 1)), "epoch 0 is not this month");

// --- cursor: keep budget, advance month/quarter only forward ---
const nye = advancePeriodCursor({ activeQuarterId: "2026-Q4", activeMonthId: "2026-12" }, at(2027, 0, 1, 0, 1));
assert(nye.monthAdvanced && nye.quarterAdvanced && !nye.clockSkew, "New Year advances month and quarter");
assert(nye.cursor.activeMonthId === "2027-01" && nye.cursor.activeQuarterId === "2027-Q1", "cursor is Jan / Q1");

const feb = advancePeriodCursor({ activeQuarterId: "2027-Q1", activeMonthId: "2027-01" }, at(2027, 1, 1, 0, 1));
assert(feb.monthAdvanced && !feb.quarterAdvanced, "Feb 1 resets the month only");
assert(feb.cursor.activeMonthId === "2027-02" && feb.cursor.activeQuarterId === "2027-Q1", "still Q1 in February");

const apr = advancePeriodCursor({ activeQuarterId: "2027-Q1", activeMonthId: "2027-03" }, at(2027, 3, 1, 0, 1));
assert(apr.monthAdvanced && apr.quarterAdvanced, "Apr 1 starts Q2");
assert(apr.cursor.activeQuarterId === "2027-Q2", "cursor Q2");

const same = advancePeriodCursor({ activeQuarterId: "2027-Q2", activeMonthId: "2027-05" }, at(2027, 4, 20));
assert(!same.monthAdvanced && !same.quarterAdvanced && !same.clockSkew, "mid-month is a no-op");

const skew = advancePeriodCursor({ activeQuarterId: "2027-Q1", activeMonthId: "2027-02" }, at(2027, 0, 15));
assert(skew.clockSkew && !skew.monthAdvanced && !skew.quarterAdvanced, "clock going backward does not rewind");
assert(skew.cursor.activeMonthId === "2027-02", "skew keeps stored month");

const skipYear = advancePeriodCursor({ activeQuarterId: "2026-Q3", activeMonthId: "2026-08" }, at(2028, 0, 3));
assert(skipYear.monthAdvanced && skipYear.quarterAdvanced, "opening the app two New Years later still advances");
assert(skipYear.cursor.activeQuarterId === "2028-Q1" && skipYear.cursor.activeMonthId === "2028-01", "lands on Jan 2028");

const far = advancePeriodCursor({ activeQuarterId: "2026-Q4", activeMonthId: "2026-12" }, at(2031, 6, 4));
assert(far.cursor.activeQuarterId === "2031-Q3" && far.cursor.activeMonthId === "2031-07", "2031 still works");

// --- parse guards ---
assert(parseMonthId("2027-13") === null, "month 13 is invalid");
assert(parseMonthId("2027-00") === null, "month 00 is invalid");
assert(parseQuarterId("2027-Q5") === null, "Q5 is invalid");
assert(parseQuarterId("27-Q1") === null, "2-digit year is invalid");

assert(JSON.stringify(eachMonthId("2026-11", "2027-02")) === JSON.stringify(["2026-11", "2026-12", "2027-01"]), "months across New Year");
assert(JSON.stringify(eachQuarterId("2026-Q4", "2027-Q2")) === JSON.stringify(["2026-Q4", "2027-Q1"]), "quarters across New Year");
assert(JSON.stringify(eachYearId(2026, 2029)) === JSON.stringify(["2026", "2027", "2028"]), "years 2026-2028");
assert(quarterIdFromMonthId("2026-12") === "2026-Q4", "Dec is Q4");
assert(quarterIdFromMonthId("2027-01") === "2027-Q1", "Jan is Q1");
assert(formatMonthLabel("2027-01") === "Jan 2027", "January 2027 label");

const range = formatQuarterRange("2026-10-01", "2026-12-31");
assert(range.includes("2026") && range.includes("Oct") && range.includes("Dec"), `Q4 range: ${range}`);
assert(formatQuarterRange("", "") === "", "empty range is blank");
assert(formatQuarterRange("nope", "2026-12-31") === "", "bad iso is blank");

if (failures.length) {
  console.error(`calendar-check failed (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("calendar-check: all year, quarter, month, and leap-year cases passed");
