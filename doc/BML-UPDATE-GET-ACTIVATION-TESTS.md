# `/update` public GET activation: retained-form fixture plan

Basis: foreman `009a844b8739c7e3e45150e624d44305e1907ca5`; cleared callable
renderer sequence `a3491e46d` through `ec6e084e5`; browser harness
`6e1a52ac1`/`b2c2da7cb`. This is an audit only. It does not register public
GET or modify production routing.

## What changes on activation

`DW::Routing` already registers `/update` for all methods and strips `.bml`.
The current handler is POST-only and returns `undef` for GET, so `app.psgi`
renders `htdocs/update.bml`. A public GET wrapper will instead render native
`#js-post-entry` for its narrow eligible session-owner case. It must still
return `undef` for `altlogin`, `share`, anonymous/identity/readonly/cannot-post,
invalid initial `usejournal`, and all unsupported methods, preserving BML; its
beta branch remains the old 302 `/entry/new` redirect with retained query
behavior.

## Affected retained-form consumers

| Consumer | Current form source | Minimal test-only change after GET activation |
| --- | --- | --- |
| `t/plack-entry-legacy-update.t` | Real public `/update` and `/update.bml` GET, parsed `#updateForm`, then real POST. | Fetch each form through scoped explicit BML GET; submit its generated token/parsed old fields to the unmodified public app after the scope ends. Keep both aliases and current hook/persistence assertions. |
| `t/plack-entry-legacy-update-adapter.t` | `$legacy_app` harvests old forms before exercising its callable POST adapter. | Scope explicit BML GET only around `$legacy_app` form harvest. The test-only adapter remains its existing callable test; do not treat it as proof of public GET. |
| `t/plack-entry-update-activation.t` | `get_form` harvests old owner/community/moderated/empty-body forms from the public app, then POSTs to production. | Make `get_form` use the scoped BML form-source helper. Keep `post_form` and `post_legacy_action` on the actual app. Its current `altlogin`, `share`, invalid-usejournal, and beta tests remain direct public requests, never overlay requests. |
| `t/plack-editor-spellcheck-baseline.t` | Gets old `/update.bml` controls and token for legacy spellcheck POSTs. | Use scoped BML GET solely for the update-form fetches; retain existing real POST and no-persistence checks. Leave its `/editjournal.bml` evidence alone. |
| `t/browser/entry-legacy-update-adapter-{server,js}` | Dedicated server currently forces `legacy_update_handler`, letting old GET fall through while POST is a copied route choice. | After app load, install the common method split in this owned process: retained BML for GET and the captured real `/update` handler for POST/other methods. Browser continues clicking actual retained controls/tokens and validates real production POST/retry. |

`legacy-update-get-render.t` and `legacy-update-get-handler.t` are callable
native-renderer coverage, not retained-old-form consumers; preserve them. The
root `t/browser/update-get.{fixture,server,js}` harness currently calls
`/__test_update_get`; it is the activation browser proof, not an old-form
fixture.

## Shared helper design

Reuse `t/lib/LJ/Test/LegacyOwnedEditRoute.pm`'s already generic
`retained_bml_get_route` behavior; it resolves `DW::Request->path` through
`DW::BML` and delegates non-GET to the captured routing handler. Its filename
is historical, but the function has no editjournal-specific behavior.

Prerequisite commit adds a small scoped API, conceptually:

```
with_retained_bml_get('app/update', sub { ...test_psgi form GET... })
```

It captures `$DW::Routing::string_choices{'app/update'}`, dynamically localizes
only that entry for the callback, explicitly calls BML for GET, and delegates
POST/HEAD/etc. to the captured production route. Add an assertion after every
scope that the original route reference is restored. Browser setup may assign
the same composed hash globally because it is an owned short-lived process;
its `finally` lifecycle already waits for the server to exit.

Do not freeze fields or CSRF values: all old-schema requests continue to come
from parsed `HTML::Form` controls on a live explicit-BML GET. Do not use the
helper in public native GET tests.

## Two reviewable commits

1. **Retained form-fixture prerequisite (test-only):** generalize the scoped
   helper and adapt the five consumers above. Add assertions that BML form
   generation happens only in the helper scope, the captured real route handles
   POST, each alias retains a generated `lj_form_auth`, and localization is
   restored. Run legacy update/adapter/activation/spellcheck HTTP tests and the
   legacy update browser normal plus named failure cleanup. No production files
   or actual public GET expectations change.

2. **Public GET activation (production + tests):** route eligible GET through
   `legacy_update_get_handler`, leaving the existing POST invocation unchanged.
   Convert `t/browser/update-get-server.pl` from `/__test_update_get` overlay to
   a plain `app.psgi` server and exercise `/update` and `/update.bml`. Add an
   actual real-session public GET test for native action/raw repeated query,
   subject/event/tag/editor/default security/draft nonmutation, and both
   spellings. In the same direct app, prove each excluded case remains BML:
   `altlogin`, `share` (no `DW::External::Page` construction), anonymous,
   readonly, invalid initial target, non-GET, and beta 302 with its retained
   query behavior. Keep scoped retained-form tests from commit 1 to prove old
   POST schema remains valid after public GET changes.

The activation commit must not remove `htdocs/update.bml`, alter alternate-login
or share policy, change deployment behavior, or widen route/authentication
semantics.
