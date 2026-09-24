# Native journal rendering replay

Captured at foreman `0bceb2942` after restarting its isolated Starman server.
The disposable entry-picker fixture supplies six dated entries and is kept alive
until browser completion; the helper exits successfully in finally.

Recent, reading, archive, month, day and entry views each assert HTTP 200,
no page errors and no failed resource requests. `results.json` records these
checks. Screenshots use 1280x900 viewport and full-page capture. Recent was
visually inspected against the earlier Ciel/Indil baseline. Account names and
render timestamps differ because both runs use disposable fixtures.

This closes the ordinary six-view replay for the S2 request-note conversion;
it does not approve removal of explicit journal adapters or BML language setup.
Runner and log: `/tmp/bml-journal-native.js` and `.log` in foreman container.

The first 500 captured body characters match the before capture for all six
views after normalizing disposable usernames. This is a bounded text comparison,
not a whole-document or pixel-equivalence assertion.
