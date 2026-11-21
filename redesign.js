(() => {
  "use strict";

  // Rules and Stats popups.
  document.querySelectorAll("[data-open-dialog]").forEach((button) => {
    button.addEventListener("click", () => document.getElementById(button.dataset.openDialog)?.showModal());
  });
  document.querySelectorAll("dialog.info-dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    dialog.querySelector("[data-close-dialog]")?.addEventListener("click", () => dialog.close());
  });

  // Colour the big WIN / LOSS / EVEN title to match the outcome.
  const title = document.getElementById("result-title");
  if (title) {
    const sync = () => { title.dataset.result = title.textContent.trim(); };
    new MutationObserver(sync).observe(title, { childList: true, characterData: true, subtree: true });
    sync();
  }
})();
