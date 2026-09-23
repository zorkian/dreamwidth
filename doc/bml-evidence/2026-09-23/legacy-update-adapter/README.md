# Retained update form and native retry

Captured in the foreman container from combined tree `75e674910` after rebuilding
static assets, using `t/browser/entry-legacy-update-adapter.js` and its disposable
account and isolated test-only server. No public route registration changed.

- `desktop-before-submit.png`: retained BML form at 1280px, before a real FCK
  submission. The old default userpic placeholder appears broken in this
  baseline; this capture does not claim to correct that retained-page behavior.
- `narrow-native-retry.png`: native correction form at 390px after the old form
  submitted an empty FCK body. It shows one visible protocol error, retained
  subject and an initialized native RTE. Controls fit the narrow viewport.

The runner then submitted the modern correction form and verified exactly one
additional entry with retained subject/body. Normal run passed with no JS or
network failures; disposable helper and server processes were absent afterward.
Logs: `/tmp/bml-update-adapter-build.log` and
`/tmp/bml-update-adapter-browser.log` in foreman container `8d7783a043d8`.
Independent Sol normal and named intentional-failure runs passed at source
`19224a89399dd1794fb33effa6546383154a4c50`. Foreman inspected both captures.
