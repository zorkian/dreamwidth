<!--
SLICE-3.md

Local live stock S2 journal guide.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# S2 JavaScript slice 3: local live journal

This slice serves one anonymous recent page for the dedicated s2js_slice3
development journal. The source stack is unchanged core2 plus
core2base/layout. The service reads a local MySQL primary snapshot and runs
compiled stock S2 JavaScript. It does not call Perl or load an exported page
while rendering.

## Offline setup

Run from the repository root inside this worktree's devcontainer:

~~~sh
perl src/s2/target/javascript/tools/live-seed.pl
perl src/s2/target/javascript/tools/live-config.pl
perl src/s2/target/javascript/tools/live-grants.pl
~~~

The seed uses normal app helpers to create or verify the marked personal
account, exact stock layers, and two public html_raw0 posts. It refuses an
unmarked collision. The optional --other argument creates only the second
marked isolation account. Normal posting helpers may enqueue local feed and
notification work and update account counters. The seed also asks the normal
secret helper to prepare the current hourly signing key; no key is printed.

The config helper reads local public app globals without loading app.psgi or
issuing a journal GET. It asserts anonymous CAPTCHA is off, the dev site root
is empty, and the recent scrollback limit is 100. It writes ignored
artifacts/live/public-config.json, with the original app at
http://localhost:8080 and the separate TypeScript listener at
http://localhost:8081. Do this before the first TypeScript request.

The grants helper uses the local administrator socket offline to create one
s2js_slice3_ro account with SELECT on the exact global and cluster tables
needed by the loader. It verifies no schema, global, or column privileges and
that UPDATE is denied. The ignored artifacts/live/mysql-readonly.json file
has mode 0600 and contains the serving credential. The script can repair its
own partial grant setup if that file exists; it refuses an existing account
without its owned credential file. Never pass this file or its contents to
a renderer child, HTTP response, log, or screenshot.

The first live TypeScript GET must happen before any live-oracle.pl GET on
that account. A retained Perl GET can persist default customtext props; the
TypeScript path must derive absent defaults read-only. Use a fresh local
devcontainer database for the first-request proof. No data reset is needed
for ordinary later comparisons.

## Raw snapshot and consistency

live/data/mysql.ts opens only 127.0.0.1:3306 with the exact scoped account.
It verifies MySQL 8, a writable local primary, and the required dw_global
and dw_cluster01 tables as InnoDB. Each load pins one connection and uses a
repeatable-read, read-only consistent snapshot across both schemas. It
loads at most 200 complete candidate entries, including private, masked,
and suspended rows, before policy decides what may be shown. User, poster,
style, property, text, and unsupported-feature reads are batched. Public
properties are read from global userprop, cluster userproplite2, and cluster
userpropblob with one duplicate check across all three sources.

The fingerprint includes identity mapping, loaded public settings and
status facts, the style stack and stock source hashes, layer owner usernames,
raw stored and recovered text bytes, decoded text, every candidate entry
and property, and each unsupported-feature count. Revalidation performs a
new independent primary snapshot after rendering. A changed or unsupported
state fails before HTML is sent. This decision does not claim atomicity with
later database commits or network receipt.

The retained DBI connection speaks MySQL latin1 while application text is
UTF-8 bytes. MySQL latin1 maps the CP1252 range, including otherwise
undefined C1 bytes. An utf8mb4 stored value such as café can therefore
contain bytes 63 61 66 C3 83 C2 A9. For every rendered or fingerprinted
Perl text column, the loader reverses the connection conversion with
CONVERT(column USING latin1), verifies a lossless round trip back to the
stored bytes, then strictly decodes UTF-8. This includes names, bio, style
name, user properties, and entry properties. Blob backed user properties
hold raw bytes and are strictly decoded without connection reversal. The
fingerprint records both stored and recovered bytes. Gzip event bodies are
bounded before and after decompression. Invalid text, unknown conversion,
NULL required fields, and oversized data fail closed. The renderer receives
decoded approved text only.

Focused loader validation from src/s2/target/javascript:

~~~sh
npx tsc
node dist/live/data/snapshot.test.js
~~~

This checks real marked rows through the scoped credential, stock layer
hashes, UTF-8 and CP1252 edge bytes, bounded gzip, feature counts, and a
normal-helper name mutation and Unicode name, title, and blob property
mutations that revoke the fingerprint. The test restores each mutation in
finally blocks. Run this test after the first TS-before-Perl-GET proof on a
fresh database. If the test process is killed during a mutation, recover
only these exact owned variants with:

~~~sh
perl src/s2/target/javascript/tools/live-mutate.pl --restore
perl src/s2/target/javascript/tools/live-mutate.pl --restore-text
~~~

## Runtime boundaries and admitted cohort

The data layer alone uses Kysely/mysql2 and qualified MySQL tables. Frozen
UserRecord and EntryRecord classes carry decoded values; property access has
no SQL or network I/O. The policy layer checks the exact marked personal
journal, stock layer source hashes and dynamic system owner username, owner
and poster state, every candidate entry's security/status, and unsupported
feature counts before preparing public data. It filters private and usemask
entries before the renderer sees them. Suspended public entries and unknown
features fail the whole request. The finite anonymous route and navigation
redirect admission are policy owned; Fastify only applies their decisions.

Public body content is limited to bounded UTF-8 text and balanced lowercase
p/strong/em/b/i/br elements, without attributes or URLs. Only amp/lt/gt/quot
entities are admitted. A subject is nonempty plain text without markup,
entities, quotes or controls. Malformed HTML, script, URL attributes, legacy
encodings, tags, links, userpics, comments, sticky entries, custom layers
and unsupported settings are refused with a fixed response. This is a
development cohort, not a general journal compatibility claim.

The offline compiler derives schema 1 / ABI 1 source/hash/variable/code
records from the unchanged core2 and core2base/layout files. It does not
serialize a prepared page. On each request the renderer initializes stock
defaults and executes real Page.print in a bounded child. The owning
Linux x86_64 devcontainer uses a small seccomp launcher, Node permission
mode, no credential-bearing environment or database access, two children
maximum, 10-second deadline, 2MiB output and 128MiB heap. This isolates
trusted pinned stock code; it is not an arbitrary JavaScript hosting
sandbox. Restart the TS service after recompiling stock code or rebuilding
static resources, since the artifact and resource times load at startup.

The HTTP server maps malformed/unadmitted requests to fixed 400, absent
admitted data to 404, unsupported state to 422, changed final fingerprint
to 409, and unavailable work to 503. Every response uses private,no-store;
this transport cache policy deliberately differs from retained Perl's
private,proxy-revalidate. The HTML body is compared byte for byte under
recorded comparison inputs, while Date and transport header sets are not
required to match. HEAD runs the same authorization/render/recheck as GET,
keeps its Content-Length, and sends no body. POST control redirects happen
before body parsing; no form body, session cookie or credential enters the
recent renderer.

## Perl comparison oracle

After the first TypeScript request, the real retained app page may be
exported with live-oracle.pl. Ordinary two-argument mode uses live time and
randomness and records the complete HTTP body and response headers,
including normal anonymous Set-Cookie.

For byte comparison, set Perl hash order before process startup and provide
the fixed anonymous ljuniq cookie:

~~~sh
mkdir -p <output-directory>
PERL_HASH_SEED=0 PERL_PERTURB_KEYS=0 perl \
  src/s2/target/javascript/tools/live-oracle.pl \
  http://localhost:8080 <output-directory> \
  --comparison AAAAAAAAAAAAAAA:1790294400:x
~~~

The ordinary root oracle still requires both original seed subjects. The
bounded --cohort-variant switch is used only while the recorded empty or
mixed post probes are active; --skip 0..200 selects an explicit recent-page
query without changing the HTML. These switches never replay exported
content or normalize a response.

Comparison mode freezes only that GET at 2026-09-25 00:00:00 UTC and maps
the ten random form characters to aaaaaaaaaa. The real challenge is signed
with the local existing hourly key and verified by the retained checker.
Preparing that fixed past hour with LJ::get_secret may insert one local
secret row offline; the key is never exported. The explicit valid cookie
avoids additional uniq generation, so no Set-Cookie is expected in
comparison headers. The oracle records clock, cookie, hash settings, all
response headers, byte length, and SHA-256. A Perl process with another
hash seed can serialize some object keys and attributes in a different
order; byte parity is asserted only under the recorded conditions.

## Live HTTP route and comparison

From src/s2/target/javascript in the owning devcontainer:

~~~sh
npx tsc
export S2_LIVE_TEST_ARTIFACT="$PWD/artifacts/live/stock.json"
node dist/tools/check-live.js first
node dist/tools/check-live.js compare
node dist/tools/check-live.js resources
node dist/tools/check-live.js update
node dist/tools/check-live.js recovery
node dist/tools/check-live.js pagination
node dist/tools/check-live.js empty
node dist/tools/check-live.js entry-states
node dist/tools/check-live.js content-refusal
node dist/tools/check-live.js missing
node dist/tools/check-live.js cross-journal
node dist/tools/check-live.js recheck
node dist/tools/check-live.js no-perl
node dist/live/tests/privacy-db.js
node --test dist/live/tests/*.test.js
node dist/live/server/main.js
~~~

The setup in first or any later check-live mode compiles that ignored
stock.json and its sibling sandbox launcher. Set S2_LIVE_TEST_ARTIFACT
before the component tests; their /tmp fallback requires an artifact at
that exact path and is not created by the tests.

Run first only once on a fresh marked journal before any live-oracle.pl GET.
It performs the offline seed, config, scoped grant, and stock compilation;
checks all three customtext fields are absent; starts the real loopback
Fastify server; requests its recent route; and verifies that the independent
raw snapshot did not change. It records ignored artifacts/live/first-live.json.
On a database where retained Perl has already initialized customtext, use
compare directly.

Compare runs two independent real Perl HTTP GETs under the recorded frozen
comparison conditions, checks they are byte identical, then requests the
TypeScript HTTP route with the same clock/random/cookie through the separate
offline comparison factory. It asserts status, exact content type and
length, private no-store, no Set-Cookie, and an unchanged primary snapshot
fingerprint before and after GET and HEAD. HEAD must have the same relevant
headers and GET byte length but no body. It writes the unmodified outputs to
artifacts/live/oracle-one/page-oracle.html and artifacts/live/page-ts.html.
It compares the full bytes with no normalization. The ordinary server imports
only the live factory and uses live clock and cryptographic randomness.

Resources enumerates every root-relative href, src and action emitted by
the actual TS recent page. It checks exact 307 Location values against the
canonical retained app origin, including both POST forms sent with an
admitted Origin and no body. Every emitted /stc, /js and /img target must
also return 200 from the retained app. Other controls are checked for
redirect admission only; their retained target may have its normal 302,
401 or 404 response.

Update posts and edits one exactly marked temporary entry with normal Perl
helpers, checks the next ordinary TS HTTP GET shows each change without an
export or artifact regeneration, then fully removes only that recorded entry.
Recovery kills the normal helper only after its committed-post handshake,
once for a single post and once during a mixed batch, and once after a
recorded entry suspension. The harness invokes the separate exact-owner
restore in finally and verifies both original seed IDs remain.
Pagination creates 22 marked public posts plus one private and one usemask post.
It checks the raw snapshot sees all 26 candidates while anonymous HTML never
contains the two hidden posts, then compares real Perl and TS full HTML bytes
for absent skip and explicit 0, 20, 79, 80, 81, and 200. It restores every
recorded probe and verifies the two original seed entry IDs remain. These
normal app helpers may enqueue local feed and notification tasks; the test
does not reset queues or unrelated records. An interrupted run can be
recovered before another seed or page check with:

~~~sh
perl src/s2/target/javascript/tools/live-probes.pl --restore
~~~

The reviewed privacy suite separately checks real HTTP refusal and restoration
for owner visibility/status and unsupported account settings/style; it does
not change entries. Run it sequentially after setup, never concurrently with
the entry probes. Its exact interrupted-run recovery is:

~~~sh
node dist/live/tests/privacy-db.js --recover
~~~

Empty temporarily makes only the two exact seed posts private through normal
edit helpers, proves no entry or calendar date leaks, compares the complete
empty HTML with real Perl, and restores the original IDs, content, date and
public security. Normal edit revision counters may advance. If interrupted:

~~~sh
perl src/s2/target/javascript/tools/live-empty.pl --restore
~~~

Entry-states posts one recorded entry on a distinct date, then checks public,
suspended, restored public, private, usemask and fully deleted transitions
against the real HTTP route and day link. Suspension uses the retained
Entry.set_prop(statusvis) helper after recording intent. The fresh
fingerprint changes, the entire page becomes a fixed 422 without HTML,
cookie, Location or marker, and restoring the original property returns
200 with the marker. Recovery can find the exact recorded ID even when
recent enumeration omits a suspended entry. Content-refusal posts three
separately recorded invalid bodies (unbalanced markup, a URL attribute and
script), verifies
fixed 422 with no content or cookie, and fully deletes each. Recheck changes
the marked owner's display name through the normal helper just before the
real independent primary check; the buffered page is discarded as fixed 409,
the next request sees the new name, then the name is restored. These checks
reuse the same exact probe restoration commands above.

Missing checks the primary repository returns null for an absent username,
while the unadmitted HTTP journal path returns fixed 400. Cross-journal
uses only LJ::alloc_user_counter on each marked account to align their
monotonic L counters, with at most 512 allocations and no padding posts.
It records intent before posting one marked entry in the primary account,
captures its fingerprint and deterministic HTTP body, then posts one
marked entry with the same jitemid in the second account. The primary
fingerprint and full body must remain unchanged, and the foreign journal
route remains unadmitted. Both exact rows are fully deleted. Counter gaps
are normal permanent local test side effects; no allocator is reset.
Recover an interrupted pair with:

~~~sh
perl src/s2/target/javascript/tools/live-other-probe.pl --restore
~~~

No-perl first verifies the retained app is available, then stops only the
owning container's Starman workers. The actual TS recent route must still
return 200 from MySQL and compiled JavaScript. Its finally block restarts
the app with the documented .devcontainer/start.sh. If the harness itself
is killed before finally runs, restart the app manually inside that
devcontainer:

~~~sh
bash .devcontainer/start.sh
~~~

The service listens only on 127.0.0.1:8081 inside its own devcontainer; the
retained Perl app remains on 8080. Its only rendered route is
http://localhost:8081/users/s2js_slice3/. Inventoried relative controls and
resources receive finite redirects to the canonical retained app origin.
The TypeScript server neither calls Perl nor proxies those responses while
rendering the recent page. To view it from a host browser, forward both
container loopback ports 8081 and 8080 through the editor/devcontainer port
forwarding UI; do not take over the Perl port or change container publication.

After starting the TS server, capture and inspect its actual route in the
owning container with the existing dev screenshot Chrome installation:

~~~sh
node dist/tools/live-screenshot.js
~~~

The resulting ignored PNG is artifacts/live/ts-recent.png. The helper uses
the exact TS URL because bin/dev/screenshot hardcodes the Perl app port.

The HTTP failure matrix in live/tests/http-failure.test.ts exercises the
real Fastify handler, service, and child with an injected typed repository:
fixed 404 for absent data, 503 for load/recheck unavailability, 409 for
changed recheck, and 422 for unsupported data, including safe body and
header checks. This is not an actual MySQL outage test. The live privacy,
entry, pagination, cross-journal and no-Perl modes above use the real
local database and HTTP listener.
