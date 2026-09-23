# Legacy update success housekeeping for a canonical post pipeline

Scope: ordinary successful `/update` and `/update.bml` posts only. This note does not alter
authentication, routing, validation, spam hooks, deployment hooks, or response rendering.

## Observable legacy contract

After `LJ::do_request` succeeds, and before the moderated/nonmoderated result split,
`htdocs/update.bml` does all of the following:

1. Sets the authenticated poster's `disable_auto_formatting` preference from
   `event_format` (`1` when truthy, otherwise `0`).
2. Clears the session remote's `entry_draft`.
3. Preserves the session remote's `draft_properties`.
4. Sets the session remote's old `entry_editor` preference to `rich` when
   `switched_rte_on` is true and `plain` otherwise, unless its current value begins with
   `always_`.
5. Performs those changes for a successful moderated submission too, before recognizing
   the no-itemid/message result.
6. Schedules crossposts only for a nonmoderated own-journal result with an itemid. Its
   callback returns the original POST-or-GET value for each account, so an unselected
   account is `undef`, not numeric zero. Credentials use the same POST-or-GET fallback.

The legacy path does not write `displaydate_check`. It only reads `last_fm_user` while
prefilling the form and does not update it after a successful post. `newesteventtime` and
`dupsig_post` are protocol-layer effects and require no wrapper option.

The native `_do_post` currently calls `_persist_props`, which writes `displaydate_check`,
and clears both `entry_draft` and `draft_properties` before the same moderated split.
Its crosspost callback normalizes account selection to `1` or `0`.

## Smallest explicit compatibility surface

Keep canonical native defaults unchanged. Give the legacy wrapper these internal options:

1. `persist_displaydate => 0`
   - skips `_persist_props` for this legacy new-post request, leaving the existing
     `displaydate_check` value untouched.
2. `clear_draft_properties => 0`
   - still clears `entry_draft`, but preserves the frozen legacy draft metadata.
3. `legacy_preferences => { poster, remote, event_format, switched_rte_on }`
   - runs the two legacy preference writes after a successful save and before the
     moderated split. `poster` receives `disable_auto_formatting`; `remote` receives the
     conditional old `entry_editor` update and draft-body clear. Keeping both identities
     explicit matters for community posting.
4. `crosspost_callback => sub { ... }`
   - optional callback passed through to `_queue_crosspost`; the wrapper closure captures
     the original POST and GET hashes and retains raw selection plus credential fallback.
     The native canonical callback remains the default.

An internal named helper for item 3 is preferable to an unrestricted general callback.
These options should execute in this order after `_save_new_entry` succeeds: legacy/native
preference housekeeping, draft clearing, moderated-result check, then crossposting for an
item result. A failed save executes none of them.

## Finite tests for the wrapper package

1. **Ordinary success preference and draft parity**
   - Seed distinct `entry_draft`, frozen `draft_properties`, `displaydate_check`,
     `disable_auto_formatting`, `entry_editor`, and `last_fm_user` values.
   - Submit an actual rendered legacy form through the canonical pipeline.
   - Force-fresh reads must show: body draft cleared; frozen properties identical;
     display-date and last-FM sentinels unchanged; auto-format and old editor updated from
     the posted controls.
   - Cover both truthy and false controls, plus one `always_rich` or `always_plain` seed
     that remains unchanged. The two aliases can divide these cases without duplicating
     the matrix.

2. **Moderated success ordering**
   - Submit one actual legacy community form that produces a moderation result.
   - Assert exact moderation blob/message and no published entry; then force-fresh assert
     the same legacy housekeeping above: body cleared, properties retained, display-date
     and last-FM unchanged, auto-format/editor updated.
   - Seed enabled crossposting and assert the scheduler is not called without an itemid.

3. **Legacy crosspost callback identity**
   - Extend the existing actual-form crosspost characterization through the wrapper.
   - Assert the selected account's raw legacy value, the unselected account's `undef`,
     and exact `password`/challenge/response values. Include one absent-POST/query fallback
     case because the retained contract explicitly reads POST first and GET second.

Existing native tests should continue to prove the default path clears both draft stores,
writes `displaydate_check`, and returns normalized `1`/`0` crosspost selections.

## Deliberately outside this package

- authentication and route dispatch
- legacy success-page hooks and rendering
- spam-check ordering
- edit and delete housekeeping
- protocol-owned `newesteventtime` and `dupsig_post`

