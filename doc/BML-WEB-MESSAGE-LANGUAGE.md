# LJ::Web global message language audit

Audited at `3f31595d88d1a94ef90dec45ea18e227a237987c` on 2026-09-23. Scope is `LJ::bad_input`, `LJ::error_list`, and `LJ::warning_list` only.

## Current behavior

- `LJ::bad_input` (`cgi-bin/LJ/Web.pm:291`) has no translation lookup. It emits `<?badcontent?>`, then calls `LJ::errobj(...)->as_bullets` for each supplied error. Its remaining callers are retained `htdocs/editjournal.bml` paths, which supply already-localized page strings. This helper needs no language conversion in this slice.
- `LJ::error_list` (`cgi-bin/LJ/Web.pm:310`) obtains only its heading through mutable process-global `BML::ml('error.procrequest')`. It preserves supplied error objects through `as_bullets`, including trusted markup and nested error lists, and wraps the result in the legacy `<?errorbar ... errorbar?>` token.
- `LJ::warning_list` (`cgi-bin/LJ/Web.pm:344`) obtains only its heading through `BML::ml('label.warning')`. It inserts each supplied warning unchanged into `<li>` and returns the legacy `<?warningbar ... warningbar?>` token. There are no in-tree callers outside its definition.
- Both keys are absolute general-domain keys in `bin/upgrading/en.dat`: `error.procrequest` and `label.warning`. They do not depend on page or template scope.
- `BML::ml` is a process-global subroutine rebound by `BML::set_language`; without that initialization it returns `[ml_getter not defined]`. `LJ::Lang::ml` instead uses request-local language/getter/scope through `DW::Request`, and falls back to `DEFAULT_LANG` with no request. Full keys are unaffected by request scope.

## Callers affected by the heading conversion

- `LJ::entry_form` calls `LJ::error_list` for an entry error (`cgi-bin/LJ/Web.pm:1009`).
- `DW::Widget::LatestInbox` calls it after a native widget-localized inbox error (`cgi-bin/DW/Widget/LatestInbox.pm:36`).
- `LJ::Widget::InboxFolderNav` calls it with a BML-localized error (`cgi-bin/LJ/Widget/InboxFolderNav.pm:65`).
- Retained inbox BML pages and `cgi-bin/bml/scheme/global.look` also call it.
- `DW::Controller::SettingsHub::_notification_error_html` already demonstrates the native global heading lookup with `LJ::Lang::ml('error.procrequest')`, but deliberately emits native HTML rather than the legacy processing token.

This slice removes only the two heading lookups from mutable BML language state. It does not convert caller-supplied local messages or replace the legacy error/warning processing tokens.

## Smallest production change

Replace exactly:

- `BML::ml('error.procrequest')` with `LJ::Lang::ml('error.procrequest')`
- `BML::ml('label.warning')` with `LJ::Lang::ml('label.warning')`

Keep `bad_input`, `LJ::errobj`, `as_bullets`, warning insertion, and both legacy wrapper formats byte-for-byte otherwise. `LJ::Web` already calls `LJ::Lang::ml` in migrated helpers and already depends on `DW::Request`; no new runtime mechanism or request mutation is required. A focused test should explicitly `use LJ::Lang`, `DW::Request`, and `DW::Request::Plack`.

## Finite acceptance tests

Add one focused `t/web-message-language.t`:

1. Create a real `DW::Request`, install request context `lang => first` and a custom getter that records keys. Call `error_list` and `warning_list`; assert the getter receives exactly `error.procrequest` and `label.warning`, and the returned legacy wrappers contain the distinct getter markers plus supplied list content.
2. Start a second request with a different getter marker. Assert both headings use the second marker and contain no first-request marker. This proves sequential isolation from the old process-global binding.
3. Reset `DW::Request`, localize `DEFAULT_LANG` to a real configured language, and call both helpers without a request. Assert the actual default headings render, with neither missing-string output nor `[ml_getter not defined]`.
4. Use request language `debug`; assert the full supplied keys appear literally. This preserves current native debug semantics without page-scope dependence.
5. Call `bad_input` with a plain error and a nested/multiple `LJ::Error`; assert its existing `<?badcontent?>` and bullet structure, and assert the custom language getter was not called.
6. Exercise one actual caller, preferably `LJ::entry_form` with `errors->{entry}` under a custom request getter. Assert the generated form contains the getter-provided `error.procrequest` heading and the supplied entry error once. This proves the migrated lookup is reached through real rendering without changing form behavior.

No browser test, route test, database fixture, request-method coverage, or warning caller creation is needed for this two-key conversion.
