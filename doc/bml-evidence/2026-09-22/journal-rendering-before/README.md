# Journal rendering baseline

Ordinary authenticated recent/read/archive/month/day/entry views were captured
with the disposable existing entry-picker fixture after initializing its style
through customization. All six returned200, with no recorded pageerror or
requestfailed events. Results include actual final URLs and visible body excerpts.
The recent image was visually inspected: Ciel/Indil and the control strip render
with the six fixture entries and their existing metadata.

Capture ran while the foreman advanced from `cc6e1cf8f` to `2e57379dc`; the
prospective LJ::S2.pm request-note rendering changes are not present in either
revision. This is a baseline for those forthcoming changes, not exact-head
acceptance for the concurrent core consumer integration.

Scripts/log: `/tmp/bml-journal-baseline.js` and `.log` in foreman container
8d7783a043d8. Browser and helper exit were awaited in nested cleanup. The fixture
posts only to disposable local accounts; no delivery workers or external
services are invoked by this capture. No anonymous/access-policy/conditional
response acceptance is claimed by these screenshots.
