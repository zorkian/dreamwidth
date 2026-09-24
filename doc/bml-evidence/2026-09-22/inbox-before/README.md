# Inbox visual baseline

Captured at foreman `7f3ba1791`, before integration of bookmark, legacy bulk
CSRF and modern RPC view corrections. Both existing implementations are shown;
these images do not certify public cutover or behavioral parity.

The disposable fixture contains18 locally enqueued AddedToCircle items and one
bookmark, with no event delivery or seeded-account mutation. `bin/dev/screenshot`
captured all/bookmark views at1280px and the all view at390px for legacy
`/inbox/index.bml` and modern `/inbox/new`. The fixture process was held until
all six captures completed, then its stdin closed and successful exit awaited.
Scripts/log remain in the foreman container under `/tmp/bml-inbox-before*` and
`/tmp/bml-inbox-capture-fixture.pl`.

Visual inspection: legacy narrow output overflows and its header overlaps; the
existing modern Foundation view stacks navigation and actions. This capture
uses the screenshot helper, not the separate behavioral browser harness, and
does not claim console/network or mutation assertions. Matching post-correction
images and actual interaction tests remain required for each relevant package.
