<!--
SLICE-18.md

Two qualified stock themes and bounded ordinary property overrides.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Stock themes and ordinary overrides

Historical qualification only: after the source-only cleanup, the retained
old server refuses selected journal user layers. Their settings are S2
source; the approved general server must compile that source and is not yet
wired to startup. No stored generated Perl reader remains in serving.

The private anonymous Recent/Entry viewer supports the pinned Tabula Rasa
**Dazzle** and **Kelis** themes. It also supports four owned user-layer literals:
`color_page_background` (Color), `font_base` (string), `module_tags_show` (bool),
and `module_tags_order` (int), alongside the six existing [customtext](SLICE-13.md)
properties. This is a finite compiled-authority subset, not arbitrary layouts,
functions, themes, properties or executable user layers. Other layer sets refuse.

## Source and rendering boundary

The parent validates system theme ownership, exact source digest, type, layout
parent and compile time. Owned user layers retain the fully consumed native
compiled-wrapper reader: source is fingerprinted but never interpreted; no stored
code executes. The selected theme is executable only from the independently
hash-qualified local compiler artifact. Both themes are present in that finite
artifact catalog, and only the selected one is instantiated per request.

New theme or four-property pages use the unchanged stock
`external_stylesheet=false` branch. The credential-free child generates their
actual stylesheet, buffers nested start/end CSS output, and validates the complete
sheet with existing CSS Tree before publishing it inline. Ordinary stock positions,
selectors and media rules survive; this is separate from entry-body containment.
Stylesheet comments/whitespace are serialized by CSS Tree, so CSS bytes are not
claimed identical to retained output. URL, import, function, custom-property,
unsupported pseudo and active CSS syntax refuses. The sheet is bounded to64KiB,
4096 nodes and depth16. Fonts are bounded to1024 UTF8 bytes and validated as an
ordinary font-family value; style-end, declaration injection and functions refuse.
No retained journal stylesheet is used to mask the generated overrides.

The no-connect exporter classifies actual registered callback provenance as
`none`, `proxy-css-links-only`, or `unsupported`, using the exact in-tree module
source digest, loaded path, package and callback location without executing or
exporting callbacks. The core ProxyCSSLinks hook is an identity for this admitted
domain only because BOTH raw stock CSS and final serialization forbid its literal
case-insensitive word-boundary `url(` trigger, including strings/comments; absence
of CSS Url nodes alone is insufficient. The known core hook therefore works on an
ordinary installation. Missing facts/other callbacks refuse only pages needing
this new stylesheet path, not startup or original external-style pages. Re-export
the private configuration after an upgrade. Cache/proxy/request-defense omissions and
restart snapshot semantics remain as documented in [Slice6](SLICE-6.md).

Native Color accepts optional `#` plus three or six hex digits, normalizing valid
colors to six lowercase digits; constructor-empty remains defined and differs
from null. Only this new inline path gets fresh null-marked sentinels for absent
Color properties. Native proof shows stylesheet helper autovivification does not
change the caller's absent property; existing fallback and defined-empty behavior
remain distinct. The fixed css-multiply builtin preserves the retained unanchored
integer/unit extraction quirks rather than inventing modern length semantics.

Tags retain their existing public visibility rules. The bool controls display;
order uses the existing engine-local section-array behavior, including native
negative-index semantics and failure for invalid assignment to an empty section.
No unused array property or other-page sorting override is admitted.

## Public theme credit

Selected catalog titles Dazzle/Kelis and the source-qualified system layout ID
produce the native configured SITEROOT customize link; the no-theme label/link
remain unchanged. This app-owned link adds no private-viewer route or auth action.
Only author names in the selected immutable theme catalog are resolved (currently
`zvi`). Missing identity yields the stock literal label. Present identity uses
source-qualified public badges, including the distinct suspended-user credit
behavior; it does not borrow comment redaction. No profile, picture, timezone or
email data is loaded. Both identity mappings, status/caps and absence are included
in global bracketing and final reread; unsupported present facts refuse rather
than masquerading as absence. Unknown child lookup names refuse.

The engine preprints only unchanged stock `print_module_credit()` with output
suppressed. It freezes its single complete bounded credit UL, computed from
approved facts/catalog/properties, before normal printing. Only exact bytes are
registered. Mutated or unrelated chunks still use the existing safe filter; no
module-list, body, comment or general serializer bypass is added.

## Focused reproduction

Run in the owning devcontainer after the pinned Node24 setup in Slice6. Keep
system Node unchanged. From `$LJHOME`:

```sh
cd src/content
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
/opt/dw-node24/bin/node --test tests/stylesheet.test.mjs
cd ../s2/target/javascript
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
mkdir -p /tmp/styles-check
perl tools/live-compile.pl --themes /tmp/styles-check/stock.json
/opt/dw-node24/bin/node ../../../content/tools/stage-runtime.mjs /tmp/styles-check/stock.json
sha256sum /tmp/styles-check/stock.json.runtime/manifest.json
perl -I"$LJHOME/cgi-bin" tools/site-config.pl \
  --output /tmp/styles-check/site-config.json --artifact /tmp/styles-check/stock.json \
  --app-origin http://localhost:8080 --listen-origin http://localhost:8081
export S2_SITE_CONFIG=/tmp/styles-check/site-config.json
S2_LIVE_TEST_ARTIFACT=/tmp/styles-check/stock.json \
  /opt/dw-node24/bin/node --test dist/live/tests/styles-native.test.js
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT=/tmp/styles-check/stock.json \
  S2_STYLES_BROWSER_OUTPUT=/tmp/styles-check/browser \
  /opt/dw-node24/bin/node --test dist/live/tests/styles-http.test.js
/opt/dw-node24/bin/node --test dist/tools/site-config.test.js
```

Record the manifest digest immediately after staging; other regression drivers
may legitimately restage that same artifact root. No-feature parity drivers compile
without themes, so restore `--themes` and fresh stage before the style tests.
The SQL test uses guarded temporary fixture schemas and cleans them in its existing
finally path; ordinary records are untouched. It proves Recent/Entry inline output,
both themes, typed properties, source/compiled/selection and theme-credit status
changes producing409, exact restoration, unsafe font (including quoted raw hook triggers) refusal and foreign
owner/parent/unqualified-source isolation. Compact independent native assertions
cover both page CSS contexts, typed wrappers/Color/null/multiply and present/absent
credit. Engine mutation tests verify frozen credit bytes and unknown-name refusal.

Representative Chromium verifies generated background/font/padding and public tags
placement from the actual TS HTTP page, with no journal stylesheet. It captures
only the finite observed global stock assets from the retained local app and
intercepts their exact URLs; undeclared requests/WebSockets fail. This is computed
style/placement evidence, not native whole-page or binary resource-route parity.
Browser JSON lists exact source URLs/hashes, HTML digest and screenshot path.

Default compilation without `--themes` remains the original two-layer artifact.
No-theme pages retain their original rendering branch and byte expectations;
independent410 Recent and62 Entry records remain unchanged. Shared Color changes
also require the existing nine Slice1 fixtures, full17716-byte Slice2 comparison
and legacy compiler/runtime suite. Fresh full emit and closed staging are required;
old dist evidence is not a current worker. Manifest integrity, production closure,
worker10s/128MiB, HTML2MiB and credential/network/child denials remain unchanged.
