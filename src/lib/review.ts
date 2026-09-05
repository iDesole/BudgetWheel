/**
 * Play Store review prompt. Shown once, after 7 days and either 3 logged
 * entries or 7 distinct open days. Choice is rate / later / never.
 */
import { isoDate } from "./quarter.ts";
import type { PersistedState, ReviewPromptState } from "../types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const WAIT_DAYS = 7;
const MIN_ENTRIES = 3;
const MIN_OPEN_DAYS = 7;

export function loggedEntryCount(state: PersistedState): number {
  return state.transactions.length;
}

export function reviewEligible(state: PersistedState, now = new Date()): boolean {
  if (state.reviewPromptState !== "not_asked") return false;
  if (!state.onboardingComplete || !state.firstSetupAt) return false;
  if (now.getTime() < state.firstSetupAt + WAIT_DAYS * DAY_MS) return false;
  return loggedEntryCount(state) >= MIN_ENTRIES || state.openDayCount >= MIN_OPEN_DAYS;
}

export function nextOpenDay(state: PersistedState, now = new Date()): { openDayCount: number; lastOpenDay: string } | null {
  if (!state.onboardingComplete) return null;
  const day = isoDate(now);
  if (state.lastOpenDay === day) return null;
  return {
    lastOpenDay: day,
    openDayCount: state.openDayCount + 1,
  };
}

export function reviewAfterChoice(choice: "rate" | "later" | "never"): ReviewPromptState {
  if (choice === "rate") return "rated";
  if (choice === "never") return "never";
  return "shown";
}
