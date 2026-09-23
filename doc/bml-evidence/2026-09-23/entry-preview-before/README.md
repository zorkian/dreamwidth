# Entry preview before migration

Captured in the foreman isolated container at local `5f6a1b12d`, using
`t/browser/entry-preview.js`. Production still uses the legacy BML preview.
The disposable authenticated fixture exercises real legacy and native popup
buttons, an empty legacy body and an invalid native date, without publishing.
Desktop and narrow screenshots accompany exact route/content/warning checks,
form action/target restoration, and native password-control restoration.

Foreman browser exit 0; log `/tmp/bml-entry-preview-before.log` on host.
Fresh entry count remained unchanged; no JavaScript or HTTP failures were
reported; anchored fixture-process check was empty after exit. Focused helper
formatting check passed. These are baseline captures, not native conversion
approval. Raw HTML containing disposable session context is not retained.
