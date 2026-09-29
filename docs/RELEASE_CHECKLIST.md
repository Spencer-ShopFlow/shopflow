# Weekly release checklist

About 20–30 minutes, once a week, **outside class time**. No releases 2–6 Nov (skills migration week), during the identity cutover, or 9–16 Apr (state testing).

**Test copy (staging):** https://spencer-shopflow.github.io/shopflow/. Fake students only. Never type your real webhook address, token or sync password into it, and never import a real backup.
**Live app:** https://spencerdjhs.github.io/shopflow/

## 1. Before you start (2 minutes)

- [ ] In GitHub, open **spencer-shopflow/shopflow → Pull requests**. Each pull request (PR) has a plain-English summary and an **Undo** line.
- [ ] Each PR shows a green check (the automatic smoke tests passed). If a PR has a red ✗, don't merge it; tell the reviewer.
- [ ] Merge the week's PRs into the test copy: open each one → **Merge pull request** → **Confirm**. Wait 2–3 minutes for the test site to update.

## 2. Check the test copy on the iPad (10 minutes)

Open the test copy in **Safari** on the iPad. Don't use the ShopFlow app icon; that's your live app. The first time, set any test PIN. If the test copy has no students, load the fake class: first download it once from GitHub (spencer-shopflow/shopflow → `tests` → `fixtures` → `fake-roster.json` → the download button), then in the test copy go to Settings → Data → **📤 Import JSON** → choose `fake-roster.json` → **Replace All**.

- [ ] The dashboard opens with no error message.
- [ ] **Students:** the list shows the fake students. Open one; their page shows *that* student.
- [ ] **Attendance:** mark one fake student absent, then Save. You get a success message (emails fail quietly on the test copy; that's expected).
- [ ] **Checkpoints:** mark one fake checkpoint complete for one fake team, then Save.
- [ ] **Activities:** open Fake Bridge Build; the tabs open.
- [ ] **Settings:** opens with no error.
- [ ] Anything the week's PRs say to look at (each PR lists it under "Check on the iPad").

If anything looks wrong, stop here. Nothing has reached your live app yet.

## 3. Send the week's changes to the live app (5 minutes)

- [ ] On **github.com/spencer-shopflow/shopflow**, click **Contribute → Open pull request**. This asks your original repo to take the test copy's changes.
- [ ] Check the page says **base repository: SpencerDJHS/shopflow, base: main ← head repository: spencer-shopflow/shopflow, compare: main**.
- [ ] Click **Create pull request**, then **Merge pull request → Confirm merge**.
- [ ] Wait 2–3 minutes, then **close and reopen** ShopFlow on the PC and in the iPad app icon. Tap "App updated — tap to reload" if it appears.
- [ ] On both devices, **Settings → Data check** shows **App version: esb-vNNN**, where NNN is the number in the release PR's description.
- [ ] If it still shows the old number after 10 minutes, GitHub didn't publish the release. On **github.com/SpencerDJHS/shopflow**, open `README.md` → the pencil (Edit) → add one empty line at the end → **Commit changes** to `main`. Wait 2–3 minutes and check again. (This happened on 29 Sep: GitHub started nothing at all for the Release 2 merge, not even the smoke tests, so it wasn't a Settings problem.)
- [ ] On both devices: press **Sync Now** and wait for success.

## Undo

If the live app misbehaves after a release: in **SpencerDJHS/shopflow → Pull requests → Closed**, open the release PR and click **Revert**, then **Merge**. The previous version is back within a few minutes. Then tell the reviewer.

## What the automatic checks do (for reference)

Every PR runs `tests/smoke.mjs` (the app opened in a headless browser with fake students; every outside call to Google is intercepted, so nothing real is contacted) and `tests/static-checks.mjs` (no button calls a function that doesn't exist; every app file is in the offline cache list).
