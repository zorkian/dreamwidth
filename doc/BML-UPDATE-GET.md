# /update authenticated GET handoff

Scope: ordinary authenticated `GET /update` only.  Excludes `altlogin`,
`share` (which can fetch a remote page), transforms, POST/retry/preview,
and every route or beta change.  This is an audit; it makes no production
changes.

## Retained resolver order and gates

`htdocs/update.bml` first rejects an invalid nonempty `GET usejournal`, gets
`LJ::get_remote`, then redirects a non-POST beta user to `/entry/new` with
`keep_args`.  It rejects identity and cannot-post remotes before constructing
entry data.  `authas` is not a retained `/update` selector: ordinary GET uses
the session remote; `altlogin` is a separate login UI and must continue to
fall through.

For ordinary GET, retained `usejournal` is
`canonical_username($GET{usejournal})`; an empty value means the remote.
Native `new_handler` loads the route argument or GET value through `_init`.
A wrapper must preserve the retained invalid-usejournal response and
same-owner behavior before calling a renderer, rather than changing native
routing/authas semantics.

## Form-data mapping

| Retained `/update` GET | Native current path | Handoff requirement |
| --- | --- | --- |
| subject: `GET subject` | `_prepopulate->{subject}` | already compatible |
| event: `GET event` | `_prepopulate->{event}` | already compatible |
| tags: `GET prop_taglist` | `_prepopulate` reads `GET tags` | compatibility helper must prefer retained `prop_taglist`; this is not presently equivalent |
| date/time: timezone-adjusted `DateTime->now` | same timezone-aware calculation in `new_handler` | extract/reuse without changing client-side trust/default behavior |
| editor default: `new_entry_editor` / site `DEFAULT_EDITOR`, rich-text flag | `DW::Formats::select_items`, preferred `entry_editor2` | characterize conversion explicitly; do not silently select a different editor |
| `insobj`, legacy entry-form defaults/options | native `entry/form.tt` vars | inventory before cutover; no current GET adapter should claim parity |
| draft and draft_properties from remote | `_render_new_form` loads the same userprops and sets `init_draft` for non-POST | retain current native draft lifecycle, but browser acceptance must compare restore prompt/data values |

Both forms calculate crosspost defaults for a remote GET, but the renderer
inputs differ.  A GET adapter must use the existing `_init` account/journal
construction rather than recreate the list or scheduler state.

## Hook and external-boundary contract

After optional legacy share prefill, retained code calls:

```
LJ::Hooks::run_hook('update_fields', \%GET)
```

The hook receives the original flat GET hash reference and may override
`event`, `subject`, `tags`, and `prop_opt_preformatted`.  `new_handler` and
`_prepopulate` do not call this hook.  A future callable render seam must be
passed that original reference explicitly and invoke the hook once in this
position.  It must not synthesize a request from native formdata or alter the
hook ABI.  The hook result must be applied after normal subject/event/tag
prefill and before `DW::Formats` selects the editor.

`GET share` calls `DW::External::Page->new`; it is excluded from the first
callable package to avoid adding a remote-fetch path.  `altlogin` is likewise
excluded because its retained credentials and displayed controls are not the
session-remote form contract.

## Smallest safe callable package

Add a private/callable `legacy_update_get_render` in `DW::Controller::Entry`
that accepts an already-validated session remote, original GET hash reference,
resolved retained `usejournal`, retained prefill/hook result, and computed
legacy editor/default flags.  It should only construct the native `_init` /
`_render_new_form` variables and return the render status.  It must not
register `/update`, redirect beta users, authenticate, call `update_fields`,
fetch `share`, or write drafts/properties.

A later route wrapper owns, in retained order: invalid-usejournal response;
remote/identity/can-post gates; beta redirect; `altlogin`/share fallthrough;
retained prefill and `update_fields`; then this callable renderer.  Existing
`new_handler` remains unchanged for native defaults and routes.

## Finite acceptance before route registration

1. Disposable authenticated non-beta GET with distinct `subject`, `event`,
   and `prop_taglist`; parse native fields and verify exact values, date shape,
   selected editor, journal/default security, and no entry/draft mutation.
2. Same fixture with a local `update_fields` hook: assert original GET refaddr,
   one invocation, override order, and retained preformatted/editor effect.
3. Fresh saved draft/draft_properties: compare restore data and `init_draft`
   without clearing either property.
4. Valid/invalid `usejournal`, owner collapse, and `authas` query (ignored by
   retained update) preserve retained output/fallback; beta GET remains its
   existing redirect.
5. Explicit fallthrough characterization for `altlogin` and `share`, including
   proof that the first package performs no external page construction.
6. Browser desktop/390px normal GET with no JS/network errors; no POST or
   draft persistence.  POST, preview, spellcheck, transforms, and external
   delivery remain outside this package.
