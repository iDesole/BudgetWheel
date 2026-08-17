export function numpadMarkup(): string {
  const keys = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    [".", "0", "back"],
  ];
  return `
    <div class="numpad" role="group" aria-label="Number pad">
      ${keys
        .map(
          (row) => `
        <div class="numpad-row">
          ${row
            .map((key) => {
              if (key === "back") {
                return `<button type="button" class="numpad-key numpad-back" data-key="back" aria-label="Delete">
                  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M9 6H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-6.2-6a1 1 0 0 1 0-1.4L9 6z"/>
                    <path d="m15 10-4 4M11 10l4 4"/>
                  </svg>
                </button>`;
              }
              return `<button type="button" class="numpad-key" data-key="${key}">${key}</button>`;
            })
            .join("")}
        </div>`,
        )
        .join("")}
    </div>`;
}

export function bindNumpad(root: HTMLElement, onKey: (key: string) => void): void {
  root.querySelectorAll<HTMLButtonElement>("[data-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      onKey(btn.dataset.key ?? "");
    });
  });
}
