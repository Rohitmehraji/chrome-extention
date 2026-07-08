/**
 * naukri.js — content script for *.naukri.com
 *
 * Handles two situations:
 *  1. A single job page with an "Apply" button (opens a chatbot-style modal
 *     for some jobs, or applies instantly for others).
 *  2. A search-results page, where "Start Auto-Apply" walks through the
 *     visible job cards one at a time.
 *
 * Activated only when the user clicks the extension's popup button — it
 * does nothing on page load.
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
      const cards = Array.from(document.querySelectorAll(".jobTuple, .srp-jobtuple-wrapper"));
      for (const card of cards) {
        if (!running) break;
        const applyBtn = card.querySelector(
          "button.apply-btn, .apply-button, [class*='apply-btn']"
        );
        if (!applyBtn || /applied/i.test(applyBtn.innerText)) continue;

        U.realClick(applyBtn);
        await U.humanDelay(1200, 2200);
        await handlePossibleModal(profile, settings);
        await U.humanDelay(1500, 3000);
      }

      // Move to the next page of search results and keep going.
      const nextPageBtn = document.querySelector(
        "a.styles_btn-secondary__2AsIP, .pagination a[class*='next'], a[aria-label='Next']"
      );
      if (!running || !nextPageBtn || nextPageBtn.classList.contains("disabled")) break;
      U.realClick(nextPageBtn);
      const settled = await U.waitForElement(".jobTuple, .srp-jobtuple-wrapper", 6000);
      if (!settled) break;
      await U.humanDelay(1500, 2500);
    }
  }

  async function applyToSingleJob(profile, settings) {
    const applyBtn = document.querySelector(
      "#apply-button, .apply-button, button[class*='apply-btn']"
    );
    if (!applyBtn) {
      console.warn("[AutoApply] No Apply button found on this Naukri page.");
      return;
    }
    U.realClick(applyBtn);
    await U.humanDelay(1200, 2200);
    await handlePossibleModal(profile, settings);
  }

  /**
   * Naukri sometimes opens a "chat" style modal asking follow-up questions
   * (notice period, CTC, a couple of custom yes/no or dropdown questions)
   * before the application actually goes through. This walks through it.
   */
  async function handlePossibleModal(profile, settings) {
    const modal = await U.waitForElement(
      ".chatbot_DrawerContentWrapper, .apply-status-body, .naukri-chatbot",
      4000
    );
    if (!modal) return; // instant-apply, nothing more to do

    let steps = 0;
    while (running && steps < 15) {
      steps++;
      await U.humanDelay(600, 1200);

      // Text inputs inside the chat modal
      const textInput = modal.querySelector("input[type='text']:not([disabled]), textarea:not([disabled])");
      if (textInput && document.activeElement !== textInput) {
        const label = U.findLabelText(textInput) || textInput.placeholder || "";
        const value = U.matchProfileValue(label, profile) || profile.experienceYears || "";
        if (value) U.setNativeValue(textInput, value);
      }

      // Radio / chip style single-select options
      const options = modal.querySelectorAll("[class*='chatbot_ListItem'], .ssrc__jd-btn, li.suggestor");
      if (options.length) {
        // Best effort: pick the first option (usually "Yes" / most compatible answer)
        // unless auto-submit is off, in which case we stop and let the user finish.
        if (settings.autoSubmit) {
          U.realClick(options[0]);
        } else {
          break;
        }
      }

      // Send / Next / Submit button inside modal
      const sendBtn = modal.querySelector(
        "button[class*='send'], .sendMsg, button[type='submit'], button.blue-btn"
      );
      if (sendBtn && !sendBtn.disabled) {
        if (!settings.autoSubmit) break;
        U.realClick(sendBtn);
        await U.humanDelay(800, 1500);
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
