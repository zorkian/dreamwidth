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
style, property, text, and unsupported-feature reads are batched.

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
contain bytes 63 61 66 C3 83 C2 A9. The loader reverses the connection
conversion with CONVERT(column USING latin1), verifies a lossless round trip
back to the stored bytes, then strictly decodes UTF-8. Gzip event bodies are
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
normal-helper name mutation that revokes the fingerprint. The test restores
the name in a finally block. If the test process is killed during that
mutation, recover only this owned variant with:

~~~sh
perl src/s2/target/javascript/tools/live-mutate.pl --restore
~~~

## Perl comparison oracle

After the first TypeScript request, the real retained app page may be
exported with live-oracle.pl. Ordinary two-argument mode uses live time and
randomness and records the complete HTTP body and response headers,
including normal anonymous Set-Cookie.

For byte comparison, set Perl hash order before process startup and provide
the fixed anonymous ljuniq cookie:

~~~sh
PERL_HASH_SEED=0 PERL_PERTURB_KEYS=0 perl \
  src/s2/target/javascript/tools/live-oracle.pl \
  http://localhost:8080 <output-directory> \
  --comparison AAAAAAAAAAAAAAA:1790294400:x
~~~

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
