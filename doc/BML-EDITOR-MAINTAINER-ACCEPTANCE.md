# Community maintainer editor parity

Disposition: preserve the legacy itemid editor until the existing modern editor
supports its maintainer actions. Do not port a second full entry editor or
remove the poster check without adding bounded authorization and action handling.

## Reproduced baseline

At foreman `be776188a` (production picker `e83cddf0e`), a disposable HTTP probe
extends the picker fixture with the same authenticated manager and other-poster
community entry. `/editjournal.bml?usejournal=COMM&itemid=ID` renders
`action:savemaintainer` and `action:delete`. `/entry/COMM/ID/edit` instead returns
HTTP200 containing `IS AN ADMIN`, without the maintainer control. A forced fresh
entry read proves the original body remains unchanged. The probe passes133
assertions, including the existing127 picker assertions and six comparisons.
Host script: `/tmp/bml-editor-manager-probe.pl`; container log:
`/tmp/bml-editor-manager-probe.log` in `8d7783a043d8`.

## Authorization and mutation boundary

- `LJ::Entry::editable_by` first requires visibility; it allows the poster or a
  manager of a different journal. This does not authorize editing another
  poster's subject/body. Protocol `editevent` rejects such content changes while
  permitting manager deletion. Preserve that distinction explicitly.
- Legacy other-poster mode disables ordinary save, offers deletion, and enables
  maintainer controls when the journal is manageable and not spam-report banned.
  It saves only `adult_content_maintainer_reason`, `adult_content_maintainer`,
  and `opt_nocomments_maintainer`, guarded by form authentication.
- Legacy spam deletion has a distinct confirmation and report action. Its
  system-ban guard must remain effective. Do not silently map it to ordinary
  save or delete; characterize local reporting and cleanup before testing.
- Modern `_edit` currently processes POST before its later entry visibility,
  exact-ID and poster checks. A new maintainer path must validate actor, entry,
  itemid/anum, journal, permitted action and CSRF before mutation. Keep backend
  authorization as defense in depth; avoid logging a successful delete before
  authorization or a failed backend operation.
- Read-only journal/actor handling, private/admin-visible entries, anonymous and
  unrelated actors, own-post editing, and forged content edits require distinct
  tests. Do not infer write permission solely from seeing a form.

## Next bounded implementation package

Characterize actual legacy rendered maintainer save/delete controls with fresh
DB reads, then add the corresponding restricted modern form/actions. Verify
normal and invalid/missing-token requests, unauthorized actors, exact unchanged
subject/body for property-only updates, independent entries for deletion, and
preserved unrelated properties. Use disposable fixtures and local reporting
stubs where necessary; no external deliveries. Capture old and new desktop and
narrow form states and actual translated confirmation/error text.

Keep `/editjournal` itemid fallthrough and all legacy editor pages during this
package. Broader posting, preview, saved drafts, crossposting and rollout remain
separate acceptance gates in BML-REMOVAL-PLAN.md.
