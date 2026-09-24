# Owned legacy edit wrapper handoff

Audit point: `da092e789`, limited to ordinary owned `action:save` and
`action:delete`.

The prepared canonical request can feed `DW::Entry::_save_editted_entry` with
the resolved composite `ditemid`. Subject/body, security/allowmask, protocol
date fields, and the normalized `props` hash already match the protocol input.
The wrapper must seed `itemid` from the resolved entry rather than trust a raw
submitted value. No additional metadata translation is needed.

Concrete legacy context still needed around `_do_edit`:

1. **Delete and spam-hook ordering.** For legacy delete, set the flat and
   canonical event to empty, log `delete_entry`, then invoke `spam_check` once
   with the original flat decoder request, and only then call `_do_edit`.
   Legacy save invokes the same flat-request hook immediately before
   `_do_edit`. Do not reuse the new-post post-attempt helper: editjournal runs
   this hook before the protocol edit attempt. This also preserves the legacy
   delete hook view of an empty event.

2. **Raw crosspost seam.** `_do_edit` needs opt-in legacy values equivalent to
   the new-post seam: the raw `POST || GET` master value, the existing raw
   account/credential callback, and the session remote used by the legacy
   own-journal eligibility check. Pass the legacy edit URL
   `/editjournal?itemid=<ditemid>` to crosspost error rendering. Native callers
   keep their canonical master, callback, actor, and native edit URL.

3. **Edit housekeeping.** Do not call `_legacy_success_housekeeping` and do not
   clear `entry_draft` or `draft_properties`, update `entry_editor`, or change
   `disable_auto_formatting`. Retained editjournal does none of those. Current
   `_do_edit` calls `_persist_props(..., 1)`, which is a no-op, so the native
   edit default already matches.

4. **Legacy-only success output.** On delete, preserve the existing
   `entry_deleted_page_extras` result after crosspost rows and before the
   success links. On a non-delete save of an already suspended entry, retain
   the localized `editjournal.bml` still-suspended notice. Do not enable the
   new-post `after_entry_post_extra_options` or
   `after_entry_post_extra_html` hooks for edits; retained editjournal does not
   call them.

5. **Native success remains the base.** `_do_edit` already supplies translated
   edited/deleted state, protocol warning text, crosspost rows, and meaningful
   view/edit/manage links. Keep those defaults and add only the opt-in legacy
   values above. The scheduler must receive the exact `deleted` flag and
   resolved composite `ditemid`.

Finite wrapper checks: ordinary save and delete; failed save produces no
crosspost or success extras; delete order is log, spam, save; raw GET-only
master and per-account credential fallbacks; scheduler actor/ditemid/deleted
arguments; no draft/preference writes; suspended-save notice; delete-extra
marker and crosspost rows visibly rendered; native `_do_edit` invokes none of
the legacy-only seams.
