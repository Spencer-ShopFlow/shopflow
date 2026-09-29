# ShopFlow tests

Fake data only. Nothing here contacts Google: every `script.google.com` call is intercepted in the browser by a stub (`WebhookStub` in `harness.mjs`). The app's Content Security Policy only allows that host, so the stub works at the network layer, not as a local server.

| Command | What it does |
|---|---|
| `node tests/smoke.mjs` | Opens the app in headless Chromium with a fresh database and fake students, and runs the smoke tests. Add a word to run only matching tests, e.g. `node tests/smoke.mjs sync`. |
| `node tests/static-checks.mjs` | No-browser checks: every called method exists; every app file is in the service worker's offline cache list. |
| `node tests/eslint-check.mjs` | ESLint with the app's globals declared: fails on any undefined name in `js/`, `index.html`'s inline script or any inline `onclick`-style handler. Unused variables are listed with `--verbose` but don't fail. |
| `node tests/make-fake-roster.mjs` | Rebuilds `tests/fixtures/fake-roster.json` (20 invented students) for the staging site. |

**Setup:** `cd tests && npm install && npx playwright install chromium`.

**Offline sandboxes:** if unpkg.com isn't reachable, set `DEXIE_LOCAL` to a local Dexie 4.x `dist/dexie.js` and `CHROMIUM_PATH` if needed. CI uses the real unpkg Dexie 4.0.8.

Tests run automatically on every pull request (`.github/workflows/smoke.yml`).
