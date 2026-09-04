# panel sources

Build-time sources of the admin panel. `scripts/build-single-file.mjs` assembles
them into `src/ui/panel.html` on every build; that file is git-kept generated
output, so edit the sources here instead of editing it directly.

- `shell.html` — markup shell plus three inject markers: `<!--panel:head-js-->`,
  `<!--panel:css-->` and `<!--panel:js-->`.
- `head.js` — head bootstrap snippet (language, accent and theme before first paint).
- `app.css` — panel stylesheet.
- `dict.js`, `lib.js`, `qr.js`, `home.js`, `warp.js`, `users.js`, `chrome.js`,
  `settings.js`, `actions.js` — main script, concatenated in exactly this order:
  1. `dict.js` opens the IIFE scope and holds the en/fa dictionaries with the
     language and theme controllers.
  2. `lib.js` holds the dom, api, toast, modal and confirm helpers.
  3. `qr.js` holds the embedded QR encoder.
  4. `home.js` holds app state, routing and the home view.
  5. `warp.js` holds the WARP views.
  6. `users.js` holds the user rows, bulk bar and token-rotation wiring.
  7. `chrome.js` holds the traffic chart, backup banner, shortcuts, undo/redo
     and global keys.
  8. `settings.js` holds the user modal, settings registry, field renderers,
     TOTP card and section IO with validation.
  9. `actions.js` holds the action dispatch table, event wiring and boot, and
     closes the IIFE scope.

Assembly is plain string splicing (no bundler, no new dependencies). The build
fails when a marker is missing, duplicated or left in the output, and runs
`node --check` over both script blocks. `src/ui/panel.html` is rewritten only
when bytes change, and line endings follow `shell.html`. Dictionaries stay with
the JS in `dict.js`; `login.html` and `camo.html` are untouched by this flow.
