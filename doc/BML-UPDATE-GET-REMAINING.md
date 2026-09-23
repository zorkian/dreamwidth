# Remaining `/update` GET rendering split

Audit base: immutable review checkout `727cee24e0c20b102f66f298f83c31744ee441a4`, with the reviewed eligible GET wrapper inspected through corrected tip `d77e85b206ea5822a499f5575d6ead03d8c4b9ee`. This is a source-only handoff. It excludes alternate-login authentication, `share` fetching, POST actions, inbox work, and deployment hooks.

## Retained order

`htdocs/update.bml:45-70` establishes the order that a route wrapper must retain:

1. A nonempty missing `GET usejournal` returns `/update.bml.error.invalidusejournal` before remote lookup.
2. An authenticated beta user receives the retained 302 to `/entry/new`, with the existing decoded-query behavior, before identity or posting-capability checks.
3. An identity remote gets a terminal HTTP 200 page at the requested `/update` or `/update.bml` URL. Its title is the general `Sorry` key and its only message is `/update.bml.error.nonusercantpost` with `sitename`.
4. A remote without `can_post` gets a terminal HTTP 200 page at the requested URL. Its title is `/update.bml.error.cantpost.title`; its message is configured `$LJ::MSG_NO_POST` when nonempty, otherwise `/update.bml.error.cantpost`.
5. Anonymous and readonly requests continue into form construction. `update_fields` runs at `htdocs/update.bml:108-116` before the readonly warning is emitted.

The eligible native wrapper at corrected tip `d77e85b20:703-770` already preserves items 1 and 2 and deliberately returns `undef` for items 3-5. Do not move identity/can-post checks after `altlogin`/`share`; retained code rejects those remotes first.

## Remaining render contracts

### Identity and cannot-post: terminal pages

These branches do not initialize entry state, call `update_fields`, enumerate external accounts, load drafts, or render a form. They do not redirect and leave the address and query on either legacy alias. Native `new_handler` has the same message keys at `cgi-bin/DW/Controller/Entry.pm:125-132`, but `error_ml` always uses the generic `error` page title and drops the configured `$LJ::MSG_NO_POST` override. Calling it directly would therefore lose retained title and configured-message behavior.

### Readonly authenticated user: full warning form

Readonly is independent of `can_post`. On an ordinary GET, retained code builds the normal authenticated form, runs `update_fields`, applies legacy editor/prefill/default logic, and then prepends one warning (`htdocs/update.bml:244-263`). The warning is `/update.bml.rowarn`, with an anchor to `$LJ::HELPURL{readonly}` when configured and empty `a_open`/`a_close` otherwise. The old form posts to extensionless `update`, and its switch-user link is `/update?altlogin=1`.

The shared native form can display a `DW::FormErrors` warning at `views/entry/form.tt:128-131`, and the accepted legacy GET renderer already accepts a warnings object. A future readonly package can therefore reuse the authenticated renderer after the normal prefill/hook/default calculation. It must add the full absolute legacy warning key or the configured rendered string and preserve the optional help link. It must not return before `update_fields`, silently omit the warning, mutate drafts/preferences, or activate alternate-login authentication. If its native form action becomes `/entry/new`, acceptance must explicitly establish that this deliberate canonical action replaces the old relative `update` action while the response URL itself remains the requested alias.

### Ordinary anonymous display: credential-bearing form

With no remote, retained GET does not redirect to login. It renders the full update form and exposes `user` and `password` fields (`htdocs/update.bml:118-185`), using `$LJ::DEFAULT_EDITOR` for the rich/plain default (`htdocs/update.bml:199-216`). It still invokes `update_fields`, accepts `subject`, `event`, `prop_taglist`, `usejournal`, and `user` prefill, and has no user draft state. Its form action is extensionless `update` (or `update?altlogin=1` for the separately excluded query mode).

The native form has a one-time login component, but its schema is `username`/`password` and its submit is `action:post` (`views/entry/login.tt:18-41`, `views/entry/form.tt:389-405`). Rendering that form with action `/update` would not match the retained POST schema; changing the action to `/entry/new` would switch to native one-time authentication. Because authentication implementation is excluded from this slice, ordinary anonymous GET must remain BML fallthrough for now. It should be migrated together with the explicitly reviewed anonymous/alternate-login POST decision, not hidden inside a render-only change.

## Smallest safe callable package

Implement only a private terminal-response renderer for the identity and cannot-post branches. The callable should accept an already-classified variant and render a native page with explicit title and message; it must not inspect the request, authenticate, redirect, call hooks, initialize an entry form, or register a route.

Inputs and output:

- `identity`: title `LJ::Lang::ml('Sorry')`; message `LJ::Lang::ml('/update.bml.error.nonusercantpost', { sitename => $LJ::SITENAME })`.
- `cantpost`: title `LJ::Lang::ml('/update.bml.error.cantpost.title')`; message `$LJ::MSG_NO_POST || LJ::Lang::ml('/update.bml.error.cantpost')`.
- Return the normal native render status while the public wrapper keeps HTTP 200 and the current `/update` or `/update.bml` URL.

A dedicated small template is safer than calling current `error_ml`, because `views/error.tt` hardcodes the generic error title. Broadening the global error template merely for these two legacy titles adds unrelated surface.

After this callable is proven, the public wrapper can replace only its combined identity/can-post `undef` line with the terminal renderer, preserving invalid-usejournal and beta precedence. Leave readonly, anonymous, `altlogin`, and `share` as explicit fallthroughs.

## Finite acceptance

1. Actual public `GET /update` and `/update.bml` with a disposable identity session: HTTP 200, exact localized `Sorry` title, substituted site-name message, no form, no Location, and no missing-string banner.
2. A scoped real user whose `can_post` returns false: both aliases return HTTP 200 with the exact localized `Can't Post` title. Test once with a distinctive `$LJ::MSG_NO_POST` and once empty to prove fallback to `/update.bml.error.cantpost`.
3. For both variants, count `update_fields`, external-account enumeration, and external page construction as zero; force-fresh entry count and draft/preference values remain unchanged.
4. Ordering controls: invalid nonempty `usejournal` still wins over identity/cannot-post; beta redirect still wins over both; sequential identity, cannot-post, then ordinary eligible GET does not leak title/message or actor state.
5. Explicit retained controls remain: anonymous GET has the old credential form; readonly GET has one visible translated warning and form; `altlogin` and `share` remain BML. These are boundary assertions, not approval of their migration.

## Later finite packages

- **Readonly form:** reuse the accepted authenticated GET renderer with a real warning object after `update_fields`; prove optional help link, full fields/editor/defaults, raw canonical query/action decision, no writes, and desktop/narrow visibility.
- **Anonymous/authentication:** decide and test the schema/action transition (`user` versus `username`, `action:update` versus `action:post`) together with actual one-time authentication. Until then there is no safe render-only activation.

