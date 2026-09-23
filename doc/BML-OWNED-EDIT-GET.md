# Ordinary owned editjournal GET handoff

Audit point: `028e5c666`, limited to item-bearing GET for an authenticated ordinary personal owner. POST, community, maintainer, spam-delete, and authorization-policy changes are excluded.

## Existing behavior

- `htdocs/editjournal.bml:30-46,142-177` selects edit mode when GET `itemid` is truthy, resolves GET before the hidden POST value, treats it as the composite `ditemid`, derives `jitemid` and `anum`, loads the entry in the selected journal, checks visibility, fetches exactly that protocol item, and verifies the returned `anum`.
- For this narrow personal-owner case, `authas` is absent or the remote username, `usejournal`/`journal` is absent or collapses to that same user, the entry poster is the remote user, and neither user nor journal is readonly. Every other context should return `undef` to the retained BML path.
- `htdocs/editjournal.bml:195-196` already redirects an eligible `updatepage` beta owner to `/entry/<owner>/<ditemid>/edit`. The current redirect drops the entire old query string. Preserve that exact beta branch until a deliberate query-policy change is approved.
- A nonbeta owner currently receives HTTP 200 and the old form. For an ordinary owner its action is `editjournal` with hidden composite `itemid`; arbitrary encoded/repeated GET parameters are not carried into that legacy form action.
- Native `DW::Controller::Entry::_edit` validates the exact composite identity again at `Entry.pm:938-947`, then initializes the established native form. Existing parity, mode, date, spellcheck, image, draft, delete, and browser suites already cover the editor state and controls; this package only needs to prove the old GET wrapper selects that renderer correctly.

## Smallest safe local wrapper

1. Extend the existing item-bearing `/editjournal` composition with a GET-only callable handler. Keep the POST handler unchanged.
2. Handle only one canonical, nonzero decimal GET `itemid`. Use `get_all('itemid')` to detect repeats. Missing, empty, zero, signed, mixed, NUL/repeated, or otherwise noncanonical values fall through to BML. This avoids changing legacy coercion behavior and avoids Hash::MultiValue last-value selection.
3. Reuse the current narrow dispatch gates: authenticated remote; `authas` absent/self; no remaining community target after same-user collapse; individual personal journal; exact valid entry; visible/editable; poster equals remote; not readonly. Return `undef` before native rendering for every excluded case.
4. Keep the current beta result as an exact 302 to `/entry/<owner>/<ditemid>/edit` with no query string.
5. For a nonbeta eligible owner, call a small initial native edit-form renderer using the already resolved entry, remote, and journal. Share the native `_init`, `_backend_to_form`, crosspost-selection, and `_render_edit_form` path rather than decoding legacy fields or duplicating the form.
6. Supply an explicit native action `/entry/<owner>/<ditemid>/edit`. Do not let `_render_edit_form` use `LJ::create_url(undef, keep_args => 1)`: under the old request URI that would submit native field names to `/editjournal`.
7. Preserve the raw query byte-for-byte on that explicit native action with `keep_query_string => 1`, including encoded separators and repeated values. This is limited to the native action context; it does not alter item resolution or the exact beta redirect. The redundant `itemid` is harmless because the canonical path owns entry resolution. If strict legacy query dropping is preferred instead, make that an explicit product choice and test it; do not accidentally flatten repeats through decoded hash arguments.

## Finite acceptance

- Both `/editjournal` and `/editjournal.bml` with one exact composite GET `itemid` render the native form for a nonbeta disposable owner; the entry body, subject, private/custom security, metadata, timestamp, userpic, and selected editor match a direct canonical native GET.
- Parsed form action is the canonical native edit path, never either legacy alias. Its raw query preserves an encoded value and two repeated values in order.
- GET performs no entry, property, draft, crosspost, or hook mutation.
- `updatepage` beta owner receives the existing exact 302 canonical redirect with no query.
- Missing/empty/zero/malformed/repeated `itemid`; distinct `authas`; community selectors; foreign poster; readonly owner; maintainer-only entry; and unsupported methods return through BML. These are boundary assertions, not new permission behavior.
- Sequential eligible A, excluded request, eligible B proves no resolved entry, journal, query, or form action leaks between requests.
- One parsed native action POST may be retained as a wiring check, but persistence and editor-state matrices should reuse the already reviewed canonical/native and legacy POST suites rather than be duplicated here.
