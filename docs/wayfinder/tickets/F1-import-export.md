# F1 — Import/Export settings (in-depth)
Type: task (AFK) · Phase: Features · Order: 1

## Question
Complete import/export: what it should have, what it must NOT have, QoL. Research angles → implement → test → docs.

Scope skeleton: export JSON file + share link (base64, secrets stripped: passwordHash/passwordSalt/sessionSecret), import via file/paste/remote URL, field-level validation on import, conflict handling.

## Answer

DONE (2026-08-25): GET pi/settings/export (attachment JSON, kind:'q-proxy-settings', strips passwordHash/Salt/sessionSecret/securePath), POST pi/settings/import (version guard, identity+paths preserved, deep-merge over DEFAULTS, full validation, returns imported view). UI: General → Backup & restore card (export download + file-pick import w/ kind check + inline field errors). Share-link variant intentionally skipped (URL length limits; file+p paste covers the need).
