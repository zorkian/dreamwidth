# Alternate-login rerender browser checkpoint

- Branch: `bml-terra-altlogin-rerender-browser-20260923`
- Base HEAD: `ce4a7d63c57546e8c19e40a7430034e86f3d78f5`
- Dirty, uncommitted files:
  - `t/browser/update-altlogin-rerender-fixture.pl`
  - `t/browser/update-altlogin-rerender-server.pl`
  - `t/browser/update-altlogin-rerender.js`

## Current browser state

The browser harness is callable-only.  It logs in as disposable session A and
renders a test-only, already-prepared old-schema error for display user B via
`legacy_new_rerender`; it does not submit credentials, authenticate, save, or
activate a public route.

The restore-dialog path is now explicit: the fixture is seeded after login for
each viewport, the test installs the dialog listener before navigation, compares
fresh A/B draft/editor state while the retained dialog is open, then dismisses it.
Each fixture IPC read is preceded by a JSON command and raced with fixture
completion.  Fixture startup has an early-EOF mode.

The raw response retains `not-a-year-02-03`.  Native JS then performs its
established untrusted-timestamp initialization: the browser test asserts
`#js-trust-datetime` becomes `1` and the date equals page-local today.
This is not treated as a ce4 forwarding regression.

## Latest evidence

- Normal browser run passed: host log
  `/tmp/altlogin-rerender-browser12.log` (contains
  `PASS alternate-login rerender browser`).
- Captures inside devcontainer:
  `/tmp/update-altlogin-rerender-browser12/rerender-1280.png` and
  `/tmp/update-altlogin-rerender-browser12/rerender-390.png`.
- The normal run closed its owned fixture and Starman server.  At checkpoint,
  no `update-altlogin-rerender-fixture.pl` or
  `update-altlogin-rerender-server.pl` process was present and port 18156
  was not reported as owned/listening.

## Next step after explicit resume

Run only the remaining lifecycle checks before formatting/commit:

1. `UPDATE_ALTLOGIN_RERENDER_INTENTIONAL_FAIL=1` run: require exit 1,
   exact intentional marker, and no owned fixture/server afterward.
2. `UPDATE_ALTLOGIN_RERENDER_FIXTURE_EARLY_EOF=1` run: require prompt
   nonzero startup failure and no owned fixture/server afterward.
3. Run Node syntax, selected Perl tidy/compile checks, inspect the two captures,
   then commit this test-only browser package.

Do not change production code or public routing as part of this browser task.
