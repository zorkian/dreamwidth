<!--
SLICE-7.md

Ordinary stock journal userpic support and qualification.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Slice 7: ordinary userpics

The first ordinary-feature bundle supports journal default pictures and selected
entry pictures on the unchanged stock RecentPage and EntryPage. Tags, links,
custom text, moods and comments retain their existing unsupported gates.

## Source behavior

Selection follows `LJ::Entry::userpic`, `LJ::User::Icons` mapping redirects and
`LJ::Userpic` default lookup. Missing keywords and redirect loops fall back to the
default. Missing default rows retain the native picture skeleton with zero
dimensions. Direct defaults can load X/S rows; keyword lookup excludes X/S.
Descriptions and keywords use legacy connection conversion and strict UTF-8;
Image alt/title are escaped once as in the retained helpers. Stored upload URLs
never become serving URLs.

Map IDs retain native decimal spelling: `01` does not address map key `1`.
Nondecimal map ID properties refuse explicitly. Each owner picture/map inventory
is bounded to 10,000 rows (limit plus one); this is a resource safety bound rather
than a native account quota. Redirect traversal records visited IDs. The existing
aggregate raw-text bound also applies to descriptions and keywords.

Only derived default/selected pictures reach the credential-free worker. Full
owner inventories and their raw-byte digests remain parent fingerprint inputs;
a persistent picture or mapping change during rendering prevents publication.

Re-export private startup configuration after this upgrade. The guarded exporter
records `construct_userpic_url` hook presence without executing it. A configured
unported hook refuses EntryPage only when its OG image requires that helper;
Recent S2 images still use the normal public USERPIC_ROOT. No image fetching,
proxying or storage writes occur on the serving path.

## Validation and reproduction

Run in the owning devcontainer after the existing Slice6 Node24/dependency setup.
From `src/s2/target/javascript`, emit the complete normal graph and create a fresh
closed artifact; do not reuse a partial prior worker emit:

```sh
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
S7_RUN=$(mktemp -d "$PWD/artifacts/slice7-userpics.XXXXXX")
perl -I"$LJHOME/cgi-bin" tools/live-compile.pl "$S7_RUN/stock.json"
/opt/dw-node24/bin/node ../../../content/tools/stage-runtime.mjs "$S7_RUN/stock.json"
/opt/dw-node24/bin/node --test dist/tools/userpics.test.js
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT="$S7_RUN/stock.json" \
    /opt/dw-node24/bin/node --test dist/tools/userpics-http.test.js
```

The native test compares sixteen source selection cases and eight `htmlattr`
scalars to retained Perl helpers. It is scalar/helper equality, not a full native
picture-page byte comparison. The SQL test owns three temporary guarded schemas,
loads owner-scoped pictures/maps, renders actual stock Recent/Entry through the
bounded child and checks foreign same-ID/private exclusion. A persistent picture
description edit during actual rendering produces fixed409; exact restoration
returns the baseline fingerprint and200. Schema cleanup runs in `finally`.

For the one representative Chromium proof, preserve an independently captured
qualified stock EntryPage (the retained `entry-compare` regression supplies the
current entry IDs). The historical implicit ID384 default is owner-specific;
set `S2_USERPIC_STOCK_PAGE` from your current comparison. Run with the existing
three-engine setup from the content guide:

```sh
/opt/dw-node24/bin/node dist/tools/check-live.js entry-compare
S7_STOCK_ID=$(/opt/dw-node24/bin/node -p \
    'require("./artifacts/live/entry-comparison.json").results[0].ditemid')
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT="$S7_RUN/stock.json" \
    S2_USERPIC_STOCK_PAGE="$PWD/artifacts/live/entry-oracle-${S7_STOCK_ID}-one/page-oracle.html" \
    S2_USERPIC_BROWSER_OUTPUT="$S7_RUN/browser" \
    /opt/dw-node24/bin/node --test dist/tools/userpics-http.test.js
```

This mode binds loopback8081 only if available, never takes over a listener, and
navigates the actual TS HTTP Entry. Exact declared picture11/22 URLs receive inert
one-pixel PNGs. Fixture style44 is explicitly mapped to the preserved qualified
stock stylesheet; only emitted stock assets and their finite CSS URL closure are
captured from the retained local app. Other requests/websockets and page errors
fail. The report records that mapping, loaded native alt/title/dimensions and exact
requested resources; `entry-userpics.png` is the actual browser screenshot. This
is fixture asset adaptation, not native picture binary/resource route parity.

Focused exporter/config/policy and selected-loader tests cover hook discovery,
unchanged privacy gates and independent owner SQL. No-picture frozen Recent and
Entry byte regressions remain separate proofs. Fresh Recent410/Entry62 attestations
must pass unchanged; historical accepted ledgers are never regenerated. Prior
cleaner/parser browser evidence carries because the cleaner is unchanged.
