# Public owned-edit GET activation: test impact and retained-schema plan

Basis: foreman `bbb23c276fabb9f977c78f432520c8f4074cb9a1`, callable native GET
`cce03c7bfcecdef9e8fd1ff0ea67442a7f356af5`, and browser composition
`ee8bf31590774741891deb90567317ea1eb98c0a` (fixture freshness follow-up
`03362e22946a733f15f57d970b9d3cca4d13721c`). This is an audit only: it does
not register the callable GET handler publicly.

## Why activation changes tests

`DW::Routing` strips `.bml` before resolving `app/editjournal`, so a public
personal-owner GET registration changes both `/editjournal` and
`/editjournal.bml`. The existing production `EntryPicker` dispatch calls only
`legacy_owned_edit_handler`, which returns `undef` for GET; `app.psgi` then
falls through to `DW::BML`. After activation, an eligible personal GET renders
native `/entry/<user>/<ditemid>/edit`, while POST stays on the existing
`legacy_owned_edit_handler` and consumes the old flat schema.

## Directly affected tests

| Test | Current retained evidence | Activation break | Bounded replacement |
| --- | --- | --- | --- |
| `t/plack-entry-legacy-edit.t` | Fetches `/editjournal(.bml)?itemid=...`, parses `#updateForm`, then submits old save controls. | Eligible owner GET becomes native `#js-post-entry`; it no longer supplies the old control names. | Split its concerns: preserve one explicit test-only BML GET composition that parses/asserts the retained form and aliases; submit resulting old-schema POST to the real public app. Add native GET assertions to `t/plack-entry-legacy-owned-edit-get.t`, not here. |
| `t/plack-entry-legacy-owned-edit-adapter.t` | Registers a test adapter for POST but harvests its CSRF/form schema from retained GET, including retry/delete/denial cases. | Its own test route supersedes the application route, but its GET currently falls through to BML only because the production handler does. | Make the test overlay method-split: explicit BML render for GET; its existing test adapter for POST. Keep actual BML form token/click construction and no synthetic modern schema. |
| `t/plack-entry-legacy-owned-edit-dispatch.t` | Uses actual public app POST dispatch but repeatedly harvests retained owner forms for save/delete/retry and hidden/beta/readonly/authas cases. | Eligible owner form harvest becomes native, invalidating old-schema POST evidence. Excluded authas GET remains BML by design. | Use a temporary method-split routing overlay during form harvest: explicit BML GET, original captured production `EntryPicker` handler for POST. Continue posting to the real public handler and retain the excluded-context BML assertions unmodified. |
| `t/browser/entry-legacy-edit.js` + `entry-legacy-edit-adapter-server.pl` | Browser loads old `#updateForm` then clicks old save/delete controls against real public POST dispatch. | Browser GET becomes native and cannot establish old-schema/FCK control evidence. | Give this test server the same explicit method split: GET invokes retained BML renderer; POST delegates the captured application route. Browser remains an end-to-end legacy-form-to-production-POST contract; it must not assert public GET remains BML. |

The helper/unit tests `t/entry-legacy-edit-actions.t`,
`t/entry-legacy-owned-edit-post.t`, `t/entry-legacy-owned-edit-rerender.t`, and
`t/entry-legacy-edit-success.t` do not fetch the public edit GET form, so no
activation rewrite is needed.

## Mentions that are intentionally not migrated

`t/plack-entry-maintainer.t` and `t/plack-entry-picker.t` mention
`/editjournal?itemid=...` only in contexts excluded by the callable GET slice
(community/usejournal, manager-other-poster, non-owner/authas, ordinary picker,
or logged out). They remain real public BML-fallback regression evidence. Do
not install an overlay there or change their expected BML results.

`t/plack-entry-legacy-owned-edit-get.t` and
`t/browser/entry-legacy-edit-get.{js,fixture.pl,server.pl}` are the native
personal-owner GET evidence. They remain public/native after activation and
must not be converted to retained BML composition.

## Recommended test-only seam

Create one narrow test helper for affected Perl tests and a matching browser
server helper:

1. Load `app.psgi` normally and capture
   `$DW::Routing::string_choices{'app/editjournal'}` before replacement.
2. Localize/temporarily replace only that routing hash entry with a shallow copy
   whose `sub` branches on the real request method:
   - `GET`: resolve the real request URI with `DW::BML->resolve_path`, then call
     `DW::BML->render($file, $resolved_uri)`. This preserves the actual retained
     file, token generation, `.bml` spelling, query, and flat form fields.
   - `POST`: invoke the captured original route sub with the supplied
     `DW::Routing::CallInfo`. This is the actual activated public POST
     composition, not a copied adapter.
   - any other method: delegate unchanged to the captured sub so method/fallback
     behavior is not accidentally widened by a test helper.
3. Scope the localization to each `test_psgi` block. For the browser test
   server, install it only in that owned process before Starman starts. The
   ordinary application server used by public-native GET coverage stays
   unmodified.
4. Continue creating requests through parsed `HTML::Form` controls and a
   request-generated `lj_form_auth`. Do not freeze a token or replace old form
   inputs with a static hand-built POST fixture.

This preserves two independent facts after activation: public eligible GET is
native, while legacy POST compatibility continues to be exercised from an
actual retained BML schema. It does not require production to serve old GET,
does not delete retained evidence, and does not alter BML fallback for excluded
contexts.

## Required activation follow-up checks

- Both spellings: native public GET for an eligible owner; explicit test-only
  retained BML GET for form harvesting; real public POST for old-schema save,
  delete, invalid token, and retry.
- The overlay must prove it was used only for its test process (for example a
  retained-form marker plus the native public GET test in the same suite/range).
- Keep raw query and `.bml` alias assertions at the old form boundary; retain
  canonical native action/query assertions in the native GET suite.
- Run the current browser lifecycle tests both normal and named intentional
  failure. Browser review of `ee8...`/`03362...` remains a prerequisite to
  public activation.
