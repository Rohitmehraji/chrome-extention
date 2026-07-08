# AutoApply — Naukri & Workday (Chrome extension)

Fills your saved profile into job applications on Naukri and Workday, and
optionally submits them for you.

## Install (unpacked, for personal use)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** → select this folder
4. Pin the extension icon so it's easy to click

## Setup

1. Click the icon → **Profile** tab
2. Fill in your details, upload your resume PDF, hit **Save profile**
3. Go to **Run** tab and decide on **Auto-submit**:
   - **Off** (default, recommended): fills every field, stops at the
     Review/confirmation step so you check it before submitting.
   - **On**: fills and submits without stopping. Use this once you've
     watched it run a few times and trust the field-matching.

## Using it

- **Naukri**: open a job listing (single apply) or a search-results page
  (auto-apply loops through the visible cards). Click the extension icon
  → **Start Auto-Apply**.
- **Workday**: open the job posting or an in-progress application. Click
  **Start Auto-Apply** — it walks through My Information → Experience →
  Questions → Voluntary Disclosures → Review, filling each page as it goes.
- **Stop** at any time from the popup.
- **Log** tab shows everything it has submitted (only populated when
  Auto-submit is on, since that's the only time an application actually
  goes through).

## How field-matching works

There's no per-company config. Each field's on-page label is read and
matched against your profile with keyword rules (e.g. anything containing
"notice period" → your `noticePeriod` value). This works well for common
fields but Workday tenants customize their forms heavily, so some
company-specific questions (short-answer "why do you want this role"
type prompts, work-experience history tables) won't be filled — the
script skips what it doesn't recognize rather than guessing.

## Things worth knowing before you turn Auto-submit on

- **You're responsible for what gets submitted.** Test with Auto-submit
  off first and read through a couple of filled forms to make sure the
  matching is doing what you expect, especially CTC/notice-period fields.
- **Rate limits / detection.** The scripts add randomized delays between
  actions to avoid looking like a bot, but mass-applying is still visible
  to the platform. Naukri and Workday-hosted employers can flag or
  restrict accounts that apply unusually fast or to a very high volume of
  roles. Use sensible batch sizes.
- **Terms of service.** Automating applications may be against Naukri's
  or an individual employer's terms of use. This tool automates actions
  on your own logged-in account, the same as you clicking through
  manually — it doesn't bypass logins, CAPTCHAs, or access anything you
  couldn't already see — but the account-level risk is still yours to
  weigh.
- **Voluntary disclosure / EEO questions on Workday** (gender, veteran
  status, disability, race) are only filled if you've put a value in
  those profile fields yourself — the extension never guesses or invents
  an answer for these, since they're legally sensitive.

## File map

```
manifest.json                      MV3 config, permissions, content-script registration
background.js                      Stores the applied-jobs log
popup/popup.html|css|js            Profile form, run/stop controls, log viewer
content-scripts/common-fill-utils.js  Shared DOM helpers (label matching, native input setter, file attach)
content-scripts/naukri.js          Naukri Easy-Apply modal + search-results loop
content-scripts/workday.js         Workday multi-step wizard walker
```
