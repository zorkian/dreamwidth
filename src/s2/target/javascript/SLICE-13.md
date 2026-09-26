<!--
SLICE-13.md

Property-only user layers and visible customtext in the private stock viewer.

Authors:
     Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Visible customtext

The private anonymous Recent/Entry viewer supports one journal-owned user layer
on the unchanged core2/core2base layout. It supports these six properties together:

| Property | Type |
| --- | --- |
| `module_customtext_show` | boolean |
| `module_customtext_order` | integer |
| `module_customtext_section` | string |
| `text_module_customtext` | string |
| `text_module_customtext_url` | string |
| `text_module_customtext_content` | string |

Stored `customtext_title`, `customtext_url`, and `customtext_content` are also
read from normal public settings. Stock functions decide visibility and placement;
there is no new layout or custom executable code. Other properties, layer types,
functions, classes, property declarations, expressions and references remain
unsupported for a selected user layer. The entire unsupported layer refuses;
settings are never silently discarded.

## Compiled data authority

`LJ::S2::load_layers` (cgi-bin/LJ/S2.pm:458-548) loads the owner's clustered
`s2compiled2.compdata`, decompresses it and calls `S2::load_layer`. Native loading
does not compare source. The viewer therefore reads exactly the selected owner's
compiled record and interprets its fully consumed canonical property-only wrapper
as inert data. It never evaluates stored Perl or compiles stored S2.

The wrapper must have the exact native framing, one matching `register_layer`,
literal `set_layer_info` statements and typed literal `register_set` statements.
Duplicate sets preserve native last-wins order. Allowed metadata keys are type,
name, des, author, author_name and author_email; type must end as user. Strings
must re-encode exactly with native compiler escapes. Unexpected syntax, metadata,
noncanonical numeric forms and trailing bytes refuse. The pinned stock compiler's
property metadata independently checks each admitted value's type in the child.

Owner identity, cluster, style map, native layer type, exact qualified parent,
source hash/presence, compiled bytes and compilation time are freshness inputs.
Source is not interpreted or claimed equal to compiled data: a changed source
revokes an in-flight render, while a subsequent request with unchanged compiled
bytes still uses the old executed values. Missing source/compiled rows refuse.
Only a selected user layer adds `s2compiled2` to the required InnoDB table list;
there is no engine downgrade or query into another owner's compiled layer.
Stored and decompressed MEDIUMBLOB bytes are bounded and fingerprinted directly,
without applying the legacy text-column latin1 reversal to this binary column.

Limits are 64KiB compiled input/output, 256 statements, 64KiB stored customtext
scalar values, and absolute module index 10,000. These are resource limits, not
native account limits. Gzip decompression has an explicit output ceiling.

## Placement and cleaning

The engine provisions each module section with a local Array representation.
Its set trap resolves negative indices against that array's length at assignment
time. Thus negative orders can overwrite an earlier module, as native does;
negative indices before the start of an empty section refuse. Positive none or
unknown sections can remain invisible. No order is normalized ahead of stock
`modules_init`, and no compiler or general runtime array behavior changes.

Customtext has a distinct credential-free `html_casual1` operation using the
existing maintained DOM/CSS/sanitizer machinery. Ordinary rich formatting,
inline CSS, HTTP(S) text autolinks, email and escaped-at literals work. Autolinks
are excluded inside anchors; linebreaks follow native raw/table context rules, followed by
the separate native global LF-to-br step, including preformatted text. Leading
ASCII whitespace lost by HTML5 document parsing is source-restored in this
context; the historical entry-body whitespace adaptation does not apply here.

Native property HTML cleaning precedes Page preparation. When stored content is
Perl-false (undefined, empty or string 0), its already-cleaned property default
undergoes a real second clean. Escaped-at text can therefore reach a mention only
on that second pass and refuse. Encountered mentions, legacy Markdown markers,
custom application tags/cuts/embeds and other unported capabilities refuse;
email is not treated as a mention. Scripts are removed safely rather than causing
an invented formatting refusal. Newline-bearing attributes refuse as an
unrepresentable native final-string-transformation shape.

Plain title/URL cleaning escapes only angle brackets and LF, separately from
ehtml. Content/URL use property defaults for Perl-false stored values. Title uses
its default only for undefined, empty or Custom Text; string 0 remains a title.
Active/control/data URLs and malformed raw doublequote URL wrappers refuse.
Only the already-qualified safePrint amp/quot/lt/gt/#39 attribute entities are
admitted in module URLs; other entity spellings refuse. Values are decoded once
for navigation validation, never recursively. Native raw quote wrappers can
create malformed extra attributes; the viewer does not reproduce that behavior.

Named serialization/security adaptations in this context include maintained
void-tag spelling (`<br>` versus native `<br />`), safe entity serialization in
autolink text/attributes, canonical document-origin resolution for relative URLs,
and the existing CSS containment/unsafe URL/DOM-clobber defenses. These are not
unconditional byte-equivalence or arbitrary caller-stylesheet claims. See
[CLEANER-POLICY.md](live/tests/CLEANER-POLICY.md) for the underlying safety policy.

Stock prints the finalized customtext HTML as one separate safe chunk. The engine
captures only that completed child-cleaner result in immutable exact-byte
membership. It never authorizes a raw property, prefix, substring, or later Page
assignment. All other safe chunks retain `cleanTrustedSafeChunk`. Native probes
confirm ordinary sanitized inline CSS and br/anchor chunks survive native
HTMLCleaner. There is no generic runtime serializer expansion or grant change.

The native Page persists substituted defaults with set_prop. This SELECT-only
viewer computes them without writes: later layer changes can affect false stored
defaults until a native render persists them. Fresh authoritative reads also
differ from native process/memcache windows. Cache/request defenses/proxy remain
deferred private-viewer scope; no production-serving claim is made.

## Reproduction and evidence

Run in the owning devcontainer after the Node24 bootstrap and normal content/S2
strict builds described in [SLICE-6.md](SLICE-6.md). Build and stage a fresh artifact,
then run the bounded tests:

```sh
cd "$LJHOME/src/s2/target/javascript"
mkdir -p /tmp/customtext-check
perl tools/live-compile.pl /tmp/customtext-check/stock.json
/opt/dw-node24/bin/node ../../../content/tools/stage-runtime.mjs /tmp/customtext-check/stock.json
S2_LIVE_TEST_ARTIFACT=/tmp/customtext-check/stock.json S2_SELECTED_FIXTURE=1 \
  /opt/dw-node24/bin/node --test dist/tools/customtext.test.js dist/tools/customtext-http.test.js
```

The native helper compiles trusted synthetic layers offline, actually loads them,
and records literal/duplicate/escaping, plain/HTML/twice-cleaned values, false
fallback and twenty stock module placements. Its DB tripwires forbid accesses.
Placement tests compare visible module identity at each exact array index; native
null holes and engine empty/provisioned containers are not claimed byte-identical.
Test-only observer/mutant artifacts explicitly fail production hash validation.
Changed/unregistered safe chunks fail even after later Page mutation.

Actual SQL tests use the existing guarded disposable schemas, not ordinary account
writes. They exercise Recent/Entry stock children, rich inline CSS/autolinks,
source/map/compiled/settings in-flight revocation, stale-source executed values,
malformed records, foreign owner refusal and exact restored fingerprints.
Normal fixture teardown remains in finally. The existing previous-feature suite,
410 Recent cases, 62 Entry cases and no-feature HTML comparisons remain separate
regression gates; native helpers alone do not prove whole-page byte parity.

For the one representative actual Chromium page, install/qualify the pinned
browser as documented in src/content/README.md, set `S2_CUSTOMTEXT_BROWSER_OUTPUT`
to an ignored output directory and `S2_CUSTOMTEXT_STOCK_PAGE` to a current retained
Entry oracle HTML from entry-comparison. The browser maps fixture style44 to that
same qualified stock stylesheet and intercepts only the exact observed local
resource closure. It verifies red computed color, safe autolink destination,
literal email, absent handlers and captures a screenshot. This explicit resource
mapping is not native binary route parity or external-fetch permission.
