<!--
SLICE-10.md

Ordinary rich subjects and textual entry currents in the private stock viewer.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Slice10: rich subjects and textual mood, music and location

The existing anonymous stock Recent/Entry viewer admits ordinary rich subjects
and textual custom mood, music and location. Data remains SELECT-only; only the
bounded credential-free worker parses or sanitizes these values. Userpics,
links/website, public sidebar tags and selected entry tags remain supported.
No cache, request defenses, captcha, proxy signing, authentication or new views
are added. Follow [SLICE-6.md](SLICE-6.md) for private config/export/startup.

## Separate source contexts

[LJ::CleanHTML](../../../../cgi-bin/LJ/CleanHTML.pm)1562-1609 distinguishes
`clean_subject` (a/b/i/u/em/strong/cite formatting) from `clean_subject_all`.
The shared subject operation starts with the original bounded source and produces
cleaned display HTML, an independently anchor-stripped Recent display, and an
inert all/title helper. No helper is taken from sanitized display or `textContent`.
These results stay inside the render child; the parent carries tainted strings.

No-angle source preserves literal entity spelling, LF, empty and `0`.
Source-located whitespace in implicit HTML5 HEAD after eaten metadata is retained;
implicit parser scaffolding is not treated as an explicit source eating token.
Recent removes source anchors before adding its stock permalink. Entry keeps
source anchors in a span when its cleaned subject contains `href`.
Empty cleaned subjects use compiled stock default/screenreader text.
Literal quote delimiters in the title attribute are encoded safely; existing
entity spellings are not recursively decoded or double escaped there.

OpenGraph title independently runs the raw `subject_text` context, then source
Perl-false fallback and ehtml. Thus display `0` is visible but OG uses
`(no subject)`. Literal `&amp;` in that helper becomes `&amp;amp;` in OG markup.
There is **no title300 trim**. The existing event description independently retains
its collapse, trim300 and ehtml pipeline. Display and helper results need not agree.

## Textual metadata and selected-data privacy

[LJ::currents](../../../../cgi-bin/LJ/Entry.pm)2837-2891 uses `clean_subject` for
custom mood, music and textual location. Raw Perl-false empty/`0` creates no key.
A raw truthy value sanitized to empty retains its key: the unchanged stock code
can emit its metadata wrapper and empty UL. These are deliberately distinct.
Without any numeric mood ID, source does not query mood names/themes/pictures;
the native user accessor itself reads the stored field (DW/Mood.pm470).
Otherwise-unused journal mood theme and force-theme facts therefore do not cause
a blanket refusal. They remain fingerprinted settings.

Any truthy numeric mood ID or coords refuses422, even with custom mood/location
text. Native numeric mood can still reach theme/icon lookup; invalid coords can
suppress/autovivify Location. Numeric themes, coordinates, crossposts and custom
text/casual-editor behavior are named subsequent features, not flattened text.

Only selected public entries carry these raw values. Private/usemask entry text,
foreign same-ID rows and unrelated history are absent from the child. Existing
primary raw-byte/logprop fingerprints include the subject/current dependencies;
persistent changes before final reread withhold buffered HTML409. Subject and
individual current strings have an explicit1024 UTF8 byte safety bound (not an
account quota), within existing selected-text/worker limits. Existing body and
full-cut/event-helper policies and bounds are unchanged.

## New-context safety and representation records

Ordinary inline color, weight, italic, underline, classes and safe links survive.
The existing CSS Tree machinery applies safe containment to this **new context**:
fixed/absolute, expression, behavior and binding styles are removed/refused.
Native subjects do not enable body's `cleancss`; these are intentional
security/containment corrections, not native byte parity or inherited body waivers.
Ordinary escaped CSS identifiers are decoded with maintained CSS Tree APIs before
screening: escaped red stays red, escaped fixed is removed. Remaining unproved
escape forms refuse rather than deleting slashes and changing a destination.
Body CSS behavior is untouched.

The compact fixed records additionally distinguish:

- Relative link resolution to canonical retained document origin; a quoted query
  gets URL percent serialization (`%22`), with one HTML attribute decode.
- Rich text entity canonicalization by HTML5 serialization, while inert helpers
  preserve original lexical entity spelling.
- Literal title quote encoding and removal of source stock-control IDs; ordinary
  class names survive. Native malformed attribute behavior is not reproduced.
- Unsafe script/data/about/entity-obfuscated URLs and event handlers are removed.
- Encountered unported lj/user/template, object/embed and custom user expansion
  capabilities refuse. No blanket installed-hook startup refusal is added.
  Source conditional embed hooks are not executed or guessed absent.

Source gaps/merged tokens must pass the existing maintained location/source audit;
unproved cases refuse instead of introducing another parser. Ordinary supported
formatting is not downgraded to plain text. New contexts are not a general
Markdown/editor or arbitrary legacy HTML parity claim.

## Reproduction and evidence boundaries

Run in the owning devcontainer. Existing Node24/bootstrap and package setup are
documented in [SLICE-4.md](SLICE-4.md); keep system Node unchanged.

```bash
cd "$LJHOME"
/opt/dw-node24/bin/node src/content/node_modules/typescript/bin/tsc -p src/content --noEmit
/opt/dw-node24/bin/node src/content/node_modules/typescript/bin/tsc -p src/content
cd src/s2/target/javascript
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
S10_RUN=$(mktemp -d "$PWD/artifacts/slice10-subjects.XXXXXX")
perl tools/live-compile.pl "$S10_RUN/stock.json"
/opt/dw-node24/bin/node ../../../content/tools/stage-runtime.mjs "$S10_RUN/stock.json"
/opt/dw-node24/bin/node --test dist/tools/subjects.test.js
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT="$S10_RUN/stock.json" \
    /opt/dw-node24/bin/node --test dist/tools/subjects-http.test.js
```

The fixed native driver exercises actual helpers/wrappers/currents with DB
tripwires. Actual SQL tests use the existing guarded temporary-schema fixture,
full finally cleanup, actual current child/Fastify Recent+Entry, private/usemask
exclusion, subject/property409 and exact restoration/subsequent200. They do not
write ordinary accounts. Existing feature tests and no-feature Perl bytes are
separate regression proofs. Historical410 and Entry62 semantic evidence is
preserved; fresh local attestations bind the current emitted implementation.

For the representative browser, first produce an ordinary native Entry oracle
with the current private config as in [SLICE-9.md](SLICE-9.md). Set the stock-page
path from its current `artifacts/live/entry-comparison.json`, not an assumed ID:

```bash
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT="$S10_RUN/stock.json" \
S2_SUBJECTS_STOCK_PAGE="$STOCK_ENTRY_PAGE" \
S2_SUBJECTS_BROWSER_OUTPUT="$S10_RUN/browser" \
    /opt/dw-node24/bin/node --test dist/tools/subjects-http.test.js
```

Chromium observes actual Entry HTTP, rich escaped-red/bold/italic, three metadata
values, OG title, removed active href/CSS and the exact declared safe subject-link
destination. Navigation is intercepted with an inert response, never fetched
externally. Only finite observed local stock assets are captured; temporary
fixture style44 maps to the separately qualified retained stock stylesheet.
Screenshot/report hashes bind that page. This is not full native feature-page
byte equality, binary resource-route parity or a new broad browser matrix.
