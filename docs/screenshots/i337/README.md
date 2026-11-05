# i337 screenshots: Google Drive Sync at the top of Settings > Data

Before = base a25c408. After = branch style/i337-drive-sync-top (43b1407).
Fake data only (tests/harness.mjs seedFakeData). Chromium via Playwright, service worker blocked, Dexie served locally as in harness.mjs openApp.

| File | Size |
|---|---|
| before_pc-1366.png / after_pc-1366.png | work PC, 1366x768, deviceScaleFactor 1 |
| before_pc-1366-full.png / after_pc-1366-full.png | same, whole page |
| before_pc-1920.png / after_pc-1920.png | work PC, 1920x1080, deviceScaleFactor 1 |
| before_ipad-portrait.png / after_ipad-portrait.png | iPad (gen 7) device profile, 810x1080 |
| before_ipad-landscape.png / after_ipad-landscape.png | iPad (gen 7) device profile, 1080x810 |

Before: Data check is the first card, and Google Drive Sync is far down the page (below Import Contract Guide).
After: Google Drive Sync is the first card. Data check follows it, and the order of everything else is unchanged. Nothing overlaps at any size.

Note: at iPad portrait the left nav is an icon-only rail. The icons look blank only because the icon library is stubbed in the test harness. The base build looks the same.
