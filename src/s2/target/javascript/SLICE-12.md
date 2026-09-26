<!--
SLICE-12.md

Selected anonymous crosspost links from bounded native binary properties.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Selected crosspost metadata

The unchanged stock Recent/Entry pages can display selected public-entry crosspost
links. [SLICE-6.md](SLICE-6.md) describes configured-primary private startup;
[SLICE-11.md](SLICE-11.md) covers numeric moods and coordinates. Cache, request
defenses and image proxy remain deferred. This adds no external-account lookup,
credential export, networking, dependency, page type or style execution.

## Native source and binary boundary

[DW::External::Account](../../../../cgi-bin/DW/External/Account.pm)145-170,298-313
writes **both** `xpost` and `xpostdetail` using `Storable::nfreeze`. Both selected
properties bypass UTF8 text decoding: verified legacy latin1/cp1252 connection
reversal preserves original bytes, stored bytes and roundtrip proofs in the full
fingerprint/reread. Other property decoding is unchanged. `xpost` is an opaque
parent-only base64 field, never decoded or sent to the renderer. Detail alone
supplies display links. Private/usemask/foreign properties are never selected.

[LJ::currents](../../../../cgi-bin/LJ/Entry.pm)2894-2906 thaws detail and iterates
account hash values. [LJXMLRPC](../../../../cgi-bin/DW/External/XPostProtocol/LJXMLRPC.pm)
240-247 supplies `itemid` and optional `url`; no account credentials are needed.
Missing/undef account or missing/empty/Perl-false URL yields no link. `itemid`
does not authorize links or leave the parent.

The finite decoder accepts network format2.11/header050b, plain root hash,
account undef or REF followed by plain hash, and scalar `itemid`/`url` fields.
It accepts small/network integers, undef and short/long byte/UTF8 strings.
Source: [matching Perl5.34.0 Storable.xs](https://github.com/Perl/perl5/blob/v5.34.0/dist/Storable/Storable.xs),
opcodes168-192, version1010-1025, lengths1072-1155, scalar2531-2561,
hash3157+/6464-6534. Hash values precede length-prefixed keys.

No general thaw, recursive graph reader, object registry or code execution is
implemented. Unknown versions/opcodes, duplicate/noncanonical account keys,
duplicate/extra reference fields, aliases, blessings/hooks, arrays, arbitrary
references, malformed lengths/counts or trailing bytes refuse. Source accepts
some of these, so these are explicit representation/validation boundaries.
Counts are bounded by remaining bytes before iteration/allocation; depth is
fixed by the two-hash schema. Each binary field is capped at8192 original bytes;
cp1252-expanded stored bytes have a separate24576 bound. This is a viewer resource
ceiling, **not** native storage capacity: existing `logprop2.value` VARCHAR255 may
truncate larger writes. Truncated detail fails closed.

## URL, ordering and output differences

Native `no_utf8_flag` keeps underlying URL bytes. Flagged Unicode and unflagged
valid UTF8 bytes yield the same text/destination under UTF8 browser decoding.
Invalid UTF8 bytes refuse here; native browser replacement can change destinations.
Truthy nonstring URL values refuse. Stable numeric account-ID order using BigInt
replaces native hash-iteration nondeterminism; it is not native ordering equality.

Approved raw URL strings alone reach the child. Existing navigation safety rejects
active/control/data destinations. Parent validates resolution against the approved
canonical entry context; child uses that same context to resolve relative hrefs,
an explicit canonical-origin adaptation. Labels retain the original URL spelling.
The child applies `ehtml` exactly once to href and label, independently, without
the subject/body cleaner. Native raw single-quoted href injection is deliberately
corrected. Quotes, angle brackets and entity-looking URLs remain data; neither
labels nor source HTML supply capabilities or attributes. No external URLs are
fetched by the renderer.

## Focused reproduction

Inside the owning devcontainer, use the Node24 bootstrap/build prerequisites from
earlier guides. No installation or account writes are needed for these additions.

```bash
cd "$LJHOME/src/content"
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
cd "$LJHOME/src/s2/target/javascript"
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
S12_RUN=$(mktemp -d "$PWD/artifacts/slice12-xposts.XXXXXX")
cd "$LJHOME"
perl src/s2/target/javascript/tools/live-compile.pl "$S12_RUN/stock.json"
/opt/dw-node24/bin/node src/content/tools/stage-runtime.mjs "$S12_RUN/stock.json"
cd src/s2/target/javascript
/opt/dw-node24/bin/node --test dist/tools/crossposts.test.js
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT="$S12_RUN/stock.json" \
    /opt/dw-node24/bin/node --test dist/tools/crossposts-http.test.js
```

Native21 records use actual Account serializer and retained currents with DB
read/write tripwires and fixed hashseed0/perturb0. Expected fields are independent
of the decoder. They cover scalar encodings, Unicode/bytes, false/undef, aliases,
blessings, malformed shape, bounds and full-consumption differences. Actual guarded
three-schema fixtures contain BOTH properties, private invalid binary and foreign
same-ID data; they check current child Recent/Entry output, each binary mutation
during rendering409, exact restored fingerprint/subsequent200 and fixed refusals.

For the representative Chromium actual TS Entry, select an existing native Entry
HTML from current `artifacts/live/entry-comparison.json`, not an assumed account ID:

```bash
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT="$S12_RUN/stock.json" \
S2_XPOST_STOCK_PAGE="$PWD/artifacts/live/entry-oracle-<current-id>-one/page-oracle.html" \
S2_XPOST_BROWSER_OUTPUT="$S12_RUN/browser" \
    /opt/dw-node24/bin/node --test dist/tools/crossposts-http.test.js
```

Only finite emitted stock assets are captured from the retained local app;
fixture style44 is explicitly mapped to its qualified stock stylesheet. Crosspost
destinations are observed without navigating/fetching external links. Unexpected
resources/WebSockets/page errors fail. The screenshot/report proves labels,
destinations, one-decode entities and absence of injected attributes. This is not
native full feature-page byte equality or binary resource-route parity. Existing
no-feature parity and unchanged410/Entry62 remain separate regression gates.

Customtext remains subsequent work: minimal property-only user layer plus its
distinct html_casual context is necessary to enable the default-hidden stock
module. It is not implemented by loading stored text alone.
