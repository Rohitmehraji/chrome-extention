/**
 * background.js — MV3 service worker.
 * Relays start/stop commands from the popup to the active tab's content
 * script, and appends applied-job entries to a persistent log.
 */

chrome.runtime.onInstalled.addListener(() => {
  // Auto-submit and auto-start are ON by default — fully hands-off:
  // landing on a matching page starts the apply flow with no click needed,
  // and it submits at the end without stopping for review.
  chrome.storage.local.get(["settings"], (data) => {
    const settings = data.settings || {};
    if (settings.autoSubmit === undefined) settings.autoSubmit = true;
    if (settings.autoStart === undefined) settings.autoStart = true;
    chrome.storage.local.set({ settings });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "LOG_APPLICATION") {
    chrome.storage.local.get(["appliedLog"], (data) => {
      const log = data.appliedLog || [];
      log.unshift(msg.entry);
      chrome.storage.local.set({ appliedLog: log.slice(0, 500) });
    });
  }
  return true;
});
