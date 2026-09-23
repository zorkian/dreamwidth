# Same-poster community `editjournal` POST audit

Date: 2026-09-23
Scope: source-only handoff for the retained same-poster community **save/delete**
POST subset. It excludes other-poster maintainer actions, `deletespam`, public
route activation, and all authorization-policy changes.

## Retained request resolution

`htdocs/editjournal.bml:25-49, 115-196` resolves an item-bearing request as
follows:

1. The page requires a session remote. `mode` is GET first, then POST, but any
   GET or POST `itemid` forces edit mode.
2. Effective actor `u` is `GET{authas} || remote->user`, resolved through
   `LJ::get_authas_user`; it must be an individual. The session remote remains
   separately available for beta and crosspost decisions.
3. Community context is truthy `GET{usejournal} || POST{usejournal} ||
   GET{journal}`. A value equal to effective actor's username is collapsed to
   personal context. Nonempty context must load as a community.
4. Entry identity is truthy `GET{itemid} || POST{itemid}`. The hidden form
   value is a ditemid; retained code derives anum/itemid, loads from the
   effective community journal, requires visibility, then verifies returned
   anum exactly.
5. For a same-poster community entry, ordinary save is enabled. The existing
   beta redirect occurs before action handling when save is enabled. A readonly
   effective actor or community disables save. `submit_value` can synthesize a
   known action before spellcheck/action handling.

The retained action subset relevant here is `action:save` and `action:delete`
(including their recognized `submit_value` equivalents). `action:deletespam`,
`action:savemaintainer`, spellcheck, no/unknown actions, and non-item picker
POSTs are separate contracts and must remain BML fallthroughs initially.

## Retained mutation and identity contract

For both save and delete, BML first validates form auth, creates this seed, and
passes the original flat `%POST` to `LJ::entry_form_decode`:

```
mode => editevent, ver => $LJ::PROTOCOL_VER,
user => effective actor, usejournal => effective community,
itemid => journal itemid, xpost => '0'
```

`decode_entry_form` runs its hook on the original flat form hash and this
mutable request hash. For delete only, retained code then empties `event`, logs
`delete_entry` on the community, runs `spam_check(effective_actor, same_request,
'entry')`, and sends that same request to protocol. Therefore the observable
delete order is:

```
decode_entry_form -> delete log -> spam_check -> editevent/protocol
```

Save has the same decode and `spam_check` identity but no delete log and keeps
its decoded event. On protocol failure, BML returns its retained BML error
response rather than a native retry form.

## Comparison with accepted personal seam

`legacy_owned_edit_handler` (`DW::Controller::Entry:416-479`) deliberately
requires an individual authas account equal to session remote, collapses an
equal usejournal, and returns `undef` for every remaining journal context.
`legacy_owned_edit_post` (`:1467-1533`) then requires
`journal == remote && entry poster == remote`. It already supplies exactly the
right mechanics after resolution:

- `DW::Entry::Legacy::prepare_entry_form` retains the original flat decoder
  request plus canonical request;
- delete clears both before logging and spam check;
- `_do_edit` receives canonical data plus a `legacy_edit` response context;
- failure rerenders through `legacy_owned_edit_rerender`, preserving raw legacy
  date/form data and canonical native edit action.

A community extension must not weaken the personal defaults. The smallest
shared-helper adjustment is an explicit opt-in context (for example
`same_poster_community => 1`) which changes only the journal eligibility from
`journal->equals(remote)` to `journal->is_comm && entry->poster->equals(remote)`.
The default remains personal-only. A dedicated resolver supplies effective
actor as `remote` to the helper and session remote separately for response
compatibility.

## Canonical/native result contract

The eventual callable adapter should pass `_do_edit`:

- `auth => { poster => effective authas actor, journal => community }`;
- legacy seed above, with community `usejournal` and entry jitemid;
- raw preserved GET and POST to `_legacy_crosspost_master`/
  `_legacy_crosspost_callback`;
- `legacy_edit->{remote}` as the original session remote and `editurl` as
  `/editjournal?itemid=<ditemid>`;
- `entry_was_suspended` for existing edit warning behavior.

`_do_edit` retains native success rendering (`entry/success.tt`) and ordinary
edit persistence. For a community journal, `_queue_crosspost` does not schedule
because the journal is not the session remote; nevertheless the raw callback
contract should be passed unchanged, not reinterpreted. There is no
`_do_post` legacy-success housekeeping, post-attempt hook, or
`after_entry_post_extra_*` hook in this edit path. Delete still receives
`entry_deleted_page_extras` through the existing `legacy_edit` `_do_edit`
branch; ordinary successful save can receive the existing suspended-edit
warning. A migration must not add new-post housekeeping/hooks to edits just to
make a shared helper convenient.

## Smallest future implementation package

1. Add a callable **same-poster community** POST resolver after the current
   personal handler declines community context. Preserve itemid/authas/usejournal
   precedence above, beta-before-action behavior, retained readonly/fallback
   handling, exact-ID/visibility/poster checks, and form-auth/referer guards
   before `prepare_entry_form`.
2. Extend `legacy_owned_edit_post` only with an explicit community opt-in; keep
   personal default behavior byte-for-byte. Do not route manager, `deletespam`,
   spellcheck, preview, unknown/no action, or itemless picker traffic through
   it.
3. Keep public routing unchanged until actual retained-form tests prove both
   aliases. The current native same-poster GET is independent and already
   accepted.

## Finite real retained-form test matrix

- Disposable session/effective authas actor posts a same-poster community entry;
  parse actual `/editjournal` and `.bml` forms, submit visible save with distinct
  subject/body/tags/location/music/userpic/date/security values, and force-read
  exact persisted entry plus an unrelated community entry.
- Repeat real visible delete on an independent entry; force-read deletion and
  unrelated preservation. Stub scheduler/report transport; assert it is not
  called for community ordinary delete.
- Capture `decode_entry_form`, log, `spam_check`, and protocol calls. Assert
  the original flat POST reference/fields, the same decoded request reference
  at spam/protocol, exact community seed, and the save/delete ordering above.
- Assert returned success response has the community edited/deleted result,
  local `entry_deleted_page_extras` on delete, and no accidental new-post
  success hook/housekeeping invocation. For a forced protocol failure, retain
  BML error contract until a separately reviewed native retry package.
- Verify GET-itemid over hidden POST itemid, GET/POST/journal usejournal
  precedence, same-user collapse, effective `authas`, beta redirect, readonly,
  invalid/missing itemid, other-poster manager, `deletespam`, unknown/no action,
  invalid/missing CSRF and non-POST all remain retained fallthrough/no-mutation
  paths as appropriate.

## Non-goals

No manager deletion/reporting, spam reporting, maintainer-property actions,
public-route activation, BML deletion, external transport, deployment hook, or
authorization-policy work belongs in this package.

## Foreman implementation boundary

The first implementation is a callable-only explicit community opt-in to the
already-authorized shared edit helper, with no resolver or public route. After
a save attempt it must return the established native success or native retry
response. It must never fall through to BML after an attempted save, because
that could execute the request twice. Native retry is the deliberate migration
contract already accepted for personal edits; preserve community context and
raw invalid input through that same renderer. The earlier matrix suggestion to
retain BML error output after protocol failure does not apply to this package.

## Independent source handoff correction

Sol confirmed one identity distinction for the opt-in helper: the deletion log
records the original session remote, while spam_check and canonical edit use the
effective poster. Use the supplied session_remote for log_event when present,
with the existing remote fallback so personal defaults remain unchanged. Test
this as an explicit callable-context contract; do not invent a granted authas
policy fixture or broaden routing permissions to make that test possible.
