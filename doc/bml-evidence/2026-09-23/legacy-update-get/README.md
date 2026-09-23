# Callable update GET browser evidence

Captured in the foreman isolated devcontainer at 009a844b8 by the real
`t/browser/update-get.js` runner. This test-only route exercises the accepted
native GET wrapper; public `/update` GET activation remains separate.

- `update-get-1280.png`: desktop native form and populated rich editor.
- `update-get-390.png`: narrow native form with usable controls and editor.

Normal run exited 0 with PASS; log:
`/tmp/bml-update-get-browser-integrated.log` in container 8d7783a043d8.
Fixture/server process check was empty after completion. Independent Sol review
at b2c2da7cb also passed normal and named intentional-failure cleanup runs.
The harness proves exact prefills/action query and fresh draft preservation,
including the restore dialog after explicit fixture draft seeding.
