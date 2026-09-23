# Community item-bearing editjournal GET handoff

Checkpoint: `dedfa7bc0`. This is a source-only plan for a callable GET renderer.
It does not authorize route activation, POST handling, permission changes,
delete/spam-delete work, or legacy file removal.

## Retained contract

`htdocs/editjournal.bml:27-46` requires a logged-in remote, resolves
`authas = GET authas || remote` through `LJ::get_authas_user`, requires the
effective actor to be an individual, then resolves the journal with this exact
truthy precedence:

1. GET `usejournal`
2. POST `usejournal`
3. GET `journal`

For a GET-only helper that reduces to GET `usejournal || journal`. A journal
equal to the effective actor is collapsed to the personal context. A distinct
target must load and be a community (`htdocs/editjournal.bml:126-136`).
Do not replace truthy precedence with mere key existence: an empty
`usejournal` permits the `journal` alias to win.

The item-bearing branch treats the query item as a composite ditemid, resolves
it in the selected journal, requires visibility, then confirms the matching
protocol item/anum (`htdocs/editjournal.bml:142-177`). Use the already reviewed
strict native boundary: GET only, exactly one positive canonical `itemid`,
valid entry, exact `entry->ditemid`, visibility and editability. Other methods,
missing/malformed/repeated itemids, invalid authas, invalid/noncommunity targets
and entries outside the selected journal must return undef for retained BML.

There are two eligible community renderings:

* Same-poster community entry: the effective actor is the entry poster. Subject
  and body remain editable. If the actor or community is readonly, fall through
  to BML. If eligible and the remote is in `updatepage` beta, retained BML
  redirects to `/entry/<community>/<ditemid>/edit` and drops the old query
  (`htdocs/editjournal.bml:179-196`). Otherwise render the ordinary native
  edit form.
* Other-poster manager entry: retained BML disables ordinary save and exposes
  maintainer controls only when the actor can manage the community
  (`htdocs/editjournal.bml:179-188`). The integrated native path already
  renders `entry/maintainer.tt` for exactly this property-only case
  (`DW::Controller::Entry:1130-1165`). Beta does not redirect this branch
  because retained `disabled_save` is true. A readonly community must fall
  through: retained GET behavior and the native maintainer gate differ there.
  Do not include delete or spam-delete in this GET-only slice.

Current `get_authas_user` policy makes a distinct delegated individual actor
unreachable, but the wrapper should still resolve through that API and preserve
the selected actor rather than silently substituting the session remote.

## Smallest implementation slice

Extend the callable GET composition beside
`legacy_owned_edit_get_handler` rather than calling `_edit` directly. Direct
`_edit` uses the current request URI for form actions, which would point a
form back at `/editjournal`.

1. Resolve the effective actor and community using the retained GET truthy
   precedence above. Keep the existing personal helper responsible for collapsed
   self aliases.
2. Resolve one exact community entry and divide it by poster identity:
   same-poster ordinary edit, or authorized other-poster maintainer.
3. For same-poster rendering, reuse the existing native edit initialization and
   `_render_edit_form`, but supply an explicit action URL
   `/entry/<community>/<ditemid>/edit` with the original raw query preserved.
4. Extract the already integrated maintainer template call into a small render
   helper accepting an explicit action URL. Use the same canonical native path
   and raw query. Keep the existing direct native caller's default action.
5. Apply the retained beta redirect only to the writable same-poster branch.
   Return undef for readonly actor/community, denied manager, invalid context,
   and every non-GET request.

This keeps rendering shared while leaving all POST authorization and mutation
behavior on its existing paths.

## Finite acceptance

Use disposable real-session users, two communities, and fresh entry reads.

1. Both `/editjournal` aliases render a same-poster community entry through
   GET `usejournal` and GET `journal`; when both are nonempty,
   `usejournal` wins. Empty `usejournal` permits `journal` to win.
2. Compare the callable same-poster form with direct
   `/entry/<community>/<ditemid>/edit`: subject, body, a nondefault supported community security selection,
   tags, metadata, userpic, editor and date. Native `_init` offers community
   public/members/admin and builds custom groups only for noncommunities;
   prove custom-bit controls are absent rather than inventing a custom-group
   community fixture. Its action is the canonical native
   path and preserves exact encoded and repeated raw query components.
3. An authorized manager viewing another poster's entry gets the existing
   property-only maintainer form with selected override values, one translated
   heading, no editable subject/body controls, and a canonical native action
   preserving the raw query. A same-poster entry must never receive this form.
4. Same-poster beta GET returns exact 302 canonical Location with no old query.
   Other-poster manager GET remains a 200 maintainer form under beta.
5. Anonymous, invalid/distinct authas, invalid/noncommunity journal, journal
   collision, foreign item, malformed/repeated itemid, denied manager and all
   non-GET methods fall through before native rendering.
6. Actor-readonly same-poster, community-readonly same-poster, and
   community-readonly manager cases fall through to retained BML. Do not claim
   native maintainer readonly parity.
7. Force-fresh entries and log properties before/after all GETs prove no content,
   security, maintainer property or draft mutation. Follow denied/readonly/beta
   requests with each eligible rendering to prove no actor, journal, entry,
   action or beta state leaks across requests.

The parsed action can be checked without submitting it; POST save/delete and
maintainer mutation remain separate reviewed gates.

## Public activation boundary discovered during integration

The callable property-only manager renderer is accepted, but it is not a complete
replacement for the retained manager page. `t/plack-entry-picker.t` proves that
other-poster manager GET exposes both `action:delete` and `action:savemaintainer`.
The native `entry/maintainer.tt` has only property controls and save. Publicly
activating that renderer would remove a reachable legacy action. Do not weaken
that picker regression or treat property-only browser parity as full activation
acceptance.

The next public activation is limited to same-poster community entries. Keep
other-poster manager GET on BML until a separate action-surface compatibility
package is implemented and reviewed. Callable manager rendering and its browser
proof remain valid prerequisites; they do not authorize deletion or spam-delete
changes. Existing POST dispatch stays unchanged.
