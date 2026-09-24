# Owned-entry delete confirmation

Foreman integrated branch `440faea99`, source `53dd7cccd`, independently
cleared by Sol. Real disposable browser run exited0 with no JavaScript/network
failures and no surviving fixture helper. The confirmation is translated;
dismissing it sends no POST and preserves both owned entries. Screenshots show
the edit form at desktop1280 and narrow390; the native confirmation dialog
itself is asserted by the browser rather than captured. No separate visual
design audit is claimed. Host log: `/tmp/bml-entry-delete-browser.log`.

The related actual rendered-form HTTP delete plus edit suites pass51 assertions
in container `/tmp/bml-entry-delete-integrated.log`, proving selected deletion
and exact unrelated-entry preservation through fresh reads.
