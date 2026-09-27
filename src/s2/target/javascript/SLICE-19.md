<!--
SLICE-19.md

Qualified EasyRead layout with Aqua and bounded native stylesheet omissions.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# EasyRead with Aqua

The private anonymous Recent/Entry viewer adds exactly the stock **EasyRead**
layout with **Aqua**. EasyRead without Aqua, cross-layout themes, other layouts
and general executable custom layers refuse. Existing Tabula Rasa, Dazzle/Kelis
and the six customtext plus four ordinary user literals retain their behavior.
Source owner/type/parent/hash/compile-time facts and selected public credit
identities participate in the normal bracket and final reread.

The trusted local artifact contains separately compiled EasyRead and Aqua code,
with fixed source and generated-code hashes. Each layout compilation starts with
its own checker initialized from the same core. Stored database code is never
executed; the existing finite user-layer reader remains authoritative only for
its ten literal properties. The default two-layer artifact is unchanged.

## Native rendering and CSS

EasyRead uses the unchanged stock Page wrapper and modules above/below entries.
Its actual stylesheet is generated inside the credential-free child and delivered
inline. No retained journal stylesheet supplies or masks it. The system layout's
verified layer ID supplies the native customize link; a journal style ID does not.
Only selected fixed catalog names `rb` and `krja` can cause public credit lookups.
Missing users retain literal names; present users retain their qualified badge.
Their complete credit UL is frozen before printing, with the existing exact-byte
safe emission boundary.

Native EasyRead CSS contains two doubled `font-family` declarations, one empty
contextual-hover color, an extra semicolon and an invalid `:first` rule. Chromium
ignores these forms. The EasyRead-only cleaner proves the exact counts, containing
selectors/properties, source spans and parser errors before omitting complete
invalid declarations/rule/separator. Unknown forms/errors refuse. Original raw
safety and hook-trigger checks run before omissions; strict reparse, existing
safety/bounds and final serialized checks run afterward. Valid sibling size,
color and padding declarations survive. Only this catalog path admits the
qualified `:after` and `:focus`; Tabula validation stays strict.

Fonts are **not repaired**. Body/container family remains the native browser
fallback (Times New Roman in the qualified Chromium environment); a `Georgia`
user override applies at the valid module-text declaration, where it is the first
family. The invalid `:first` rule is not rewritten to `:first-child`. CSS whitespace
and comments are serialized, so full native CSS byte parity is not claimed.
Whole-sheet limits remain64KiB/4096 nodes/depth16. URL/import/function/active CSS,
style-end and raw or serialized word-boundary `url(` triggers refuse. Existing
qualified CSS-hook provenance and no-cache/no-proxy/private-viewer limits remain.

## Reproduction

Run in the owning devcontainer after the Node24 bootstrap and normal package
setup in [Slice6](SLICE-6.md). From the JavaScript target directory:

```bash
NODE24=/opt/dw-node24/bin/node
mkdir -p artifacts/slice19
perl tools/live-compile.pl --easyread artifacts/slice19/stock.json
"$NODE24" ../../../content/node_modules/typescript/bin/tsc -p ../../../content/tsconfig.json
"$NODE24" node_modules/typescript/bin/tsc -p tsconfig.json
"$NODE24" ../../../content/tools/stage-runtime.mjs artifacts/slice19/stock.json
sha256sum artifacts/slice19/stock.json.runtime/manifest.json
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT="$PWD/artifacts/slice19/stock.json" \
  S2_STYLES_BROWSER_OUTPUT="$PWD/artifacts/slice19/browser" \
  PERL_HASH_SEED=0 PERL_PERTURB_KEYS=0 \
  "$NODE24" --test dist/live/tests/styles-native.test.js dist/live/tests/styles-http.test.js
```

The owning retained app must run for the exact observed global resources captured
by the representative browser test. These resources are individually hash-bound;
undeclared requests and retained journal stylesheet requests fail. Browser output
under `browser/easyread/` is an actual TS fixture page, not a native feature-page
byte comparison or userpic binary-route parity. Native helper/control sheets,
actual isolated SQL/current child/HTTP, hidden-comment exclusion and style/credit
freshness are distinct assertions. Fixture schemas are guarded and dropped in
finally; ordinary account records are not changed. Prior no-feature HTML and
410/Entry62 fixed expectations remain separate regression gates.

For ordinary startup, export a fresh private site config with the selected
artifact using [Slice18's command](SLICE-18.md), including `-I"$LJHOME/cgi-bin"`
and `S2_SITE_CONFIG`, then run the Node24-prefixed server. Recompile/restage with
`--easyread` after a parity driver that creates a default artifact before rerunning
these layout tests. Preserve earlier artifacts and evidence.
