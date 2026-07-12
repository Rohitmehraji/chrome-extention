/**
 * common-fill-utils.js
 * Shared helpers used by both naukri.js and workday.js.
 * Loaded first via manifest.json content_scripts.
 */

const AutoApplyUtils = (() => {

  /** Sleep helper */
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  /** Random delay so actions don't look perfectly robotic / trip rate limits */
  const humanDelay = (min = 400, max = 1100) =>
    wait(min + Math.random() * (max - min));

  /**
   * Set a value on a React/Angular controlled <input> or <textarea> so the
   * framework's internal state actually updates (plain .value= is ignored
   * by React because it patches the native setter).
   */
  function setNativeValue(element, value) {
    if (!element) return false;
    const proto = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    const nativeSetter = descriptor && descriptor.set;
    if (nativeSetter) {
      nativeSetter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  /**
   * Check if an element's innerText is effectively empty (only whitespace).
   * Prevents clicking on empty decorative elements.
   */
  function isEffectivelyEmpty(element) {
    if (!element) return true;
    return !element.innerText || element.innerText.trim() === "";
  }

  /** Click helper that fires a full mouse event sequence, closer to a real click */
  function realClick(element) {
    if (!element) return false;
    // Defensive: don't click empty elements
    if (isEffectivelyEmpty(element)) {
      console.warn("[AutoApply] Skipping click on empty element:", element);
      return false;
    }
    element.scrollIntoView({ block: "center", behavior: "instant" });
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  }

  /**
   * Try to find the human-readable label text associated with a form field.
   * Checks <label for=>, wrapping <label>, aria-label, aria-labelledby, and
   * finally nearby preceding text as a fallback (common in Workday's markup).
   */
  function findLabelText(field) {
    if (!field) return "";
    if (field.id) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
      if (forLabel) return forLabel.innerText.trim();
    }
    const wrappingLabel = field.closest("label");
    if (wrappingLabel) return wrappingLabel.innerText.trim();

    const ariaLabel = field.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();

    const labelledBy = field.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy.split(" ")
        .map((id) => document.getElementById(id)?.innerText?.trim())
        .filter(Boolean);
      if (parts.length) return parts.join(" ");
    }

    // Fallback: look up a few ancestor levels for the nearest preceding label-like text
    let node = field;
    for (let i = 0; i < 4 && node; i++) {
      node = node.parentElement;
      if (!node) break;
      const label = node.querySelector(":scope > label, :scope > [data-automation-id*='label' i]");
      if (label && label.innerText.trim()) return label.innerText.trim();
    }
    return field.getAttribute("placeholder") || field.name || "";
  }

  /**
   * Find a clickable element (button, link, etc.) by its visible text content.
   * Used as a fallback when class/id selectors miss.
   */
  function findByText(containerOrDoc, text, tagNames = ["button", "a", "div[role='button']", "li"]) {
    const container = containerOrDoc || document;
    const selector = tagNames.join(", ");
    const elements = Array.from(container.querySelectorAll(selector));
    const normalizedSearch = text.toLowerCase().trim();
    return elements.find((el) => 
      el.innerText && el.innerText.toLowerCase().includes(normalizedSearch)
    );
  }

  /**
   * Match a field's label text against the saved profile using simple
   * keyword rules. Returns a string value, or null if nothing matches.
   */
  function matchProfileValue(labelText, profile) {
    const label = labelText.toLowerCase();
    const rules = [
      [/first\s*name/, profile.firstName],
      [/last\s*name|surname/, profile.lastName],
      [/full\s*name|^name$/, profile.fullName],
      [/e-?mail/, profile.email],
      [/phone|mobile|contact\s*number/, profile.phone],
      [/current\s*(ctc|salary)/, profile.currentCTC],
      [/expected\s*(ctc|salary)/, profile.expectedCTC],
      [/notice\s*period/, profile.noticePeriod],
      [/(years|yrs)?\s*of\s*experience|experience\s*\(years\)|total\s*experience/, profile.experienceYears],
      [/current\s*(location|city)/, profile.currentLocation],
      [/preferred\s*location|relocat/, profile.preferredLocation],
      [/linkedin/, profile.linkedIn],
      [/portfolio|website|github/, profile.portfolio],
      [/skills/, profile.skills],
      [/degree|education|qualification/, profile.education],
      [/university|college|school/, profile.university],
      [/address/, profile.address],
      [/city/, profile.currentLocation],
      [/state/, profile.state],
      [/zip|postal/, profile.zip],
      [/country/, profile.country],
      [/work\s*authoriz|visa|sponsor/, profile.workAuthorization],
      [/cover\s*letter/, profile.coverLetter],
      [/gender/, profile.gender],
      [/veteran/, profile.veteranStatus],
      [/disab/, profile.disabilityStatus],
      [/race|ethnicity/, profile.raceEthnicity],
    ];
    for (const [pattern, value] of rules) {
      if (pattern.test(label) && value) return String(value);
    }
    return null;
  }

  /**
   * Convert a stored base64 resume into a File object and attach it to a
   * file input via DataTransfer, then fire the change event. This works
   * because we are constructing a synthetic File, not reading an arbitrary
   * path — browsers allow scripts to set .files this way.
   */
  function attachFileFromBase64(input, base64Data, filename, mimeType) {
    try {
      if (!input || !base64Data) return false;
      const byteChars = atob(base64Data.split(",").pop());
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const file = new File([byteArray], filename || "resume.pdf", { type: mimeType || "application/pdf" });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (e) {
      console.warn("[AutoApply] resume attach failed:", e);
      return false;
    }
  }

  /** Load the saved profile + settings from chrome.storage.local */
  function getProfile() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["profile", "settings"], (data) => {
        resolve({ profile: data.profile || {}, settings: data.settings || {} });
      });
    });
  }

  /** Append an entry to the applied-jobs log kept in chrome.storage.local */
  function logApplication(entry) {
    chrome.runtime.sendMessage({ type: "LOG_APPLICATION", entry });
  }

  /** Wait until a selector appears in the DOM, or time out */
  function waitForElement(selector, timeout = 8000) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }, timeout);
    });
  }

  return {
    wait, humanDelay, setNativeValue, realClick, findLabelText, findByText,
    matchProfileValue, attachFileFromBase64, getProfile, logApplication,
    waitForElement, isEffectivelyEmpty,
  };
})();
