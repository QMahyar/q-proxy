# F5 — First-run wizard (in-depth)
Type: task (AFK) · Phase: Features · Order: 5

## Question
Complete wizard: post-setup 3 steps (protocols → first sub URL → done), skippable, resumable, client-side only, completion flag in settings, EN/FA copy.

## Answer

DONE (2026-08-25): client-side 3-step wizard modal on boot (skipped when localStorage qp_wizard_done set). Steps adapt: protocols off → step 1 link to Protocols; else step 2 copy first Base64 sub URL (reuses copy-field); step 3 done + WARP pointer. Finish/Skip sets the flag. Per-browser by design (no settings field).
