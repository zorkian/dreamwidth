# `/update` alternate-login GET rendering audit

Audit date: 2026-09-23. This is source-only preparation. It makes no route,
authentication, POST, external-page, deployment, or production changes.

Sources compared:

- `htdocs/update.bml:45-265, 280-295`
- `cgi-bin/DW/Controller/Entry.pm:901-1025, 1203-1295, 1380-1535`
- `views/entry/form.tt`, `views/entry/login.tt`, and `views/entry/module-journal.tt`
- `doc/BML-UPDATE-GET-REMAINING.md`, `doc/BML-ANONYMOUS-UPDATE-GET-RENDER.md`,
  and `doc/BML-ANONYMOUS-POST-SCHEMA.md`

## Retained ordering and boundary

`altlogin` is an authenticated display/authentication mode, not an early route
guard. Retained `/update` first returns the invalid-usejournal message, then
performs the beta redirect, then renders identity/cannot-post terminal output.
Only after those decisions does it build the form and inspect `altlogin`.
Readonly remains a form-with-warning case. `share` is deliberately a separate
prepopulate/fetch seam and must not be folded into this package.

The currently active native `legacy_update_get_handler` preserves those first
guards and deliberately returns `undef` when `altlogin` or `share` is present.
Any callable altlogin renderer must preserve that decline boundary until its
own public activation review.

## Retained form contract

For a logged-in remote and `GET altlogin=1`, retained code sets
`auth_as_remote` false unless the submitted POST user equals the remote user.
That only changes displayed authentication controls; the request's remote still
supplies account defaults, drafts, access lists, editor preference, and the
`update_fields` hook context.

- The normal remote identity block is hidden. The legacy alternate-login box is
  visible with field `user` (`#altlogin_username`) initialized from the
  *post-hook* `GET user`, and a deliberately blank `password`
  (`#altlogin_password`). The BML control escapes the visible user value.
- Its form is `id=updateForm`, posting to `update?altlogin=1`; it carries the
  retained entry schema, including `action:update`, `usejournal`, old editor
  fields, and `lj_form_auth`.
- `subject`, `event`, and `prop_taglist` are snapshotted before `update_fields`.
  The hook receives the same mutable flat GET hash once, after retained share
  prefill (which this package excludes). Hook-return keys override the snapshot
  by presence. Repeated GET values are already NUL-joined in the flat hash.
- Target resolution (`usejournal`) and visible `user` are read after the hook.
  A hook can therefore alter both. Existing remote editor behavior remains
  `remote->new_entry_editor`, with hook `prop_opt_preformatted` able to select
  raw formatting; remote defaults and draft values remain the authenticated
  values.
- A failed/empty password is POST-only retained behavior: `auth_missing` adds
  `.error.nopass` and later code calls `auth_okay`. It is explicitly outside a
  GET-only render seam.

## Native renderer comparison

`legacy_update_get_render` already correctly maps the retained field snapshot,
hook result, editor selection, post-hook target, datetime, raw action, and
native `/entry/form.tt` rendering. It can be reused without duplicating `_init`
or `_render_new_form`.

It does **not** itself preserve the legacy alternate-login surface:

| Retained altlogin form | Current native form |
| --- | --- |
| `user`, blank `password` | `username`, blank `password` in the one-time modal |
| `action:update` | `action:post` |
| `usejournal` | `post_as` / `postas_usejournal` in anonymous/other-poster UI |
| `update?altlogin=1` action | caller-selected action, normally `/entry/new` |
| visible legacy alternate-login box | normal remote journal controls plus login modal |

The native `_auth` reads `username`; the retained POST path reads `user` and
uses `auth_okay` before protocol seeding. Therefore action/schema parity cannot
be claimed by pointing an existing native form at `/update`, nor by exposing
the legacy form at `/entry/new`. The anonymous POST schema audit also confirms
that top-level `chal`/`response` are not established retained update
authentication inputs. This package must not create or imply challenge support.

## Smallest callable-only rendering slice

Add a private `legacy_update_altlogin_get_handler` (or equivalently narrowly
parameterize the shared compatibility renderer) only after review of this
handoff. It should:

1. Require an actual GET, an authenticated ordinary remote, and `altlogin`.
   Decline `share`, invalid target, beta, identity/cannot-post, readonly, and
   non-GET contexts before form initialization.
2. Convert GET to the retained flat/NUL-joined hash once. Snapshot
   subject/event/tag before a single `update_fields` call on that exact hash;
   take `user` and `usejournal` from the post-hook hash.
3. Reuse `legacy_update_get_render` for the entry state, remote editor/defaults,
   native title override `/update.bml.title2`, canonical action, and raw query.
4. Supply an explicit, **new narrow legacy-auth presentation option** to the
   shared TT form: visible escaped `user`, blank password, and an explicit
   caller action. Do not globally change the normal native login component.

The caller action and emitted credential/target field schema are an activation
gate, not a default. A test-only callable can render a specified action while
the public route continues to fall through. Public activation needs a separate
reviewed POST adapter or an explicitly accepted native POST schema; neither is
part of this rendering package.

## Finite callable render tests

Use real RequestWrapper/TT rendering and a disposable authenticated remote; do
not perform login, password submission, or any external fetch.

1. Parse the actual rendered legacy-auth controls: legacy title, visible
   escaped post-hook `user`, blank password, no accidental remote identity
   block, selected remote editor, canonical post-hook target, and explicit raw
   action/query. Record native field names if the template cannot represent the
   legacy names without a narrow presentation option; that is a failure to
   resolve before activation, not an assertion to weaken.
2. Prove `update_fields` runs once with the original flat reference and
   NUL-joined repeated values. Assert pre-hook subject/event/tag behavior,
   post-hook user/target behavior, and `exists`-based hook overrides.
3. Assert remote editor/preformatted behavior and visible target remain correct
   for a normal target and a hook-mutated target. Assert the password is blank
   even when GET supplies a password-like value.
4. Force-fresh entry count, draft body/properties, and relevant editor/user
   properties before and after each render; all must remain unchanged. Run two
   sequential requests with distinct data/hook values to prove no display or
   request-context leakage.
5. Assert each excluded context returns `undef` before hooks/form init:
   absent remote, no altlogin, share, readonly, identity, cannot-post, beta,
   invalid usejournal, and POST/HEAD. Retained BML/public fallback remains
   covered separately.

## Explicitly separate work

- Failed-password, empty-password, and successful alternate-login POST behavior
  remain in retained/authentication composition tests. This audit performs no
  authentication execution.
- Share factory/fetch behavior remains the independent accepted share callable
  seam (`d778...`/`dd049...`), not an altlogin dependency.
- Anonymous GET/POST schema and form-token behavior remain the documented
  anonymous compatibility gates.
- No deployment or public route activation follows from this handoff.
