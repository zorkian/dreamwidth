<!--
README.md

Provenance and scope of the native Dreamwidth cleaner test inventory.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Native cleaner corpus

`native-inventory.json` indexes every TAP assertion in the fourteen unchanged
`t/cleaner*.t` files at base `c725406eeed4b239dbb68af0a50f505f4b83b8df`.
Each case has a stable source-file/TAP-number ID, source hash, source-line
locator, native context, predicate, TODO state and exact native TAP line.
`native-logs/` retains the complete output regenerated in this implementation
worktree's own devcontainer. The source files remain the authority for input,
options and expected predicates. Cases with generated descriptions point to
their named input definition; other dynamic cases list possible assertion
sites and retain the stable TAP ID. A later explicit `html_raw0` replay is a
**new** record, never a relabeling of a comment, Markdown, subject, email,
embed or streaming case.

`native-calls/` contains **1,062** byte-exact `LJ::CleanHTML` input/output
calls from twelve of those original suites. Each JSONL record stores the
test-source line, the repo-relative direct caller and line, nested depth and
parent call ordinal, every positional argument after the input reference,
the TAP position before the call, method, UTF-8 flag and base64-encoded bytes
with SHA-256. Hash argument scalar fields and reference kinds are recorded;
other references are recorded by kind, without serializing their contents.
The inventory's `nativeCallsSincePreviousTap` lists calls completed after the
preceding TAP assertion and before this one. It is an **execution window**,
not a claim that the assertion consumes each listed output. An empty window
can still assert on output from an earlier call. One assertion may call the
cleaner several times, and one cleaner call may support several assertions;
1,062 calls are not 1,116 TAP cases. The native
email and direct `HTMLCleaner` link suites have no `LJ::CleanHTML` call trace
and remain indexed by their original TAP/source evidence. Original `#line`
locations are retained in the temporary instrumented suite. Every one of the
twelve instrumented TAP streams matched its uninstrumented baseline byte for
byte; no original test file was edited. The XSS trace reproduced byte for byte
on a second run. Dynamic test-account values, when present, remain raw in
their captured run rather than normalized.

The discovery count of 1,112 source-derived assertion instances was four
short: `cleaner-resource-loading.t` executes twelve assertions, not eight.
All fourteen suites passed in the owning container with **1,116** runtime
assertions. Five `not ok` results carry Perl TODO directives: one embed TODO
and four `clean_event` SVG/MathML gaps. They are retained security-gap evidence,
not desired sanitizer output.

The native suite helper `t/lib/ljtestlib.pl` replaces
`DW::Proxy::get_proxy_url` with `http://proxy.url` and stubs language helpers
where imported. That URL is a test fixture, not a production proxy decision.
Configured and absent proxy behavior needs a separate real-module test with a
synthetic key. Native TAP predicates are not an exact input/output oracle by
themselves; exact retained cleaner outputs and the per-case Perl/TypeScript
difference ledger belong to the later content replay harness.

Regenerate from the repository root inside the owning devcontainer:

```sh
mkdir -p /tmp/slice4-native-sol
for suite in t/cleaner*.t; do
    name=${suite##*/}
    perl "$suite" > "/tmp/slice4-native-sol/$name.log" 2>&1 || exit
done
cp /tmp/slice4-native-sol/*.log src/content/corpus/native-logs/
/opt/dw-node24/bin/node src/content/tools/build-native-inventory.mjs
```

Regenerate call traces in a separate existing directory. Compare the new
JSONL with the retained traces as well as the TAP streams before copying:

```sh
mkdir -p /tmp/slice4-native-calls
for suite in t/cleaner*.t; do
    name=${suite##*/}
    case "$name" in cleaner-email.t|cleaner-link.t) continue;; esac
    perl src/content/tools/cleaner-native-run.pl "$name" /tmp/slice4-native-calls
    cmp "/tmp/slice4-native-calls/$name.tap" \
        "src/content/corpus/native-logs/$name.log" || exit
    cmp "/tmp/slice4-native-calls/$name.calls.jsonl" \
        "src/content/corpus/native-calls/$name.calls.jsonl" || exit
done
/opt/dw-node24/bin/node src/content/tools/build-native-inventory.mjs \
    /tmp/slice4-native-calls /tmp/slice4-native-calls/inventory.json
cmp /tmp/slice4-native-calls/inventory.json src/content/corpus/native-inventory.json
```

Regeneration only uses this container's own test DB. Some original suites use
temporary test accounts and normal helper writes; run them in an isolated
development database. Source hashes and log hashes in the manifest catch
unexpected changes.

## Separate html_raw0 entry replays

`entry-replay-cases.json` defines 26 new, bounded synthetic entry bodies with
explicit stock RecentPage `editor`, `cuturl`, `journal` and `ditemid` options.
These are separate records and never inherit a native TAP case's context or
assertion count. The body text is readable Unicode in JSON; the offline Perl
oracle encodes it as **unflagged UTF-8 bytes** before `clean_event`, matching
`LJ::Entry::event_raw` from the marked development journal. That byte shape
was checked against both original seed entries; their UTF-8 flags were zero.
`entry-replay-perl.json` retains exact output bytes as base64 with SHA-256,
the input byte digest and UTF-8 flags, effective options, and the manifest
digest. `document` and `div.entry-content` reparse targets are explicit per
case. They expose head hoisting, rawtext, malformed table/form repair and cut
controls without claiming document parsing is the stock entry insertion
context. The source/provenance field distinguishes a native suite reference
from a Slice4 synthetic security probe.

The retained outputs were generated in the owning devcontainer with the real
Perl cleaner, without `t/lib/ljtestlib.pl` mocks. Verify them byte for byte:

```sh
PERL_HASH_SEED=0 PERL_PERTURB_KEYS=0 \
  perl src/content/tools/cleaner-entry-oracle.pl \
  src/content/corpus/entry-replay-cases.json > /tmp/slice4-entry-replay.json
cmp /tmp/slice4-entry-replay.json src/content/corpus/entry-replay-perl.json
/opt/dw-node24/bin/node src/content/tests/entry-replay-oracle.test.mjs
```

Perl output is evidence for each named input, not an automatic security target.

The TypeScript difference ledger and real assembled stock/browser checks must
classify safe repairs, origin adaptations, security corrections and unsupported
cases individually against a reviewed cleaner source.

`native-call-replay-map.json` accounts for **all 1,062** recorded native
`LJ::CleanHTML` calls. Its 384 `clean_event` calls produce **new** strict-UTF-8
`html_raw0` records in `native-derived-entry-cases.json`; all 384 have input
bytes and no omissions. The other 678 calls keep explicit native-only reasons
for comment, media embed, subject or user-bio contexts. Original editor,
options, caller and TAP execution-window evidence remain in the raw trace;
each replay points back to its exact suite and call ordinal. Recleaning a
Markdown or default-editor input under `html_raw0` is a context change, not a
claim that the original TAP assertion expected the new output. The actual
Perl outputs for the new context are pinned in `native-derived-entry-perl.json`.
The 384 cases originate from forms 6, event 42, Markdown 28, embed 23,
resource 5, tables 9, XSS 254, ljtags 12, event-embed 1 and invalid 4.

Regenerate and verify the complete call disposition and output bytes:

```sh
/opt/dw-node24/bin/node src/content/tools/cleaner-build-native-replay.mjs \
  /tmp/slice4-native-derived-cases.json /tmp/slice4-native-call-map.json
cmp /tmp/slice4-native-derived-cases.json \
  src/content/corpus/native-derived-entry-cases.json
cmp /tmp/slice4-native-call-map.json src/content/corpus/native-call-replay-map.json
PERL_HASH_SEED=0 PERL_PERTURB_KEYS=0 \
  perl src/content/tools/cleaner-native-entry-oracle.pl \
  src/content/corpus/native-derived-entry-cases.json \
  > /tmp/slice4-native-derived-perl.json
cmp /tmp/slice4-native-derived-perl.json \
  src/content/corpus/native-derived-entry-perl.json
/opt/dw-node24/bin/node src/content/tests/native-derived-entry.test.mjs
```

After a shared cleaner candidate has been reviewed, run the byte comparator
against that exact built module and full commit ID from `src/content`. Set
`CLEANER_SHA` to the reviewed 40-character commit ID first:

```sh
/opt/dw-node24/bin/node tools/compare-entry-replays.mjs \
    dist/index.js "${CLEANER_SHA:?set reviewed cleaner SHA}" synthetic \
    > /tmp/slice4-synthetic-results.json
/opt/dw-node24/bin/node tools/compare-entry-replays.mjs \
    dist/index.js "${CLEANER_SHA:?set reviewed cleaner SHA}" native \
    > /tmp/slice4-native-results.json
/opt/dw-node24/bin/node tools/check-difference-ledger.mjs \
    /tmp/slice4-synthetic-results.json corpus/accepted-synthetic-ledger.json
/opt/dw-node24/bin/node tools/check-difference-ledger.mjs \
    /tmp/slice4-native-results.json corpus/accepted-native-ledger.json
```

The two accepted ledger files are final review artifacts, added only after
source review. The checker compares every case ID, source, raw input and Perl
digest, exact TypeScript bytes and digest, outcome and category. A regenerated
result cannot update its own accepted category. Nonexact cases need an explicit
case rationale and browser/security evidence; a temporary machine-generated
classification is never an accepted ledger.
