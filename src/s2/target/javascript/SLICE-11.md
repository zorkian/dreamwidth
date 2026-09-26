<!--
SLICE-11.md

Selected numeric moods, theme icons and coordinate currents for the private viewer.

Authors:
     Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Numeric moods, icons and coordinates

This extends the same unchanged stock anonymous Recent/Entry private viewer.
[SLICE-10.md](SLICE-10.md) describes rich subjects and textual currents;
[SLICE-6.md](SLICE-6.md) describes ordinary configured-primary startup.
Cache, request defenses and image proxy remain explicitly deferred. No new
page type, style execution, cleaner rule, dependency or runtime permission is added.

## Source behavior and boundaries

[LJ::currents](../../../../cgi-bin/LJ/Entry.pm)2837-2891 keeps the Mood key whenever
custom mood or numeric mood is Perl-true. The child prepares custom text with the
existing subject cleaner. Its Perl-true result wins (cleaned `0` is false); otherwise the numeric name
is used. A numeric mood still requests its icon even when custom text wins.
A missing mood name/theme/icon does not discard an existing metadata key.

[DW::Mood](../../../../cgi-bin/DW/Mood.pm)26-29,103-213 loads the requested mood
and parents, the selected account's theme name, and reachable theme pictures.
The loader reads only selected public-entry chains, not unrelated vocabulary or
other accounts' themes. Theme `is_public` is not an authorization filter in the
native selected-account helper. Missing or Perl-false theme name yields no icon
in this DB-only viewer. The native false-theme probe assumes successful cache set;
native cache-failure behavior is not reproduced by the deferred-cache viewer.
Names, parent links, theme presence/name, picture URL/dimensions and raw text-byte
proofs are included in the fingerprint and independent final request reread.
Required tables use the existing configured-primary InnoDB/read-only qualification.
The mood read shares the final global bracket transaction; there is no distributed
atomicity or arbitrary ABA claim.

The first reachable picture wins. Relative `/img` prefix is removed before
prepending configured `imgPrefix`; other leading paths are simply prepended.
Native invalid HTTP URL becomes `#invalid`; zero width/height remain native fields.
The viewer's strict end and JavaScript whitespace safety check also makes icon URLs
with trailing LF or NBSP `#invalid`, differing from native byte-regex acceptance.
The exact retained HTTP/last-two-label regex and exported case-sensitive
`siteDomain`/`knownHttpsSites` control HTTPS upgrades. When native would proxy an
otherwise safe original URL, this private viewer keeps that URL: no signing,
salt access or fetch, and no production proxy/mixed-content parity claim.

Selected facts/traversal are capped at 10,000 rows/visited IDs, a safety boundary,
not a native account quota. A parent cycle that native would hang on refuses.
Noncanonical/out-of-range numeric mood IDs and active/control markup in vocabulary
names refuse explicitly, rather than silently coercing hash keys or applying the
custom-subject cleaner to native numeric names. Unrelated facts do not enter child
render data; only numeric fallback name and selected Image fields are projected.

[LJ::Location](../../../../cgi-bin/LJ/Location.pm)20-77 accepts decimal signed pairs
or decimal N/S and E/W forms and checks latitude/longitude bounds. Valid textual
location wins only after construction succeeds. Malformed/range coordinates are
caught by native `currents`, which retains Location with an undefined value; the
model keeps the empty key and stock empty-wrapper behavior. Raw false `0` does not
invoke coordinate parsing. Decimal strings `0.0` and `-0.0` are Perl-true, so their
four-decimal outputs and negative zero are retained. Hemisphere S/W unary minus
converts to numeric scalars: a zero/zero S/W pair yields an empty existing key,
while N/E captures retain decimal-string truthiness. Formatting rounds the exact
IEEE-754 rational to four decimals with half-even ties, not JavaScript `toFixed`:
`0.03125` -> `0.0312`, `-0.03125` -> `-0.0312`.

Crosspost Storable binary is still an explicit subsequent dependency. Visible
customtext needs property-only user-layer support plus its distinct html_casual
cleaner context; merely loading stored text would not enable the default-hidden
stock module. Neither is implemented here.

## Focused reproduction

Commands run inside the owning devcontainer, after the Node24/bootstrap and normal
build prerequisites in the previous guides. Existing private setup/grants must
include SELECT on global `moods`, `moodthemes`, `moodthemedata`; the serving path
never grants privileges or writes accounts. The development-only grant helper
includes these tables and preserves its denied-write checks.

```bash
cd "$LJHOME/src/content"
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
cd "$LJHOME/src/s2/target/javascript"
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
S11_RUN=$(mktemp -d "$PWD/artifacts/slice11-moods.XXXXXX")
cd "$LJHOME"
perl src/s2/target/javascript/tools/live-compile.pl "$S11_RUN/stock.json"
/opt/dw-node24/bin/node src/content/tools/stage-runtime.mjs "$S11_RUN/stock.json"
cd src/s2/target/javascript
/opt/dw-node24/bin/node --test dist/tools/moods.test.js
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT="$S11_RUN/stock.json" \
    /opt/dw-node24/bin/node --test dist/tools/moods-http.test.js
```

The compact native probe uses actual retained helpers with synthetic reader rows,
a write tripwire and no actual database access. Its 31 cases include inherited,
missing/false themes, cleaned-empty custom fallback, invalid/relative icons,
coordinate failure/key presence, decimal/negative zero and exact positive/negative
ties. A one-second temporary native alarm demonstrates the unbounded cycle; it is
not described as native refusal. Actual fixture tests use the existing guarded
three-schema setup/finally cleanup, current closed child and real loopback HTTP:
Recent/Entry, private/usemask and foreign isolation, theme/parent/coordinate changes
during rendering ->409, exact fingerprint restoration and subsequent200.

For the representative actual Entry browser, first generate an ordinary native
Entry oracle as in the previous guide. Choose its actual HTML path using current
`artifacts/live/entry-comparison.json`, never an assumed owner-specific ID:

```bash
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT="$S11_RUN/stock.json" \
S2_MOODS_STOCK_PAGE="$PWD/artifacts/live/entry-oracle-<current-id>-one/page-oracle.html" \
S2_MOODS_BROWSER_OUTPUT="$S11_RUN/browser" \
    /opt/dw-node24/bin/node --test dist/tools/moods-http.test.js
```

Chromium verifies the actual TS Entry's icon URL, declared16x16 dimensions,
loaded inert image and visible half-even coordinate text, plus screenshot.
Only the exact declared synthetic icon is fulfilled with an inert PNG; finite
observed stock assets are captured from the retained local app. Fixture style44
maps to the matching qualified stock stylesheet, recorded explicitly. Unexpected
resources, WebSockets and page errors fail. This is not native binary resource-route
parity or a full native feature-page byte comparison. No-feature Recent/Entry bytes,
prior ordinary features and unchanged410/Entry62 outcomes remain separate gates.
