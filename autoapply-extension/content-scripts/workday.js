/**
 * workday.js — content script for *.myworkdayjobs.com / *.workday.com
 *
 * Workday's "Apply" flow is a multi-page wizard: My Information, My
 * Experience, Application Questions, Voluntary Disclosures, Self Identify,
 * Review. Every employer's tenant customizes field labels, so this uses
 * label-text matching (see common-fill-utils.js) rather than fixed
 * selectors. On the Review page it stops unless auto-submit is on.
 */

(() => {
  const U = AutoApplyUtils;
  let running = false;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "START_WORKDAY_APPLY") {
      if (running) return;
      running = true;
      runWorkdayFlow().finally(() => (running = false));
    }
    if (msg.type === "STOP_AUTOAPPLY") {
      running = false;
    }
  });

  // Auto-start: begin as soon as the page settles, no click required.
  (async () => {
    const { settings } = await U.getProfile();
    if (settings.autoStart && !running) {
      await U.humanDelay(1200, 2200);
      running = true;
      runWorkdayFlow().finally(() => (running = false));
    }
  })();

  async function runWorkdayFlow() {
    const { profile, settings } = await U.getProfile();

    // Kick off from the job posting page if we're not already inside the wizard
    const startBtn = document.querySelector("[data-automation-id='adventureButton'], [data-automation-id='applyButton']");
    if (startBtn && !document.querySelector("[data-automation-id='pageFooterNextButton']")) {
      U.realClick(startBtn);
      await U.humanDelay(1500, 2500);
    }

    let page = 0;
    while (running && page < 12) {
      page++;
      await U.humanDelay(700, 1400);
      await fillCurrentPage(profile, settings);
      await U.humanDelay(500, 900);

      const isReview = !!document.querySelector(
        "[data-automation-id='reviewApplicationSection'], [data-automation-id='review-job-application']"
      );

      if (isReview) {
        if (settings.autoSubmit) {
          const submitBtn = await U.waitForElement("[data-automation-id='pageFooterNextButton'], button[data-automation-id='submit']", 5000);
          if (submitBtn) {
            U.realClick(submitBtn);
            await U.humanDelay(1500, 2500);
            U.logApplication({
              platform: "Workday",
              title: document.title,
              url: location.href,
              status: "applied",
              timestamp: Date.now(),
            });
          }
        }
        break;
      }

      const nextBtn = document.querySelector("[data-automation-id='pageFooterNextButton'], [data-automation-id='bottom-navigation-next-button']");
      if (!nextBtn || nextBtn.disabled) {
        console.warn("[AutoApply] Could not find an enabled Next button — stopping. Check required fields manually.");
        break;
      }
      U.realClick(nextBtn);

      const advanced = await waitForPageChange();
      if (!advanced) break;
    }
  }

  /** Fills every recognizable field on the currently visible wizard page */
  async function fillCurrentPage(profile, settings) {
    // Plain text / number / email inputs and textareas
    const textFields = document.querySelectorAll(
      "input[type='text']:not([disabled]), input[type='email']:not([disabled]), input[type='tel']:not([disabled]), input[type='number']:not([disabled]), textarea:not([disabled])"
    );
    for (const field of textFields) {
      if (field.value) continue; // don't overwrite anything already filled
      const label = U.findLabelText(field);
      const value = U.matchProfileValue(label, profile);
      if (value) {
        U.setNativeValue(field, value);
        await U.wait(120);
      }
    }

    // Workday's custom dropdown widgets: a button that opens a listbox
    const dropdowns = document.querySelectorAll("[data-automation-id='multiSelectContainer'], button[data-automation-id$='dropdown']");
    for (const dropdown of dropdowns) {
      const container = dropdown.closest("[data-automation-id*='formField']") || dropdown.parentElement;
      const label = container ? U.findLabelText(container) : "";
      const value = U.matchProfileValue(label, profile);
      if (!value) continue;

      U.realClick(dropdown);
      await U.humanDelay(300, 600);
      const listbox = await U.waitForElement("[role='listbox'], [data-automation-id='selectListMenu']", 1500);
      if (!listbox) continue;
      const options = Array.from(listbox.querySelectorAll("[role='option'], li"));
      const match = options.find((o) => o.innerText.trim().toLowerCase().includes(value.toLowerCase()));
      U.realClick(match || options[0]);
      await U.wait(200);
    }

    // Resume / file upload
    if (profile.resumeBase64) {
      const fileInput = document.querySelector("input[type='file']:not([data-autoapply-filled])");
      if (fileInput) {
        const ok = U.attachFileFromBase64(fileInput, profile.resumeBase64, profile.resumeFilename, profile.resumeMimeType);
        if (ok) fileInput.setAttribute("data-autoapply-filled", "1");
        await U.humanDelay(800, 1500);
      }
    }

    // Required agreement / consent checkboxes (e.g. "I agree to the terms")
    if (settings.autoSubmit) {
      const checkboxes = document.querySelectorAll("input[type='checkbox']:not(:checked):not([disabled])");
      for (const box of checkboxes) {
        const label = U.findLabelText(box).toLowerCase();
        if (/agree|consent|terms|acknowledge|certify/.test(label)) {
          U.realClick(box);
          await U.wait(150);
        }
      }
    }

    // Yes/No radio-button questions (voluntary disclosures, work auth, etc.)
    if (settings.autoSubmit) {
      const radioGroups = document.querySelectorAll("[data-automation-id='radioGroup'], fieldset");
      for (const group of radioGroups) {
        const checked = group.querySelector("input[type='radio']:checked");
        if (checked) continue;
        const label = U.findLabelText(group).toLowerCase();
        const radios = group.querySelectorAll("input[type='radio']");
        if (!radios.length) continue;

        // Default to "No" for sponsorship/visa questions, "Yes" for eligibility/legal-to-work questions
        const wantsNo = /sponsor|visa/.test(label);
        const target = Array.from(radios).find((r) => {
          const t = (U.findLabelText(r) || r.value || "").toLowerCase();
          return wantsNo ? t.includes("no") : t.includes("yes");
        });
        U.realClick(target || radios[0]);
        await U.wait(150);
      }
    }
  }

  /** Waits for Workday's page-transition spinner/content swap to settle */
  function waitForPageChange(timeout = 8000) {
    return new Promise((resolve) => {
      const start = document.querySelector("[data-automation-id='pageFooterNextButton']");
      const observer = new MutationObserver(() => {
        // crude heuristic: consider the page "changed" once the spinner disappears
        const spinner = document.querySelector("[data-automation-id='loadingSpinner']");
        if (!spinner) {
          observer.disconnect();
          resolve(true);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(true);
      }, timeout);
    });
  }
})();
