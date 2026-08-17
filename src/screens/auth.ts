import { logoSvg } from "../ui/icons.ts";
import { startOnThisDevice } from "../store.ts";

export function renderWelcomeAuth(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `
    <section class="screen screen-welcome">
      <div class="welcome-hero">
        ${logoSvg}
        <h1 class="brand">Budget Wheel</h1>
        <p class="lede">See where every dollar goes.</p>
      </div>
      <div class="welcome-privacy">
        <p class="brand-mini">Privacy</p>
        <h2 class="headline">Your information stays on this device</h2>
        <p class="sub">Budget Wheel does not collect, transmit, or sell your personal or financial information. Your income and spending history are stored only on this device.</p>
        <p class="sub">Nothing is uploaded to any server or shared with third parties. If you uninstall the app or erase this device, that information cannot be recovered.</p>
      </div>
      <div class="welcome-actions">
        <button type="button" class="btn btn-primary btn-xl" data-start>Continue</button>
      </div>
    </section>`;
  el.querySelector("[data-start]")?.addEventListener("click", () => {
    void startOnThisDevice();
  });
  return el;
}
