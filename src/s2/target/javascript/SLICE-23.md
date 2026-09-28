<!--
SLICE-23.md

Bounded userpic sizes and entry metadata placement.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Picture and metadata presentation

Historical qualification only: after the source-only cleanup, the retained
old server refuses selected journal user layers. Their settings are S2
source; the approved general server must compile that source and is not yet
wired to startup. No stored generated Perl reader remains in serving.

The private Recent/Entry viewer additionally supports four string literals in
the existing fully consumed property-only compiled wrapper:

| Property | Supported values |
| --- | --- |
| `entry_userpic_style` | empty, `small`, `smaller` |
| `comment_userpic_style` | empty, `small`, `smaller` |
| `userpics_position` | `left`, `right`, `none` |
| `entry_metadata_position` | `top`, `bottom` |

The prior44 literals remain supported. The native compiler does not enforce UI
choices: this viewer explicitly refuses other stored values with422. Native
unknown size uses full image dimensions; unknown position still selects pictures
without selecting an EasyRead positioning branch. Native unknown metadata
position omits metadata entirely. The viewer does not silently substitute a
supported value or claim native equality for these subset refusals.

## Unchanged source behavior

Picture sizes use retained full/75%/50% arithmetic. For an odd101x99 public
picture, native model dimensions and serialized height/width attributes are
101x99,75.75x74.25 and50.5x49.5. No integer rounding is introduced. Browser used
dimensions are measured separately and compared against the same retained
attribute spelling; decimal attributes do not promise fractional CSS layout.
Entry and visible-comment sizes remain independent.

`none` omits only Entry/comment model images. The journal default/profile image
stays independently visible. Entry OG calls the selected userpic independently
(EntryPage.pm121-127), so its URL, source helper/hook facts and freshness are
retained even when the displayed entry picture is omitted. Selected public
picture facts may still be loaded/fingerprinted; this is presentation support,
not a new privacy/data-selection policy. Hidden/screened/suspended comment and
private-entry protections remain unchanged.

Final native property initialization precedes model preparation. Unchanged
stock CSS selects layout-specific left/right alignment and offsets, while stock
Page::print_entry places already-cleaned metadata before or after the body by
exact top/bottom comparison. No new metadata cleaner, URL authority or HTML
membership is added. Existing prepared Image construction already mirrors the
native arithmetic and keeps journal defaults independent of display position.

New keys use the qualified current-child inline stylesheet path, with the
existing Tabula themes or EasyRead+Aqua. Existing stylesheet safety, four
EasyRead malformed-font forms, token-closure proof and exact omission inventory
are unchanged. No CSS URL/function/resource allowance, visual repair, compiler
or runtime change. Source/compiled/owner/parent/comptime and final reread remain
mandatory; changed compiled presentation during render produces409.

## Reproduction and evidence

Follow [SLICE-22.md](SLICE-22.md) and its linked Node24/private-config/build
instructions. Full ordinary emit must precede a fresh closed stage of the same
artifact compiled with `tools/live-compile.pl --easyread`. Set
`S2_LIVE_TEST_ARTIFACT` to that artifact, `S2_SELECTED_FIXTURE=1` for isolated SQL
fixtures, and optionally `S2_STYLES_BROWSER_OUTPUT` to a fresh ignored directory.
Run current `styles-native.test.js` and `styles-http.test.js`.

Compact native helpers preserve fixed odd-dimension/serialized-attribute
expectations and a four-property compiled wrapper with both stock CSS outputs.
Actual selected SQL/child/HTTP tests cover Recent/Entry, a visible registered
comment, top/bottom metadata order, independent sizes, none with profile+OG
retained, unknown values422, compiled mutation409 and restored200. Existing
hidden comment and privacy assertions remain active.

The representative browser test captures only observed finite local stock
resources. Exactly the declared configured userpic URL is fulfilled with a
hashed inert fixture PNG; no wildcard, prefix grant or external fetch. Browser
observations prove URL selection, attributes, used dimensions and layout, not
native image binary-route parity. Independent native numeric/HTML facts remain
separate from browser output. Generated screenshots/wrappers/reports stay
ignored evidence; no tracked generated dump or golden replacement.
