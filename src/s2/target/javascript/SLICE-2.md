<!--
SLICE-2.md

Offline conformance guide for one stock S2 recent page.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# S2 JavaScript slice 2: one stock recent page

This package proves an offline JavaScript render of one real anonymous Dreamwidth
recent page. From the repository root, in the owning devcontainer:

```sh
cd src/s2/target/javascript && npm ci --no-audit --no-fund && npm run check:page
```

The check uses the real `app.psgi` Plack route for
`GET http://localhost/users/s2js_slice2/`, with no cookies. Its Perl HTTP
response is the comparison oracle. The JavaScript renderer executes the full
unchanged stock Tabula Rasa S2 source stack, in order:

| Layer | File | SHA-256 |
| --- | --- | --- |
| core2 | `styles/core2.s2` | `8621d96ebc6f9ee9eaf19f4cc0ac9e029b0e816d982653d19d52b04918cd9db6` |
| core2base/layout | `styles/core2base/layout.s2` | `c1f6fb95fbecc202a024efa7558c6cedcdb5229f150e765fd441ba632ff0b411` |

The offline preparer checks both the checkout source and the installed Perl
layer source. It uses the ordinary stock style and runs the original
`LJ::S2::s2_run`; a local wrapper only captures the prepared `RecentPage`
and its initialized context properties before that original render.

## Owned fixture and deterministic inputs

The preparer requires `IS_DEV_SERVER`, `IS_DEV_CONTAINER`, and local database
`dw_global`. It creates or verifies only marked account `s2js_slice2`, display
name `S2 slice 2 fixture`, email `s2js-slice2@example.invalid`, bio marker
`s2-js-slice2 fixture v1`, and two public entries on 2026-09-24 at 11:00 and
12:00 UTC. Each entry has subject `Sample N & text` and body
`<p>Fixture N: café &amp; tea 😀</p>`. Existing marked partial setup is
repaired through normal app helpers; unmarked collisions and unexpected entry
content fail. The owned variant changes only entry 1 body to
`<p>Fixture 1 variant: café &amp; tea 😀</p>` through `editevent`, regenerates
the real Perl HTTP oracle, then restores the baseline through `editevent`.
The harness has a separate finally restore, plus an initial recovery step for
an interrupted prior run. Recovery accepts only that exact temporary body;
it safely skips a missing account or first sample so partial seed can proceed.

Seed writes use the real clock. The GET request clock is frozen to
2026-09-25T00:00:00Z. `PERL_HASH_SEED=0` and `PERL_PERTURB_KEYS=0` fix Perl
hash iteration. For the anonymous GET only, a local wrapper gives the original
`LJ::form_auth` its request cache value
`invalid-s2-js-slice2-fixture`; the original helper still builds the hidden
field. This clearly invalid value is inert local render data, with no auth or
form-submission conformance claim. The request has no remote user or session
cookie. Numeric account, style, entry, and layer IDs may vary between owning
devcontainer databases; every comparison uses the oracle regenerated in that
same database.

## Fixture schema and host boundary

`artifacts/page/baseline/page-input.json` is schema 1, JavaScript ABI 1.
`provenance` records base `aa0f7f1fc3a1cbb897e5f62954d78c3930c35313`,
ordered source paths, hashes, layer names and resolved IDs, fixed GET request,
clock, seed version, and baseline/owned-body variant. `graph` records prepared
S2 hashes and arrays as numbered nodes with `$ref` aliases, plus `root` and
`properties` references. Typed S2 objects retain `_type`, null members, and
their prepared fields. The page is `RecentPage` with two `Entry` objects.
Live `LJ::User` objects become identity only; `_url_of` closures and DB handles
are omitted. The renderer rejects wrong version/stack/page shape and missing
named fields rather than inventing results.

`host` contains only named application-owned data needed by the measured
anonymous render: owner identity, control strip from `LJ::control_strip`,
script resource tags from `LJ::S2::get_script_tags`, quickreply fragment from
`LJ::create_qr_div`, identity-bound user badge from `LJ::ljuser`, user link
metadata from `user_link_bar`, empty visible-tag count from `LJ::Tags`,
image objects from `LJ::S2::Image_std`, day counts and one calendar month from
`LJ::S2::get_journal_day_counts` and `LJ::S2::YearMonth`, and app permission
decisions for controls and links. The footer records the actual results of
`insert_html_before_body_close`, `insert_html_before_journalctx_body_close`,
and `LJ::PageStats::render`; the two hooks must be empty for this fixture.
The renderer inserts that named footer before the first `</body>`, matching
`DW::Controller::Journal`. It does not import HTML sections, an S2 output
tape, or arbitrary builtin return playback. JS stock S2 computes the page,
entry order, formatted subjects, bodies, dates, and navigation from structured
data. User badge fragments are accepted only for the exported owner identity.

The reached public builtin closure is the measured `DateTime`/`YearMonth`
formatters, `EntryLite__formatted_subject`, `Entry__get_link` and reply
printers, `Page__get_latest_month`/control strip/script tags/visible tag list,
`UserLite__equals`/get_link/ljuser, `alternate`, `clean_css_classname`,
`ehtml`, `get_image`, `get_page`, `get_plural_phrase`, `string__contains`,
`striphtml`, `weekdays`, and the ten viewer flag functions. An unmeasured
capability fails explicitly. The page's trusted `print safe` chunks use a
small serializer for the observed HTMLCleaner behavior: normalize quoted
attributes, escape embedded quotes and ampersands, trim trailing tag space,
and omit comments. Unsupported attribute entities and multiline values fail.
This adapter is scoped to trusted local fixtures and is not a general HTML
sanitizer. Slice 1 retains its own safe-print behavior and byte-oriented
string length semantics; S2 substring remains codepoint based as required by
the retained Perl source helper.

## Evidence and limits

`npm run check:page` retains the regenerated HTML, JSON, and compiled stock
artifact under ignored `artifacts/page/`. It compares full HTTP and JS output
byte for byte; runs repeat generation, a real Perl-owned body variant and
restoration, structured subject/body/date mutations, real HTMLCleaner probes,
and deliberate wrong-input, renderer-error, timeout, output-limit, and
unknown-capability failures. Perl export/compile have 60-second and 16-MiB
subprocess limits. Node render has 10-second and 2-MiB subprocess limits, plus
a 2-MiB limit while accumulating HTML before stdout. The Node child gets only
PATH, LANG, and HOME, and launches no Perl or application bootstrap.

This is one anonymous recent page and one stock stack. It does not implement
other views, styles, authenticated behavior, a production data loader, or a
tenant security sandbox. The local control-strip form field cannot be used
for authentication. `runtests.pl` has different substring handling for its
standalone fixture path; this page follows the production S2 helper.

In the implementation container, the exact package command returned full
17,716-byte HTTP/JS parity; the owned Perl variant returned 17,724 bytes and
restored the baseline. `npm run check` passed all nine retained cases,
`perl -I. runtests.pl --force` passed, and `perl extlib/bin/tidyall -a`,
`perl t/02-tidy.t`, `perl t/00-compile.t`, and `bin/build-static.sh` exited
successfully. `bin/dev/screenshot --out /tmp/s2-js-slice2-page.png
/users/s2js_slice2/` returned HTTP 200; the inspected image showed the two
entries, navigation, calendar, profile, and stock Tabula Rasa credit.
