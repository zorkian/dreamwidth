# PAUSED — alternate-login rerender browser acceptance

- Worktree: /home/mark/dreamwidth/.worktrees/bml-terra-widgets-20260922
- Container: 4da9c8ba2712 (mount: /workspaces/dreamwidth)
- Branch: bml-terra-altlogin-rerender-browser-20260923
- Full HEAD: ce4a7d63c57546e8c19e40a7430034e86f3d78f5

## Preserved WIP

Untracked, intentionally preserved:
- BML-ALTLOGIN-RERENDER-BROWSER-HANDOFF.md
- t/browser/update-altlogin-rerender-fixture.pl
- t/browser/update-altlogin-rerender-server.pl
- t/browser/update-altlogin-rerender.js

This is a callable-only browser harness for ce4 altlogin rerender seam. It uses disposable A/B users and a test-only endpoint; it does not activate a public route or submit credentials/save entries.

## Latest result and pending checks

Normal browser run passed: host log /tmp/altlogin-rerender-browser12.log, including PASS alternate-login rerender browser.

Captured inside the devcontainer:
- /tmp/update-altlogin-rerender-browser12/rerender-1280.png
- /tmp/update-altlogin-rerender-browser12/rerender-390.png

The harness now seeds A/B draft state after login, handles the retained restore confirm before navigation resolves, checks state while the dialog is open, and dismisses it before the next viewport. The server response has raw not-a-year-02-03; browser JS established untrusted timestamp initialization changes the DOM date to local today and #js-trust-datetime to 1, both explicitly asserted.

Remaining ONLY after explicit resume:
1. Intentional failure run (UPDATE_ALTLOGIN_RERENDER_INTENTIONAL_FAIL=1): require exit 1, exact marker, and owned cleanup.
2. Clean early-EOF run (UPDATE_ALTLOGIN_RERENDER_FIXTURE_EARLY_EOF=1): require prompt nonzero startup failure and owned cleanup.
3. Node syntax plus selected Perl tidy/compile, inspect captures, commit the test-only package.

## Process state at pause

No owned update-altlogin-rerender-fixture.pl or update-altlogin-rerender-server.pl process was present after normal run; owned port 18156 was not retained. No active browser/test helper from this harness is known to remain.
