<!--
SLICE-8.md

Ordinary stock journal links and website support and qualification.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Slice 8: ordinary links and website

The private anonymous unchanged core2/core2base Recent and Entry pages now render
owner website fields and flat links. Tags, custom text, currents and comments
remain the existing unsupported feature boundaries. No new page, cache, request
defense, image proxy, dependency or sanitizer is introduced.

## Data and model

The selected primary snapshot reads at most 10,001 owner links and refuses more
than 10,000. This is a resource bound, not a native account limit. Title, URL and
hover use the same strict legacy connection conversion as other Perl text, with
raw bytes fingerprinted. The independent final request reread includes every row,
website property and the previously existing owner/settings/style dependencies.
Foreign journal rows never enter the snapshot or child.

`LJ/Links.pm::load_linkobj` has no SQL ORDER BY; native stable numeric ordernum
sorting retains received order for ties. The schema guarantees no ordernum
uniqueness. The implementation preserves that ordering, not a new secondary key.
Native parent relationships are TODO, so children stay empty. NULL/empty/"0" URL
means heading; exact "-" title means separator. Save-time canonical_url is not
run again. Website name falls back to the stock compiled default when empty.

## Escaping and safety boundary

UserLink and website fields are ehtml-escaped once. The trusted safePrint serializer
accepts only its reached amp/quot/lt/gt/#39 encodings and decodes once for semantic
validation; literal entity-looking source strings remain literal. No parent-only
entity map, general parser, recursive decoder or child credential grant is added.
Normal print/println and the stock streaming flush remain unchanged.

Active script/about/data/blob/file/filesystem destinations and whitespace/control
URL shapes are explicit Unsupported, before website raw output or safePrint.
Native blanks some active attributes but permits data navigation; that gap is not
reproduced. A title containing the native dangerous scheme pattern also refuses
instead of silently losing its text. Other unqualified attribute entity grammar
retains its earlier refusal. These are bounded representation/security differences,
not general navigation or HTMLCleaner conformance claims.

Three owner settings are no-effect only for this hash-qualified anonymous stock:
timezone, opt_no_quickreply and use_journalstyle_icons_page. Native full retained
Recent/Entry requests with each getter changed produce equal bytes. Timezone does
affect journal_current_datetime, but this artifact does not call it; quickreply
requires a remote user and the icon setting controls a different page. All three
remain fingerprinted. No arbitrary-style or authenticated claim follows.

## Reproduction in the owning devcontainer

Use the Node24 setup and standalone private config from [SLICE-6.md](SLICE-6.md).
Build the content package and normal S2 tsconfig, then create a fresh artifact and
closed runtime; do not reuse an old staged worker after runtime source changes.
From src/s2/target/javascript:

```bash
S8_RUN=$(mktemp -d "$PWD/artifacts/slice8-links.XXXXXX")
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
perl tools/live-compile.pl "$S8_RUN/stock.json"
/opt/dw-node24/bin/node ../../../content/tools/stage-runtime.mjs "$S8_RUN/stock.json"
/opt/dw-node24/bin/node --test dist/tools/links.test.js
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT="$S8_RUN/stock.json" \
    /opt/dw-node24/bin/node --test dist/tools/links-http.test.js
```

The scalar oracle has 16 original/input/output cases plus native UserLink objects.
The actual SQL/current child/HTTP fixture covers both pages, same-order ties,
foreign journal isolation, link and website edits during rendering (409), exact
restoration and subsequent 200, and unsafe website/link refusal. Its isolated
schemas are removed by guarded finally; ordinary accounts are not edited.

Optional actual Entry browser evidence uses the installed Chromium and exact
captured stock resources; no external link is clicked or fetched. Like userpics,
fixture style44 is explicitly mapped to the retained qualified stock stylesheet:

```bash
/opt/dw-node24/bin/node dist/tools/check-live.js entry-compare
S8_STOCK_ID=$(/opt/dw-node24/bin/node -p \
    'require("./artifacts/live/entry-comparison.json").results[0].ditemid')
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT="$S8_RUN/stock.json" \
    S2_LINKS_STOCK_PAGE="$PWD/artifacts/live/entry-oracle-${S8_STOCK_ID}-one/page-oracle.html" \
    S2_LINKS_BROWSER_OUTPUT="$S8_RUN/browser" \
    /opt/dw-node24/bin/node --test dist/tools/links-http.test.js
```

The browser checks actual DOM href/title/text and resolved query/entity/website
destinations under stock scripts. This is not binary/resource route parity or
full native positive-feature page byte parity. No-feature native full-page bytes,
Slice1 nine fixtures, Slice2 byte equality, legacy compiler tests, userpic
regressions and the unchanged 410/Entry62 cleaner binding remain separate gates.

For the three native setting proofs, run each setting and baseline with the
existing frozen comparison inputs and a fresh output directory. The wrapper
supplies just that owner getter; it does not edit stored properties:

```bash
S8_STOCK_ID=$(/opt/dw-node24/bin/node -p \
    'require("./artifacts/live/entry-comparison.json").results[0].ditemid')
S8_SETTINGS=$(mktemp -d /tmp/slice8-settings.XXXXXX)
for page in recent entry; do
    for setting in baseline timezone opt_no_quickreply use_journalstyle_icons_page; do
        mkdir "$S8_SETTINGS/$page-$setting"
        extra=()
        if [ "$page" = entry ]; then extra=(--entry "$S8_STOCK_ID"); fi
        PERL_HASH_SEED=0 PERL_PERTURB_KEYS=0 perl tools/links-settings-native.pl \
            "$setting" http://localhost:8080 "$S8_SETTINGS/$page-$setting" \
            --comparison AAAAAAAAAAAAAAA:1790294400:x "${extra[@]}"
        if [ "$setting" != baseline ]; then
            cmp "$S8_SETTINGS/$page-baseline/page-oracle.html" \
                "$S8_SETTINGS/$page-$setting/page-oracle.html"
        fi
    done
 done
```

Use Bash for these array commands. Comparison signing preparation follows the
existing local oracle helper; no signing secret is exported. The wrapper clock
is compiled before native helpers. Ordinary live serving has no frozen clock.
