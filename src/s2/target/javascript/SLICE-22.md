<!--
SLICE-22.md

Bounded base typography and exact native-invalid stock stylesheet forms.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Base typography

Historical qualification only: after the source-only cleanup, the retained
old server refuses selected journal user layers. Their settings are S2
source; the approved general server must compile that source and is not yet
wired to startup. No stored generated Perl reader remains in serving.

The private Recent/Entry viewer additionally admits exactly `font_fallback`,
`font_base_size` and `font_base_units` as string literals in the existing fully
consumed property-only compiled wrapper. The prior41 literals remain supported.
Owner, parent, source, compiled bytes and compile time retain the same bounded
snapshot and final reread. Executable layers, unknown properties/types and font
source URLs remain unsupported.

Unchanged stock `generate_font_css` uses specific, base and fallback families in
that order. A family emits only if any is nonempty. Size emits only if both size
and units are nonempty, using their original concatenation. Final initialized
values determine the shape, rather than property presence. Units alone do not
emit a size. At actual child CSS emission, all seven font contexts prove every
emitted family piece using the existing token-closed CSS Tree family proof; an
emitted size uses the same maintained `font-size` lexer/token proof. Missing
callbacks, malformed or unprovable emitted scalars refuse the whole page422.
Closed comments, unclosed strings and trailing escapes refuse; original bytes
are never normalized. An un-emitted size is not unnecessarily rejected.

## EasyRead+Aqua native-invalid forms

The child computes the exact page-font expectation by calling the unchanged
stock generator on final values, and qualifies the first entry-color declaration
through unchanged `generate_color_css`. Only the selected EasyRead+Aqua path
accepts this expectation. CSS Tree source locations, exact framing/selectors,
colon-error offsets, counts and Raw values must match before any omission:

| Generated page font | Browser-ignored form omitted | Preserved behavior |
| --- | --- | --- |
| Family and size | Two doubled family declarations and body separator | Valid independent size siblings remain |
| Family only | Two doubled family declarations and body separator | No invented size |
| Size only | Two outer family declarations containing the size; body separator | Embedded size is lost, not repaired |
| Neither | Empty body family and container family that swallowed the first `color: #cdc1ac` | First container color remains lost; following background/padding and body color remain |

The first three forms have exactly two colon errors/two font Raw values and one
body separator. The last has one colon error/one font Raw and no separator.
Unchanged empty hover-color and invalid `:first` rule omissions remain fixed.
Unknown locations/counts/forms refuse. Raw URL/hook guards precede omission;
strict reparse and the existing complete stylesheet safety policy follow it.
Historical pages without these three keys retain the prior fixed1em inventory.
Tabula uses its valid direct stock declarations without EasyRead omissions.
No font or color is repaired and no generic Raw recovery is admitted.

Native CSSOM qualification demonstrates Times New Roman body fallback for all
four EasyRead forms. Family+size retains relative sizes (native20px body and25px
containers for1.25em); size-only remains16px. In the neither form the container
inherits body color: changing body color in a diagnostic changes its color,
while the other forms retain their explicit entry color. Matching default colors
alone would hide this native loss. Module/entry fonts retain native fallback
order; journal title/subtitle retain APHont first where configured by stock.
This is an exact bounded stock selection, not general layout/CSS parity.

## Reproduction and evidence

Use the Node24/private-config/build and finite catalog staging instructions in
[SLICE-21.md](SLICE-21.md). Full content build and ordinary S2 emit must precede a
fresh closed stage of the artifact compiled with `tools/live-compile.pl
--easyread`. Export `S2_LIVE_TEST_ARTIFACT` to that same artifact for the tests;
set `S2_SELECTED_FIXTURE=1` for the isolated SQL fixture and optionally
`S2_STYLES_BROWSER_OUTPUT` to a fresh ignored output directory. Run current
`styles-native.test.js` and `styles-http.test.js`; owning-site config is exported
without DB access by the existing test. Exact resource capture stays restricted
to declared local stock resources; screenshots prove CSS/layout, not binary
resource-route parity. Tests retain compiled mutation409/restored200, scalar
injection422/normal recovery and the selected private/hidden boundaries.

Generated wrappers, original CSS, parser/CSSOM reports and screenshots remain
ignored evidence. Independent fixed native expectations remain in the existing
compact test driver rather than tracked generated dumps.
