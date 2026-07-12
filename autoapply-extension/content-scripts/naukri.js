/**
 * naukri.js — content script for *.naukri.com
 *
 * Handles two situations:
 *  1. A single job page with an "Apply" button
 *  2. A search-results page, where "Start Auto-Apply" walks through visible job cards
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

  (async () => {
    const { settings } = await U.getProfile();
    if (settings.autoStart && !running) {
      await U.humanDelay(1000, 2000);
      running = true;
      const mode =
        /\/job-listings|\/jobs/.test(location.href) &&
        !/jobdescription|jobid/.test(location.href)
          ? "list"
          : "single";
      runNaukriFlow(mode).finally(() => (running = false));
    }
  })();

  async function runNaukriFlow(mode) {
    const { profile, settings } = await U.getProfile();
    console.log("[AutoApply] Naukri flow started. Mode:", mode, "URL:", location.href);

    if (mode === "list") {
      await applyToSearchResults(profile, settings);
    } else {
      await applyToSingleJob(profile, settings);
    }
  }

  function normText(s) {
    return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function hasAppliedText(el) {
    const txt = normText(el?.innerText || el?.textContent || "");
    return /applied|already applied/.test(txt);
  }

  function isApplyLikeText(el) {
    const txt = normText(el?.innerText || el?.textContent || "");
    return (
      txt === "apply" ||
      txt === "easy apply" ||
      txt.includes("apply now") ||
      txt.includes("apply")
    );
  }

  function getAllClickableCandidates(root = document) {
    return Array.from(
      root.querySelectorAll(
        "button, a, span, div, [role='button'], input[type='button'], input[type='submit']"
      )
    ).filter(isVisible);
  }

  function findClickableApplyEl(root = document) {
    const candidates = getAllClickableCandidates(root);

    const exactTextMatch = candidates.find((el) => {
      const txt = normText(el.innerText || el.textContent || "");
      return txt === "apply" && !hasAppliedText(el);
    });
    if (exactTextMatch) {
      return exactTextMatch.closest("button, a, [role='button'], div, span") || exactTextMatch;
    }

    const partialTextMatch = candidates.find((el) => {
      const txt = normText(el.innerText || el.textContent || "");
      return txt.includes("apply") && !txt.includes("applied");
    });
    if (partialTextMatch) {
      return partialTextMatch.closest("button, a, [role='button'], div, span") || partialTextMatch;
    }

    const selectorFallback = root.querySelector(
      [
        "#apply-button",
        ".apply-button",
        "button[class*='apply']",
        "a[class*='apply']",
        "[role='button'][class*='apply']",
        "span.cs--1ebo7dz"
      ].join(", ")
    );

    if (selectorFallback && isVisible(selectorFallback) && !hasAppliedText(selectorFallback)) {
      return selectorFallback.closest("button, a, [role='button'], div, span") || selectorFallback;
    }

    return null;
  }

  function findSendNextSubmitBtn(root) {
    const candidates = getAllClickableCandidates(root);

    const byText = candidates.find((el) => {
      const txt = normText(el.innerText || el.textContent || "");
      return (
        txt === "next" ||
        txt === "send" ||
        txt === "submit" ||
        txt === "continue" ||
        txt === "done" ||
        txt.includes("submit application") ||
        txt.includes("continue")
      );
    });

    if (byText) return byText;

    return root.querySelector(
      [
        "button[type='submit']",
        "input[type='submit']",
        "button[class*='send']",
        "button[class*='next']",
        "button[class*='submit']",
        ".sendMsg",
        "button.blue-btn"
      ].join(", ")
    );
  }

  function findModalRoot() {
    const selectors = [
      "[role='dialog']",
      "[class*='modal']",
      "[class*='drawer']",
      "[class*='chatbot']",
      ".chatbot_DrawerContentWrapper",
      ".apply-status-body",
      ".naukri-chatbot"
    ];

    for (const sel of selectors) {
      const nodes = Array.from(document.querySelectorAll(sel)).filter(isVisible);
      if (nodes.length) {
        nodes.sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return br.width * br.height - ar.width * ar.height;
        });
        return nodes[0];
      }
    }

    return null;
  }

  function getJobCards() {
    const selectors = [
      ".jobTuple",
      ".srp-jobtuple-wrapper",
      "[class*='jobTuple']",
      "[class*='srp-jobtuple']",
      "article",
      "[data-job-id]"
    ];

    for (const sel of selectors) {
      const nodes = Array.from(document.querySelectorAll(sel)).filter(isVisible);
      if (nodes.length >= 1) return nodes;
    }

    return [];
  }

  async function applyToSearchResults(profile, settings) {
    let pageNum = 0;

    while (running && pageNum < 50) {
      pageNum++;
      console.log("[AutoApply] Processing search results page:", pageNum);

      const cards = getJobCards();

      if (!cards.length) {
        console.warn("[AutoApply] No job cards found.");
        console.log("[Diagnostic] URL:", location.href);
        console.log("[Diagnostic] Page HTML sample:", document.body.innerHTML.slice(0, 1000));
        break;
      }

      for (const card of cards) {
        if (!running) break;

        const applyBtn = findClickableApplyEl(card);

        if (!applyBtn) {
          console.warn("[AutoApply] No Apply button found in card.");
          console.log("[Diagnostic] Card HTML:", card.outerHTML.slice(0, 600));
          continue;
        }

        if (hasAppliedText(applyBtn)) continue;

        if (U.isEffectivelyEmpty(applyBtn)) {
          console.warn("[AutoApply] Apply button is empty/whitespace, skipping.");
          continue;
        }

        console.log("[AutoApply] Clicking card apply button:", applyBtn);
        U.realClick(applyBtn);
        await U.humanDelay(1200, 2200);

        await handlePossibleModal(profile, settings);
        await U.humanDelay(1500, 3000);
      }

      const nextPageBtn =
        getAllClickableCandidates(document).find((el) => {
          const txt = normText(el.innerText || el.textContent || "");
          return txt === "next" || txt.includes("next");
        }) ||
        document.querySelector(
          "a.styles_btn-secondary__2AsIP, .pagination a[class*='next'], a[aria-label='Next']"
        );

      if (!running || !nextPageBtn || nextPageBtn.classList?.contains("disabled")) {
        console.log("[AutoApply] No next page button found or pagination ended.");
        break;
      }

      if (U.isEffectivelyEmpty(nextPageBtn)) {
        console.warn("[AutoApply] Next page button is empty, stopping pagination.");
        break;
      }

      console.log("[AutoApply] Moving to next page.");
      U.realClick(nextPageBtn);

      await U.humanDelay(2500, 4000);
    }
  }

  async function applyToSingleJob(profile, settings) {
    const applyBtn = findClickableApplyEl(document);

    if (!applyBtn) {
      console.warn("[AutoApply] No Apply button found on this Naukri page.");
      console.log("[Diagnostic] URL:", location.href);
      console.log("[Diagnostic] Title:", document.title);
      console.log("[Diagnostic] HTML sample:", document.body.innerHTML.slice(0, 1000));
      return;
    }

    if (U.isEffectivelyEmpty(applyBtn)) {
      console.warn("[AutoApply] Apply button is empty/whitespace.");
      return;
    }

    console.log("[AutoApply] Found Apply element:", applyBtn);
    U.realClick(applyBtn);
    await U.humanDelay(1200, 2200);
    await handlePossibleModal(profile, settings);
  }

  async function handlePossibleModal(profile, settings) {
    await U.humanDelay(1000, 1800);

    const modal =
      findModalRoot() ||
      (await U.waitForElement(
        "[role='dialog'], [class*='modal'], [class*='drawer'], [class*='chatbot'], .chatbot_DrawerContentWrapper, .apply-status-body, .naukri-chatbot",
        5000
      ));

    if (!modal) {
      console.log("[AutoApply] No modal detected. Possibly instant apply or selector mismatch.");
      return;
    }

    console.log("[AutoApply] Modal detected:", modal);

    let steps = 0;
    let stallCount = 0;
    let prevModalInnerText = "";

    while (running && steps < 20) {
      steps++;
      await U.humanDelay(600, 1200);

      const currentText = modal.innerText || "";
      if (currentText === prevModalInnerText) {
        stallCount++;
      } else {
        stallCount = 0;
      }
      prevModalInnerText = currentText;

      if (stallCount >= 3) {
        console.warn("[AutoApply] Modal stalled. Dumping modal HTML:");
        console.log(modal.outerHTML);
        break;
      }

      const textInput = modal.querySelector(
        "input[type='text']:not([disabled]), input:not([type]):not([disabled]), input[type='number']:not([disabled]), textarea:not([disabled])"
      );

      if (textInput && document.activeElement !== textInput) {
        const label = U.findLabelText(textInput) || textInput.placeholder || "";
        const value = U.matchProfileValue(label, profile) || profile.experienceYears || "";

        if (value) {
          console.log("[AutoApply] Filling input. Label:", label, "Value:", value);
          U.setNativeValue(textInput, value);
          textInput.dispatchEvent(new Event("input", { bubbles: true }));
          textInput.dispatchEvent(new Event("change", { bubbles: true }));
          await U.humanDelay(200, 400);
        }
      }

      const options = Array.from(
        modal.querySelectorAll(
          "[class*='chatbot_ListItem'], .ssrc__jd-btn, li.suggestor, button, div[role='button'], label"
        )
      ).filter((el) => isVisible(el) && !U.isEffectivelyEmpty(el));

      if (options.length) {
        const preferredOption =
          options.find((opt) => /yes|immediate|fresher|hybrid|remote/i.test(opt.innerText || "")) ||
          options[0];

        if (preferredOption) {
          console.log("[AutoApply] Found modal option:", preferredOption.innerText?.trim());
          if (settings.autoSubmit) {
            U.realClick(preferredOption);
            await U.humanDelay(700, 1200);
          }
        }
      }

      const sendBtn = findSendNextSubmitBtn(modal);

      if (sendBtn && !sendBtn.disabled) {
        if (U.isEffectivelyEmpty(sendBtn)) {
          console.warn("[AutoApply] Send/Next button found but empty.");
          console.log(sendBtn.outerHTML);
        } else {
          console.log("[AutoApply] Found action button:", sendBtn.innerText || sendBtn.value);
          if (!settings.autoSubmit) break;
          U.realClick(sendBtn);
          await U.humanDelay(1000, 1800);
        }
      } else if (!sendBtn) {
        console.warn("[AutoApply] Could not find send/next/submit button in modal.");
      }

      const successText = (modal.innerText || "").toLowerCase();
      if (
        successText.includes("application sent") ||
        successText.includes("applied successfully") ||
        (successText.includes("application") && successText.includes("sent"))
      ) {
        U.logApplication({
          platform: "Naukri",
          title: document.title,
          url: location.href,
          status: "applied",
          timestamp: Date.now(),
        });
        console.log("[AutoApply] Application success detected.");
        break;
      }

      if (!modal.isConnected) {
        console.log("[AutoApply] Modal closed.");
        break;
      }
    }
  }
})();
