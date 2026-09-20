# panel sources

Build-time sources of the admin panel. `scripts/build-single-file.mjs` assembles
them into `src/ui/panel.html` on every build; that file is git-kept generated
output, so edit the sources here instead of editing it directly.

- `shell.html` — markup shell plus three inject markers: `<!--panel:head-js-->`,
  `<!--panel:css-->` and `<!--panel:js-->`.
- `head.js` — head bootstrap snippet (language, accent and theme before first paint).
- `app.css` — panel stylesheet.
- `dict.js`, `format-labels.js`, `lib.js`, `a11y.js`, `qr.js`, `states.js`,
  `home.js`, `warp.js`, `subs.js`, `share.js`, `chrome.js`, `settings.js`,
  `sections-registry.js`, `fields-render.js`, `cards.js`,
  `fields-validate.js`, `section-io.js`, `sections.js`, `actions.js` —
  main script, concatenated in exactly the `PANEL_JS_ORDER` of
  `scripts/build-single-file.mjs`:
  1. `dict.js` opens the IIFE scope and holds the en/fa dictionaries with the
     language and theme controllers.
  2. `format-labels.js` holds the client format registry (base64 + sing-box).
  3. `lib.js` holds the dom, api, toast, modal and confirm helpers.
  4. `a11y.js` holds the radiogroup controller, live region and id helper.
  5. `qr.js` holds the embedded QR encoder; `states.js` holds the
     loading/empty/error builders.
  6. `home.js` holds app state, routing and the home view.
  7. `warp.js` holds the WARP views.
  8. `subs.js` holds the subscriptions hub; `share.js` the share sheet.
  9. `chrome.js` holds the traffic chart, backup banner, shortcuts, undo/redo
     and global keys.
  10. `settings.js`, `sections-registry.js`, `fields-render.js`, `cards.js`,
      `fields-validate.js`, `section-io.js`, `sections.js` hold the settings
      registry, field renderers/cards/validation and section IO.
  11. `actions.js` holds the action dispatch table, event wiring and boot, and
      closes the IIFE scope.

Assembly is plain string splicing (no bundler, no new dependencies). The build
fails when a marker is missing, duplicated or left in the output, and runs
`node --check` over both script blocks. `src/ui/panel.html` is rewritten only
when bytes change, and line endings follow `shell.html`. Dictionaries stay with
the JS in `dict.js`; `login.html` and `camo.html` are untouched by this flow.
