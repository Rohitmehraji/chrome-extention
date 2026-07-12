/**
 * workday.js — content script for *.myworkdayjobs.com / *.workday.com
 *
 * Workday's "Apply" flow is a multi-page wizard: My Information, My
 * Experience, Application Questions, Voluntary Disclosures, Self Identify,
 * Review. Every employer's tenant customizes field labels, so this uses
 * label-text matching (see common-fill-utils.js) rather than fixed
 * selectors. On the Review page it stops unless auto-submit is on.
 *
 * Now includes stall detection on dropdown selections to avoid infinite loops.
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
    // SELECTOR VERIFICATION: data-automation-id='adventureButton' and 'applyButton' are Workday-standard,
    // but tenant customization may vary. If not found, check DevTools for actual data-automation-id values.
    const startBtn = document.querySelector(
      "[data-automation-id='adventureButton'], [data-automation-id='applyButton']"
    );
    if (startBtn && !document.querySelector("[data-automation-id='pageFooterNextButton']")) {
      if (U.isEffectivelyEmpty(startBtn)) {
        console.warn("[AutoApply] Start button is empty/whitespace. HTML:", startBtn.outerHTML);
        return;
      }
      U.realClick(startBtn);
      await U.humanDelay(1500, 2500);
    }

    let page = 0;
    while (running && page < 12) {
      page++;
      await U.humanDelay(700, 1400);
      await fillCurrentPage(profile, settings);
      await U.humanDelay(500, 900);

      // SELECTOR VERIFICATION: 'reviewApplicationSection' and 'review-job-application' are guessed;
      // tenant may use different data-automation-id values.
      const isReview = !!document.querySelector(
        "[data-automation-id='reviewApplicationSection'], [data-automation-id='review-job-application']"
      );

      if (isReview) {
        if (settings.autoSubmit) {
          const submitBtn = await U.waitForElement(
            "[data-automation-id='pageFooterNextButton'], button[data-automation-id='submit']",
            5000
          );
          if (submitBtn && !U.isEffectivelyEmpty(submitBtn)) {
            U.realClick(submitBtn);
            await U.humanDelay(1500, 2500);
            U.logApplication({
              platform: "Workday",
              title: document.title,
              url: location.href,
              status: "applied",
              timestamp: Date.now(),
            });
          } else if (!submitBtn) {
            console.warn("[AutoApply] Submit button not found on review page.");
          }
        }
        break;
      }

      // SELECTOR VERIFICATION: 'pageFooterNextButton' and 'bottom-navigation-next-button' are standard,
      // but tenant customization may use different values.
      const nextBtn = document.querySelector(
        "[data-automation-id='pageFooterNextButton'], [data-automation-id='bottom-navigation-next-button']"
      );
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
    // SELECTOR VERIFICATION: 'multiSelectContainer' and dropdown attributes are standard but may vary by tenant.
    // Added stall detection: if we try to fill the same dropdown multiple times with no change, skip it.
    const dropdowns = document.querySelectorAll(
      "[data-automation-id='multiSelectContainer'], button[data-automation-id$='dropdown']"
    );
    
    for (const dropdown of dropdowns) {
      const container = dropdown.closest("[data-automation-id*='formField']") || dropdown.parentElement;
      const label = container ? U.findLabelText(container) : "";
      const value = U.matchProfileValue(label, profile);
      if (!value) continue;

      let attemptCount = 0;
      let stallCount = 0;
      let prevListboxState = "";

      // Stall detection: if listbox state doesn't change after clicking, retry up to 2 more times then skip
      while (attemptCount < 3 && running) {
        attemptCount++;

        if (!U.realClick(dropdown)) {
          console.warn("[AutoApply] Could not click dropdown:", dropdown.outerHTML.slice(0, 200));
          break;
        }

        await U.humanDelay(300, 600);
        const listbox = await U.waitForElement("[role='listbox'], [data-automation-id='selectListMenu']", 1500);
        
        if (!listbox) {
          console.warn("[AutoApply] Listbox did not open after dropdown click. Dropdown HTML:", dropdown.outerHTML.slice(0, 200));
          break;
        }

        // Stall check: if listbox HTML didn't change, increment stall counter
        const currentListboxState = listbox.innerHTML;
        if (currentListboxState === prevListboxState) {
          stallCount++;
        } else {
          stallCount = 0;
        }
        prevListboxState = currentListboxState;

        if (stallCount >= 2) {
          console.warn(
            "[AutoApply] Dropdown listbox stalled (no change after click). Value:", value, "Listbox HTML:",
            listbox.outerHTML.slice(0, 500)
          );
          break;
        }

        // SELECTOR VERIFICATION: [role='option'] and li are common but Workday may use custom selectors.
        const options = Array.from(listbox.querySelectorAll("[role='option'], li"));
        if (!options.length) {
          console.warn(
            "[AutoApply] No options found in listbox. Looking for alternative selectors. Listbox HTML:",
            listbox.outerHTML.slice(0, 300)
          );
          break;
        }

        // Find the option matching the profile value; filter out empty options
        const validOptions = options.filter((o) => !U.isEffectivelyEmpty(o));
        const match = validOptions.find((o) => 
          o.innerText.trim().toLowerCase().includes(value.toLowerCase())
        );
        
        if (match) {
          U.realClick(match);
          await U.wait(200);
          break; // successfully selected
        } else {
          // No exact match; try the first valid option as fallback
          if (validOptions.length) {
            console.warn(
              "[AutoApply] No exact match for value '", value, "' in dropdown options. Using first option as fallback."
            );
            U.realClick(validOptions[0]);
            await U.wait(200);
            break;
          } else {
            console.warn(
              "[AutoApply] All options in listbox are empty. Listbox HTML:",
              listbox.outerHTML.slice(0, 300)
            );
            break;
          }
        }
      }
    }

    // Resume / file upload
    if (profile.resumeBase64) {
      const fileInput = document.querySelector("input[type='file']:not([data-autoapply-filled])");
      if (fileInput) {
        const ok = U.attachFileFromBase64(
          fileInput,
          profile.resumeBase64,
          profile.resumeFilename,
          profile.resumeMimeType
        );
        if (ok) fileInput.setAttribute("data-autoapply-filled", "1");
        await U.humanDelay(800, 1500);
      }
    }

    // Required agreement / consent checkboxes (e.g. "I agree to the terms")
    if (settings.autoSubmit) {
      const checkboxes = document.querySelectorAll(
        "input[type='checkbox']:not(:checked):not([disabled])"
      );
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
      // SELECTOR VERIFICATION: 'radioGroup' is standard, but fieldset fallback may catch unintended groups.
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
        if (target) {
          U.realClick(target);
        } else if (radios.length) {
          U.realClick(radios[0]);
        }
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
