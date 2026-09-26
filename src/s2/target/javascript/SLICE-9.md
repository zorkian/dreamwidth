<!--
SLICE-9.md

Ordinary stock public sidebar and selected-entry tags and qualification.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Slice9: public sidebar and selected-entry tags

The private anonymous Recent/Entry viewer now renders the unchanged stock tag
module and selected public entry tags. Ordinary startup remains SELECT-only and
has no cache, request defenses, captcha, proxy signing, tag editing or local tag
filter page. Tag links and tag navigation go to the retained application.

## Data and privacy boundaries

`live/data/mysql.ts` reads owner usertags joined to userkeywords, logkwsum, and
logtags for selected public body IDs only. No associations/text are loaded for
private/usemask targets or the Recent lookahead. The primary snapshot and final
independent reread retain all owner definitions, summaries, selected tuples and
raw name byte digests, including below-cutoff facts. The existing global identity
bracket and optimistic final decision boundary remain unchanged.

Sidebar visibility comes from presence of uint64 bit63 in a security summary,
even when entryct=0; masks use decimal strings/BigInt. Display must be true. Only
public counts enter TagDetail/security_counts, never private/protected/group
counts. Selected public associations instead authorize their own names using
unfiltered owner taxonomy, regardless of sidebar summary visibility or display.
Those simple Tag objects contain no counts. Unassociated private-only names stay
in the parent. Foreign journal IDs never qualify through a matching kwid/jitemid.

Each definition/summary/selected-association query uses LIMIT10001 and refuses
more than10000 rows, alongside existing text/child bounds. These are explicit
safety limits, not native account quotas. Malformed or unusable owner taxonomy can
refuse the whole page even when unrelated to selected entries; this is a stricter
malformed-data boundary. Missing selected taxonomy/keywords and
false names producing undefined native Tag/URL results refuse422; no invented
name or silent selected-tag dropping. kwid0 also refuses. Dangling summary rows
are ignored for projection as native does, but remain fingerprinted.

## Source behavior and deliberate adaptation

Sources are `cgi-bin/LJ/Tags.pm`118-241,260-302,400-451,1718-1735;
`cgi-bin/LJ/S2.pm`1955-2073,2277-2280,4611-4648; `LJ/TextUtil.pm`141-148;
and stock `styles/core2.s2`4086-4110,4512-4548,5406-5437.

Names are escaped once with ehtml. URLs re-encode decoded native source as UTF8
bytes before eurl: spaces+, literal plus%2B, retained slash/backslash/colon/comma,
with slash/backslash or%2B selecting ?tag= rather than /tag/. Flagged codepoint
Perl strings have different URL behavior; they are a diagnostic counterexample,
not the native database representation. Escaped-name comparison uses UTF8 bytes,
not JavaScript UTF16 order (U+E000 sorts before an astral emoji).

The native popularity cutoff has hash-iteration ties. This viewer explicitly
uses popularity descending, escaped-name UTF8 bytes, then kwid before the cutoff;
final display sorts escaped-name bytes. Ordinary ties are supported. This is a
deterministic nondeterminism adaptation, not universal native byte parity at a
tied cutoff. The stock callback's actual limit is used (default module50).

`tagsEnabled` and `tagListHookConfigured` are exported as real guarded config
facts; re-export/restart after config changes. Disabled tags project no tags.
An unported augment_s2_tag_list hook refuses only when a selected entry reaches
TagList, even with disabled tags/empty input. Empty Recent and sidebar alone do
not reach it. The reached viewer_can_manage_tags is false for this anonymous
viewer: S2.pm3049-3055 -> User/Login.pm396-403 returns without account lookup
when no remote exists. No authenticated permission behavior is implemented.

Only the retained tag-nav /go query shape is added: dir, canonical itemid/journal,
then one canonical encodeURIComponent redir_key within4096UTF8 bytes, no controls.
It receives307 to the configured app origin; arbitrary extra params, malformed
encodings and local tag/query rendering remain unsupported. Stock
`htdocs/js/journals/jquery.tag-nav.js`56-62 constructs that destination.

## Reproduction in the owning devcontainer

Use the Node24/private startup setup in [SLICE-6.md](SLICE-6.md), with the content
package built and normal S2 emit. Re-export site.json to include both tag facts.
From src/s2/target/javascript:

```bash
mkdir -p artifacts
S9_RUN=$(mktemp -d "$PWD/artifacts/slice9-tags.XXXXXX")
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
perl tools/live-compile.pl "$S9_RUN/stock.json"
/opt/dw-node24/bin/node ../../../content/tools/stage-runtime.mjs "$S9_RUN/stock.json"
perl -I"$LJHOME/cgi-bin" tools/site-config.pl --output "$S9_RUN/site.json" \
    --artifact "$S9_RUN/stock.json" \
    --app-origin http://localhost:8080 --listen-origin http://localhost:8081 \
    --listen-host 127.0.0.1 --listen-port 8081 \
    --local-socket /var/run/mysqld/mysqld.sock
/opt/dw-node24/bin/node --test dist/tools/tags.test.js dist/tools/site-config.test.js
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT="$S9_RUN/stock.json" \
    /opt/dw-node24/bin/node --test dist/tools/tags-http.test.js
```

The native helper driver uses explicit synthetic taxonomy, masks and association
responses with a DB connection tripwire. It independently proves native public
zero-count/mixed-count semantics, selected private-summary/display-off names,
UTF8 URLs/order, disabled hook reachability and malformed/false scalar outcomes.
The actual isolated SQL/current-child/HTTP test separately proves both pages,
wire privacy, foreign/private/usemask/lookahead isolation, mask/count/name/tuple
changes during rendering409, exact restoration/subsequent200 and missing-name422.
Its guarded isolated schemas are removed in finally; ordinary account data is
not mutated.

One representative actual Entry browser uses installed Chromium and exact local
stock resource capture (fixture style44 explicitly mapped to retained qualified
stock style). No blanket external fulfillment or remote navigation submission:

```bash
S2_SITE_CONFIG="$S9_RUN/site.json" \
    /opt/dw-node24/bin/node dist/tools/check-live.js entry-compare
S9_STOCK_ID=$(/opt/dw-node24/bin/node -p \
    'require("./artifacts/live/entry-comparison.json").results[0].ditemid')
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT="$S9_RUN/stock.json" \
    S2_TAGS_STOCK_PAGE="$PWD/artifacts/live/entry-oracle-${S9_STOCK_ID}-one/page-oracle.html" \
    S2_TAGS_BROWSER_OUTPUT="$S9_RUN/browser" \
    /opt/dw-node24/bin/node --test dist/tools/tags-http.test.js
```

DOM tag text/href destinations and the actual stock widget's computed /go URL are
checked; that exact navigation is intercepted inertly. The HTTP test independently
checks the actual307 Location. Only four exact script-created local tag-nav image
paths supplement emitted resource capture. Screenshot and hash/resource report
are ignored evidence. This is not binary-resource route or full native
positive-feature page parity. No-feature Recent/Entry native bytes, userpic/link
regressions, existing runtime fixtures and immutable410/Entry62 remain separate
regression gates; unchanged cleaner/browser evidence carries without a new matrix.

Current rich subjects and textual entry currents: [SLICE-10.md](SLICE-10.md).
