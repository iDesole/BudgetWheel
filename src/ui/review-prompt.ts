/** In-app Play Store rating sheet. Shown once after [reviewEligible]. */
import { openPlayStore } from "../lib/android.ts";
import { resolveReview, reviewPromptVisible } from "../store.ts";

export function mountReviewPrompt(root: HTMLElement): void {
  root.querySelector(".review-root")?.remove();
  if (!reviewPromptVisible) return;
  const overlay = document.createElement("div");
  overlay.className = "review-root";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "review-title");
  overlay.innerHTML = `
    <div class="review-card">
      <p class="brand-mini">Budget Wheel</p>
      <h2 id="review-title" class="headline">How’s the wheel treating you?</h2>
      <p class="sub">A Play Store rating helps other budgeters find the app.</p>
      <button type="button" class="btn btn-primary btn-xl" data-review-rate>Rate Budget Wheel</button>
      <button type="button" class="btn btn-ghost" data-review-later>Not now</button>
      <button type="button" class="btn btn-ghost" data-review-never>Don’t ask again</button>
    </div>`;
  root.append(overlay);
  overlay.querySelector("[data-review-rate]")?.addEventListener("click", async () => {
    await resolveReview("rate");
    openPlayStore();
  });
  overlay.querySelector("[data-review-later]")?.addEventListener("click", () => {
    void resolveReview("later");
  });
  overlay.querySelector("[data-review-never]")?.addEventListener("click", () => {
    void resolveReview("never");
  });
}
