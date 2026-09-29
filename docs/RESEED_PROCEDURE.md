# Re-seeding the iPad from the PC (draft for November)

**Status:** draft from plan row 1-01 (rule O4: "Replace All safety and a written re-seed procedure before 5 Nov"). The November skills migration procedure (row 2-06, written by META from P16's design) is the one to follow on the day; it should adopt or replace these steps. P17's dry run (1-07) rehearses them on the spare PC.

**What "re-seed" means:** the iPad throws away its own copy and takes an exact copy of the PC's data, using **Replace All**. It's used when the PC has been changed in a way sync can't carry (the skills migration), so the two devices would otherwise disagree.

**Needs, before the day:**
- Row 1-04 (Data check) and row 1-02 (the export password typed twice), both live.
- About 20 minutes, outside class, with both devices in front of you.
- **Never** during class, and never on the home PC.

## Steps

1. **Sync off on both devices.** Settings → Data → **Google Drive Sync** → switch it to Off, on the PC and in the iPad **app icon**. (Nothing may sync while the two copies differ.)
2. **Both devices: Data check.** Settings → Data → **Copy counts**, and paste each into a note. These are the "before" counts.
3. **Undo file for the iPad.** In the iPad app icon: Settings → Data → **📥 Export JSON**, with a password you type twice. Save it to your **district** Google Drive, named like `ipad-before-reseed-YYYY-MM-DD.json`. This is the iPad's way back.
4. **Undo file for the PC.** The same on the PC: `pc-before-reseed-YYYY-MM-DD.json`, to your district Drive.
5. **Make the change on the PC** (on the day, that's the migration from 2-06). Then Settings → Data → **Copy counts** on the PC, and check them against the design's expected table.
6. **Export the PC again:** `pc-reseed-YYYY-MM-DD.json`, with a password you type twice, to your district Drive.
7. **On the iPad:** open the Drive app, download `pc-reseed-…json` into the Files app. Then in the ShopFlow **app icon**: Settings → Data → **📤 Import JSON** → choose that file → enter the password → **Replace All**.
   - The app first saves a snapshot, listed under Auto-Backups as "Before import (Replace All)".
   - If Replace All is greyed out, the preview says why (for example, a file with no students). Stop and don't force it.
8. **Both devices: Data check.** The iPad's counts should now equal the PC's (step 5), table by table, apart from `activityLog` (this device only).
9. **Webhook addresses:** the import restores the webhook addresses stored in the file. They're the same on both devices, so nothing changes. Check that Settings → Automations still shows them.
10. **Sync on:** the PC first, then the iPad app icon. Close and reopen both. Data check once more; the counts still match.

## If something goes wrong (undo)

- **On the iPad:** Settings → Data → Import JSON → `ipad-before-reseed-…json` → **Replace All** (sync off). Or restore the "Before import (Replace All)" snapshot from Auto-Backups.
- **On the PC:** the same, with `pc-before-reseed-…json`.
- With sync still off on both, compare Data check with the "before" counts from step 2. Only then turn sync back on.

## Safety rules

- The export files contain student data. They go to your **district** Drive only, never personal storage, email or chat. Delete the dated files once the migration is confirmed (about a week later).
- Never paste the export password, the webhook address or the token into chat.
- Replace All refuses a file that has no students, classes, activities, enrollments or settings table, or one that would empty students, classes or activities on this device.
