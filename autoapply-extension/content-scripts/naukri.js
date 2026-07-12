/**
 * naukri.js — content script for *.naukri.com
 *
 * Handles two situations:
 *  1. A single job page with an "Apply" button (opens a chatbot-style modal
 *     for some jobs, or applies instantly for others).
 *  2. A search-results page, where "Start Auto-Apply" walks through the
 *     visible job cards one at a time.
 *
 * Activated by popup button or auto-start setting. Detects stalls in modal
 * handling and logs diagnostic info when selectors may be missing.
 */

(() => {
  const U = AutoApplyUtils;
  let running = false;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "START_NAUKRI_APPLY") {
      if (running) return;
      running = true;
      runNaukriFlow(msg.mode).finally(() => (running = false));
    }
    if (msg.type === "STOP_AUTOAPPLY") {
      running = false;
    }
  });

  // Auto-start: if enabled, begin the moment the page finishes loading —
  // no click needed.
  (async () => {
    const { settings } = await U.getProfile();
    if (settings.autoStart && !running) {
      await U.humanDelay(1000, 2000);
      running = true;
      const mode = /\/job-listings|\/jobs/.test(location.href) && !/jobdescription|jobid/.test(location.href)
        ? "list" : "single";
      runNaukriFlow(mode).finally(() => (running = false));
    }
  })();

  async function runNaukriFlow(mode) {
    const { profile, settings } = await U.getProfile();

    if (mode === "list") {
      await applyToSearchResults(profile, settings);
    } else {
      await applyToSingleJob(profile, settings);
    }
  }

  async function applyToSearchResults(profile, settings) {
    let pageNum = 0;
    while (running && pageNum < 50) {
      pageNum++;
      // GUESSED SELECTOR: .jobTuple, .srp-jobtuple-wrapper — not verified against live DOM.
      // If these don't match, cards won't be found. Check DevTools Elements panel for actual classes on job cards.
      const cards = Array.from(document.querySelectorAll(".jobTuple, .srp-jobtuple-wrapper"));
      
      if (!cards.length) {
        console.warn("[AutoApply] No job cards found. Searching page for alternative selectors...");
        console.log("Page HTML sample:", document.body.innerHTML.slice(0, 500));
      }

      for (const card of cards) {
        if (!running) break;
        // GUESSED SELECTOR for apply button — multiple fallbacks but unverified.
        // If none match, check the card's outerHTML below.
        const applyBtn = card.querySelector(
          "button.apply-btn, .apply-button, [class*='apply-btn']"
        );
        if (!applyBtn) {
          console.warn("[AutoApply] No Apply button found in card. Card HTML:", card.outerHTML.slice(0, 300));
          continue;
        }
        if (/applied/i.test(applyBtn.innerText)) continue;
        if (U.isEffectivelyEmpty(applyBtn)) {
          console.warn("[AutoApply] Apply button is empty/whitespace, skipping.");
          continue;
        }

        U.realClick(applyBtn);
        await U.humanDelay(1200, 2200);
        await handlePossibleModal(profile, settings);
        await U.humanDelay(1500, 3000);
      }

      // Move to the next page of search results and keep going.
      // GUESSED SELECTORS for pagination — unverified.
      const nextPageBtn = document.querySelector(
        "a.styles_btn-secondary__2AsIP, .pagination a[class*='next'], a[aria-label='Next']"
      );
      if (!running || !nextPageBtn || nextPageBtn.classList.contains("disabled")) break;
      
      if (U.isEffectivelyEmpty(nextPageBtn)) {
        console.warn("[AutoApply] Next page button is empty, stopping pagination.");
        break;
      }

      U.realClick(nextPageBtn);
      const settled = await U.waitForElement(".jobTuple, .srp-jobtuple-wrapper", 6000);
      if (!settled) break;
      await U.humanDelay(1500, 2500);
    }
  }

  async function applyToSingleJob(profile, settings) {
    // GUESSED SELECTOR for Apply button — multiple fallbacks but unverified.
    const applyBtn = document.querySelector(
      "#apply-button, .apply-button, button[class*='apply-btn']"
    );
    if (!applyBtn) {
      console.warn("[AutoApply] No Apply button found on this Naukri page.");
      console.log("[Diagnostic] Page URL:", location.href);
      return;
    }
    if (U.isEffectivelyEmpty(applyBtn)) {
      console.warn("[AutoApply] Apply button is empty/whitespace.");
      return;
    }

    U.realClick(applyBtn);
    await U.humanDelay(1200, 2200);
    await handlePossibleModal(profile, settings);
  }

  /**
   * Naukri sometimes opens a "chat" style modal asking follow-up questions
   * (notice period, CTC, a couple of custom yes/no or dropdown questions)
   * before the application actually goes through. This walks through it with
   * stall detection — if we loop 3 times with no state change, dump the modal HTML
   * for inspection.
   */
  async function handlePossibleModal(profile, settings) {
    // GUESSED SELECTORS for modal container — multiple fallbacks, unverified.
    const modal = await U.waitForElement(
      ".chatbot_DrawerContentWrapper, .apply-status-body, .naukri-chatbot",
      4000
    );
    if (!modal) return; // instant-apply, nothing more to do

    let steps = 0;
    let stallCount = 0; // stall detection: if 3 steps with no change, bail with diagnostic
    let prevModalInnerText = "";

    while (running && steps < 15) {
      steps++;
      await U.humanDelay(600, 1200);

      // Check for stall: if modal content hasn't changed in the last iteration, increment stallCount
      const currentText = modal.innerText || "";
      if (currentText === prevModalInnerText) {
        stallCount++;
      } else {
        stallCount = 0;
      }
      prevModalInnerText = currentText;

      if (stallCount >= 3) {
        console.warn(
          "[AutoApply] Naukri modal stalled (no state change for 3 iterations). Dumping modal HTML for inspection:",
          modal.outerHTML
        );
        break;
      }

      // Text inputs inside the chat modal
      const textInput = modal.querySelector("input[type='text']:not([disabled]), textarea:not([disabled])");
      if (textInput && document.activeElement !== textInput) {
        const label = U.findLabelText(textInput) || textInput.placeholder || "";
        const value = U.matchProfileValue(label, profile) || profile.experienceYears || "";
        if (value) {
          U.setNativeValue(textInput, value);
          await U.humanDelay(200, 400);
        }
      }

      // Radio / chip style single-select options
      // GUESSED SELECTORS: [class*='chatbot_ListItem'], .ssrc__jd-btn, li.suggestor — unverified.
      const options = modal.querySelectorAll("[class*='chatbot_ListItem'], .ssrc__jd-btn, li.suggestor");
      if (options.length) {
        let clickedOption = false;
        // Filter out empty options and pick the first visible, non-empty one
        for (const opt of options) {
          if (!U.isEffectivelyEmpty(opt)) {
            if (settings.autoSubmit) {
              if (U.realClick(opt)) {
                clickedOption = true;
                break;
              }
            } else {
              break; // let user finish if autoSubmit is off
            }
          }
        }
        if (options.length && !clickedOption) {
          console.warn(
            "[AutoApply] Found", options.length, "modal options but all were empty. Modal options HTML:",
            Array.from(options).map((o) => o.outerHTML.slice(0, 100)).join(" | ")
          );
        }
      }

      // Send / Next / Submit button inside modal
      // GUESSED SELECTORS: button[class*='send'], .sendMsg, button[type='submit'], button.blue-btn — unverified.
      const sendBtn = modal.querySelector(
        "button[class*='send'], .sendMsg, button[type='submit'], button.blue-btn"
      );
      if (sendBtn && !sendBtn.disabled) {
        if (U.isEffectivelyEmpty(sendBtn)) {
          console.warn("[AutoApply] Send button found but is empty/whitespace. Button HTML:", sendBtn.outerHTML);
        } else {
          if (!settings.autoSubmit) break;
          U.realClick(sendBtn);
          await U.humanDelay(800, 1500);
        }
      } else if (!sendBtn) {
        console.warn("[AutoApply] Could not find send/next button in modal. Looking for fallbacks...");
      }

      // Detect completion
      const successText = modal.innerText.toLowerCase();
      if (successText.includes("application") && successText.includes("sent")) {
        U.logApplication({
          platform: "Naukri",
          title: document.title,
          url: location.href,
          status: "applied",
          timestamp: Date.now(),
        });
        break;
      }
      if (!modal.isConnected) break; // modal closed
    }
  }
})();
