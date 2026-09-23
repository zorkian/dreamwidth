# Legacy update/editjournal POST compatibility audit

Audit point: independent Sol source review at `f8bbe2413adb0d9f1f7a34d8075cddea24702c13`, after the finite legacy/new/edit/crosspost/moderation/delete/preview/draft/spellcheck characterizations. This is an implementation handoff, not route-retirement approval.

## Conclusion

Do not register `/update(.bml)` or item-bearing `/editjournal(.bml)` as direct aliases of `new_handler` or `edit_handler`. Add a small old-schema route adapter which performs old action dispatch and calls a shared native save/render pipeline after decoding the old schema. Keep ordinary owned edits separate from community maintainer property saves and spam-delete.

The direct-alias risk is concrete:

- Legacy edit mutates only for `action:save`, `action:delete`, or `action:deletespam` (`htdocs/editjournal.bml:237-270`). The native edit handler saves almost every valid non-preview, non-spellcheck POST (`cgi-bin/DW/Controller/Entry.pm:629-693`). A selector POST, old JavaScript helper POST, or unknown action could therefore become an edit if routed directly.
- Legacy forms use `LJ::entry_form_decode` (`cgi-bin/LJ/Web.pm:2142-2277`). Native forms use `DW::Entry::_form_to_backend` (`cgi-bin/DW/Entry.pm:154-329`). Their names and values differ for security, metadata, dates, editor modes, adult content, and crossposting.
- `submit_value` in legacy edit currently names an action dynamically (`htdocs/editjournal.bml:202-206`). The adapter should accept only the known action names rather than copying an arbitrary submitted key into the request.

## Smallest implementation package

### 1. Old-schema request decoder

Extract or wrap the existing `LJ::entry_form_decode` semantics in one helper that accepts `Hash::MultiValue` and returns the protocol-shaped canonical request used by `DW::Entry::_save_new_entry` and `_save_editted_entry`.

Use the existing decoder rather than translating old field names into modern form fields and then calling `_form_to_backend`. This preserves:

- `security=friends` to `usemask/1` and `custom_bit_1..60` bitmask construction;
- legacy date trust from `date_ymd_*`, `hour`, `min`, `date_diff`, `date_diff_nojs`, and old timestamp comparison;
- `event_format`, `switched_rte_on`, `prop_opt_preformatted`, and `prop_used_rte` body conversion;
- direct legacy comment properties and `comment_settings` precedence;
- mood-name-to-ID normalization;
- adult values `none`, `concepts`, and `explicit`;
- `prop_current_coords`, which the decoder still accepts even though no current rendered caller was found; and
- the `decode_entry_form` hook at `cgi-bin/LJ/Web.pm:2277`. No in-tree hook implementation was found, so this remains a deployment extension boundary and must not disappear silently.

Treat decoding as two explicit stages. First, let `LJ::entry_form_decode` produce its legacy protocol hash, including flat `prop_*` keys and any hook-added fields. Second, normalize the known flat properties into the native canonical `props` hash while retaining every non-property protocol field and every hook-added value. The final request passed to `_do_post` or `_do_edit` must contain `subject`, `event`, `security`, `allowmask`, protocol date fields, and `props` in the shape expected by `DW::Entry::_save_new_entry` and `_save_editted_entry`. Do not run `_form_to_backend` on the legacy submission because its modern defaults can clear or reinterpret legacy values.

### 2. Explicit legacy-to-native ancillary mapping

Map fields outside `entry_form_decode` deliberately:

| Legacy | Canonical/native save input |
| --- | --- |
| `prop_taglist` | taglist property |
| `prop_current_location`, `prop_current_music` | matching entry properties |
| `prop_current_moodid`, `prop_current_mood` | mood properties |
| `prop_picture_keyword` | picture keyword property |
| `prop_opt_backdated` | backdated property |
| `prop_adult_content` (`none/concepts/explicit`) | existing protocol property values; do not map through modern `none/discretion/restricted` twice |
| `security=friends` | `security=usemask`, `allowmask=1` |
| `security=custom`, `custom_bit_N` | `security=usemask`, constructed mask |
| `prop_xpost_check` | `crosspost_entry` |
| `prop_xpost_<id>` and password/chal/resp companions | canonical `crosspost->{id}` records consumed by `_queue_crosspost` |
| legacy `user` | native authentication username only for the retained alternate-login contract |
| `usejournal` | target journal after the same posting-access checks as the current route |

Preserve selected and unselected crosspost callback values. The rendered protocols are intentionally different; see `doc/BML-EDITOR-CROSSPOST-ACCEPTANCE.md`.

### 3. Shared action/save pipeline

Extract from the native controllers a callable pipeline after authentication, target resolution, CSRF validation, and schema decoding:

1. validate body/markup and readonly state;
2. run `spam_check` once;
3. call `_do_post` or `_do_edit` with canonical data;
4. keep draft/property persistence, crosspost scheduling, sticky handling, warnings, and native success rendering centralized.

The old-route adapter owns old action selection:

- `/update(.bml)`: `action:spellcheck` and `action:preview` are transforms; `showform`/authentication-recovery rerenders; otherwise a valid ordinary legacy POST posts, matching the current page. Do not require `action:update` because the retained handler does not use it as its sole save gate.
- item-bearing `/editjournal(.bml)`: only whitelisted `action:save`, `action:delete`, `action:deletespam`, `action:savemaintainer`, and `action:spellcheck` are recognized. The rendered legacy Preview control is a JavaScript button which posts to the separate preview endpoint; `editjournal.bml` has no `action:preview` dispatch. Unknown/no-action POST, including a direct `action:preview` POST, rerenders without mutation unless that behavior is separately characterized and deliberately changed.
- Convert `submit_value` only when its value exactly matches a whitelisted action.
- Ordinary owned `action:save` and `action:delete` may enter the shared native edit pipeline.
- Keep `action:savemaintainer` in the established property-only maintainer branch. It must never pass subject/body to ordinary edit logic.
- Keep `action:deletespam` separate until its poster/maintainer authorization, spam marking, deletion order, and success text are explicitly migrated. Do not collapse it into ordinary delete.

Spellcheck is already a non-persisting native transform. Preview already has a legacy schema wrapper and shared renderer. Reuse those boundaries instead of duplicating them.

### 4. Error rerendering

The save pipeline needs two representations:

- canonical backend data for validation/persistence; and
- modern form data for native error rendering.

Add a legacy-submission-to-modern-formdata mapper for rerenders. It must preserve the submitted subject/body, target journal, security/custom groups, metadata, userpic, editor mode, timestamp/backdating, comment options, adult fields, and crosspost selections/credentials. A failed old POST may render the modern form, but its form action must then accept the modern schema on the next submit. Do not point a modern form back at a legacy-only decoder.

Use native visible error markup and translations. Preserve old query context in the rendered action so `usejournal`, authentication context, and repeated/encoded arguments are not dropped.

## GET and route boundaries

- `/update` and `/update.bml` GET may canonicalize to `/entry/new` only under the existing beta/cutover condition, preserving encoded and repeated query arguments. Direct legacy POST remains handled until the compatibility adapter is installed and tested.
- `/editjournal` and `/editjournal.bml` without `itemid` remain the native picker.
- Item-bearing edit GET may canonicalize only after resolving the exact composite ditemid and journal context from `usejournal`, `journal`, or supported `authas`. Preserve remaining query arguments.
- The entry object and session determine the actor and poster. Do not trust hidden actor fields.
- Community other-poster maintainer forms remain property-only. This package does not broaden them into ordinary editing.

## Finite acceptance before old POST retirement

Extend existing disposable tests rather than create a new broad matrix.

1. **Both old aliases, new post:** submit actual rendered old forms with exact subject/body, tags, location, music, mood, userpic, all security families including a real custom group, comment settings, adult fields, timestamp/backdating, and each characterized editor mode. Force-fresh entry state must match.
2. **Both old aliases, owned edit:** no-op and changed save, then forced-fresh exact values and unrelated-entry preservation.
3. **Action dispatch:** no action, unknown action, and non-whitelisted `submit_value` do not mutate. Explicit save does; explicit delete follows the cleared delete contract. Maintainer and spam-delete remain on their separate branches.
4. **Transforms and failures:** preview and spellcheck never persist. Empty body, invalid date, invalid token, readonly journal, and denied target show one visible native error while retaining exact submitted controls and leaving fresh DB state unchanged.
5. **Target and authentication context:** owner, authorized community, moderated community, alternate login if retained, and denied journal. Preserve `usejournal`/`journal` query precedence and encoded/repeated query arguments.
6. **Crosspost:** selected/unselected account callback values, credentials, own-journal-only scheduling, translated results, and zero external transport, using the existing scheduler stub.
7. **Response contract:** success is native rendered HTTP 200 with meaningful view/edit/manage links and crosspost rows. Moderated success has no published entry and retains the established draft-state behavior until an explicit parity choice changes it.
8. **Sequential isolation:** legacy request followed by modern request and a no-request/backend call cannot inherit actor, target, form values, action, or query state.
9. **Extension boundary:** either run the deployment hook inventory and preserve `decode_entry_form`, or obtain explicit deployment disposition before removing it.

## Remaining finite blockers for route retirement

- Native plain-editor image insertion is independently clear and integrated at 59ebe781c, with actual browser insertion, keyboard handling, and disposable-fixture cleanup evidence. It no longer blocks route retirement.
- The external `decode_entry_form` hook has no in-tree implementation. Native preparation preserves its call and original flat request reference; retiring that extension interface itself remains outside this adapter work.
- `action:deletespam` needs its own bounded migration if the physical edit BML file is to be deleted.
- After implementation, repeat the existing legacy/new/edit/crosspost/moderation/delete/spellcheck suites plus one real browser submission through each old alias. No broader editor redesign is required.

## Success-render extension boundary follow-up

Foreman source audit after helper integration, 2026-09-23: the old successful
update response has two additional extension calls which a wrapper must retain.
Neither has an in-tree implementation under `cgi-bin` or
`ext/dw-nonfree/cgi-bin` at this checkpoint; absence is not permission to remove
its deployment interface.

- `after_entry_post_extra_options` runs only for an item-bearing success, after
  crosspost scheduling, with `user => $ju, itemlink => $itemlink`. The old code
  joins the first return element from every `run_hooks` result and appends the
  resulting HTML to the success link list.
- `after_entry_post_extra_html` runs after either success branch with
  `user => $ju, itemlink => $itemlink, request => \%req`. For moderated success
  the old local `$ju` and `$itemlink` are unset. The request is the old flat
  protocol-shaped request, not the normalized native `props` hash.

At the original audit, the native `_do_post`/`entry/success.tt` path had neither
call. The reviewed legacy-only implementation is now integrated (0c3bb1722):
ordinary and moderated real-template tests prove output and exact arguments. Keep
these compatibility invocations explicitly legacy-only and preserve their arguments,
ordering and request representation; do not add it to ordinary native requests
or replace its output with a renamed API. A fixture hook should prove ordinary
and moderated arguments and visible output without external code. This is a
wrapper implementation requirement, not an approval to change a deployment
hook or the separately pending Journal hook interfaces.

The retained update page invokes `spam_check` after its protocol post attempt
and before the two success-render hooks; the ordinary native handler invokes
its existing check before `_do_post`. Do not silently move the legacy call to
that native position as part of sharing code. The actual old-form test observes
an already-persisted entry during this hook and the same flat request reference
as decoding. Preserve each route's established timing and exactly-once call;
this observation does not propose changing the native path or hook policy.
