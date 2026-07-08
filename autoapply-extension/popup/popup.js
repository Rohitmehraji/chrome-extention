const PROFILE_FIELDS = [
  "firstName", "lastName", "fullName", "email", "phone",
  "experienceYears", "noticePeriod", "currentCTC", "expectedCTC",
  "currentLocation", "preferredLocation", "skills", "education",
  "university", "linkedIn", "portfolio", "workAuthorization",
];

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// ---------- Site detection ----------
let activeSite = null; // 'naukri' | 'workday' | null
let activeTabId = null;

async function detectSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;
  activeTabId = tab.id;
  const url = tab.url;
  const badge = document.getElementById("siteBadge");
  const runBtn = document.getElementById("runBtn");
  const hint = document.getElementById("runHint");

  if (/naukri\.com/.test(url)) {
    activeSite = "naukri";
    badge.textContent = "naukri detected";
    badge.className = "badge badge-on";
    runBtn.disabled = false;
    hint.textContent = /\/job-listings|\/jobs/.test(url) && !/jobdescription|jobid/.test(url)
      ? "Search results page — will step through visible job cards."
      : "Job page detected — will apply to this listing.";
  } else if (/myworkdayjobs\.com|workday\.com|myworkday\.com/.test(url)) {
    activeSite = "workday";
    badge.textContent = "workday detected";
    badge.className = "badge badge-on";
    runBtn.disabled = false;
    hint.textContent = "Workday application detected — will fill each step and stop at Review unless auto-submit is on.";
  } else {
    activeSite = null;
    badge.textContent = "no supported site";
    badge.className = "badge badge-off";
    runBtn.disabled = true;
    hint.textContent = "Open a Naukri job/search page or a Workday application page, then hit run.";
  }
}
detectSite();

// ---------- Run / Stop ----------
document.getElementById("runBtn").addEventListener("click", async () => {
  if (!activeSite || !activeTabId) return;
  document.getElementById("runBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;

  if (activeSite === "naukri") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const mode = /\/job-listings|\/jobs/.test(tab.url) && !/jobdescription|jobid/.test(tab.url) ? "list" : "single";
    chrome.tabs.sendMessage(activeTabId, { type: "START_NAUKRI_APPLY", mode });
  } else if (activeSite === "workday") {
    chrome.tabs.sendMessage(activeTabId, { type: "START_WORKDAY_APPLY" });
  }
});

document.getElementById("stopBtn").addEventListener("click", () => {
  if (!activeTabId) return;
  chrome.tabs.sendMessage(activeTabId, { type: "STOP_AUTOAPPLY" });
  document.getElementById("runBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true;
});

// ---------- Auto-start / Auto-submit toggles (both default ON) ----------
const autoStartToggle = document.getElementById("autoStartToggle");
const autoSubmitToggle = document.getElementById("autoSubmitToggle");

chrome.storage.local.get(["settings"], (data) => {
  const settings = data.settings || {};
  autoStartToggle.checked = settings.autoStart !== false;
  autoSubmitToggle.checked = settings.autoSubmit !== false;
});

autoStartToggle.addEventListener("change", () => {
  chrome.storage.local.get(["settings"], (data) => {
    const settings = data.settings || {};
    settings.autoStart = autoStartToggle.checked;
    chrome.storage.local.set({ settings });
  });
});

autoSubmitToggle.addEventListener("change", () => {
  chrome.storage.local.get(["settings"], (data) => {
    const settings = data.settings || {};
    settings.autoSubmit = autoSubmitToggle.checked;
    chrome.storage.local.set({ settings });
  });
});

// ---------- Profile form ----------
const profileForm = document.getElementById("profileForm");

chrome.storage.local.get(["profile"], (data) => {
  const profile = data.profile || {};
  PROFILE_FIELDS.forEach((field) => {
    const el = profileForm.elements[field];
    if (el && profile[field]) el.value = profile[field];
  });
  if (profile.resumeFilename) {
    document.getElementById("resumeFileName").textContent = profile.resumeFilename;
  }
});

let pendingResume = null;
document.getElementById("resumeInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingResume = {
      base64: reader.result,
      filename: file.name,
      mimeType: file.type || "application/pdf",
    };
    document.getElementById("resumeFileName").textContent = file.name;
  };
  reader.readAsDataURL(file);
});

profileForm.addEventListener("submit", (e) => {
  e.preventDefault();
  chrome.storage.local.get(["profile"], (data) => {
    const profile = data.profile || {};
    PROFILE_FIELDS.forEach((field) => {
      profile[field] = profileForm.elements[field].value.trim();
    });
    if (pendingResume) {
      profile.resumeBase64 = pendingResume.base64;
      profile.resumeFilename = pendingResume.filename;
      profile.resumeMimeType = pendingResume.mimeType;
    }
    chrome.storage.local.set({ profile }, () => {
      const status = document.getElementById("saveStatus");
      status.textContent = "Saved.";
      setTimeout(() => (status.textContent = ""), 1800);
    });
  });
});

// ---------- Log ----------
function renderLog() {
  chrome.storage.local.get(["appliedLog"], (data) => {
    const log = data.appliedLog || [];
    document.getElementById("logCount").textContent = `${log.length} application${log.length === 1 ? "" : "s"} logged`;
    const list = document.getElementById("logList");
    list.innerHTML = "";
    if (!log.length) {
      list.innerHTML = `<li class="log-empty">Nothing applied yet.</li>`;
      return;
    }
    for (const entry of log) {
      const li = document.createElement("li");
      const date = new Date(entry.timestamp).toLocaleString();
      li.innerHTML = `
        <div class="log-title">${escapeHtml(entry.title || "Untitled")}</div>
        <div class="log-meta">${entry.platform} · ${date}</div>
      `;
      list.appendChild(li);
    }
  });
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
document.getElementById("clearLogBtn").addEventListener("click", () => {
  chrome.storage.local.set({ appliedLog: [] }, renderLog);
});
renderLog();
