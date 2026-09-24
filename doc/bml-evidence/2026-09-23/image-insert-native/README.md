# Native plain-editor image insertion

Captured 2026-09-23 by the actual `t/browser/entry-image-insert.js` run in the
foreman devcontainer, with the reviewed image range through
ba1991d4aa0b108ef6a378d6ea1d20fc9d419c49 integrated atop a49d080cf.

- `desktop.png`: 1280px viewport, image URL/description controls open.
- `narrow.png`: 390px viewport, the same controls visible within the viewport.

The disposable account was removed by the fixture. The run also exercised
new/owned-edit insertion, three plain editor modes, selection replacement,
escaping, URL/description Enter, Cancel/focus, RTE hiding, unchanged persisted
entry state, and zero JavaScript/resource failures. Log in foreman container:
`/tmp/bml-native-image-browser.log`. Foreman visually inspected both captures.

Legacy comparison is in `../image-insert-before`; that baseline explicitly
records the old popup's narrow clipping. This package does not remove the old
popup while legacy posting-page callers remain.
