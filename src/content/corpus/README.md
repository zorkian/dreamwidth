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

Run `/opt/dw-node24/bin/node src/content/tools/prepare-corpus.mjs` from the
repository root before native corpus checks. This Node-only command expands
`native-tap-spec.json` and the tracked `native-calls/` traces into the ignored
`src/content/artifacts/corpus/` directory. Its finite outputs are fourteen
`native-logs/*.log` files, three derived JSON files and a digest manifest.
It verifies source, trace and output hashes on every run, including cache hits.
For an isolated fresh preparation use `--output /tmp/<owned-directory>/corpus`
after creating its parent. Set `DW_CONTENT_CORPUS_ROOT` to that output root for
consumers. Ordinary package build and check commands do not prepare the corpus.

The generated `native-inventory.json` indexes every TAP assertion in the fourteen unchanged
`t/cleaner*.t` files at base `c725406eeed4b239dbb68af0a50f505f4b83b8df`.
Each case has a stable source-file/TAP-number ID, source hash, source-line
locator, native context, predicate, TODO state and exact native TAP line.
`native-tap-spec.json` retains readable TAP templates, exceptional TODO lines
and the exact output hashes from the reviewed run. The source files remain the authority for input,
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

Separately verify actual Perl TAP in the owning devcontainer. This is an
explicit native-suite check, never part of test preparation or app build:

```sh
mkdir -p /tmp/slice4-native-sol
for suite in t/cleaner*.t; do
    name=${suite##*/}
    perl "$suite" > "/tmp/slice4-native-sol/$name.log" 2>&1 || exit
done
for log in /tmp/slice4-native-sol/*.log; do
    cmp "$log" "src/content/artifacts/corpus/native-logs/${log##*/}" || exit
done
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
        "src/content/artifacts/corpus/native-logs/$name.log" || exit
    cmp "/tmp/slice4-native-calls/$name.calls.jsonl" \
        "src/content/corpus/native-calls/$name.calls.jsonl" || exit
done
DW_CONTENT_CORPUS_ROOT=$PWD/src/content/artifacts/corpus \
  /opt/dw-node24/bin/node src/content/tools/build-native-inventory.mjs \
    /tmp/slice4-native-calls /tmp/slice4-native-calls/inventory.json
cmp /tmp/slice4-native-calls/inventory.json \
    src/content/artifacts/corpus/native-inventory.json
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
  src/content/artifacts/corpus/native-derived-entry-cases.json
cmp /tmp/slice4-native-call-map.json \
  src/content/artifacts/corpus/native-call-replay-map.json
PERL_HASH_SEED=0 PERL_PERTURB_KEYS=0 \
  perl src/content/tools/cleaner-native-entry-oracle.pl \
  src/content/artifacts/corpus/native-derived-entry-cases.json \
  > /tmp/slice4-native-derived-perl.json
cmp /tmp/slice4-native-derived-perl.json \
  src/content/corpus/native-derived-entry-perl.json
/opt/dw-node24/bin/node src/content/tests/native-derived-entry.test.mjs
```

After both locked TypeScript builds, run the byte comparator against the
current built module from `src/content`. The positional label is informational;
the ignored run attestation binds the actual source, fresh compiled output,
lockfile, fixed corpus and result bytes:

```sh
/opt/dw-node24/bin/node tools/compare-entry-replays.mjs \
    dist/index.js current synthetic \
    > /tmp/slice4-synthetic-results.json
/opt/dw-node24/bin/node tools/compare-entry-replays.mjs \
    dist/index.js current native \
    > /tmp/slice4-native-results.json
/opt/dw-node24/bin/node tools/attest-corpus-run.mjs \
    --synthetic /tmp/slice4-synthetic-results.json \
    --native /tmp/slice4-native-results.json --entry
/opt/dw-node24/bin/node tools/check-difference-ledger.mjs \
    /tmp/slice4-synthetic-results.json corpus/accepted-synthetic-ledger.json
/opt/dw-node24/bin/node tools/check-difference-ledger.mjs \
    /tmp/slice4-native-results.json corpus/accepted-native-ledger.json
```

The permanent ledgers pin case IDs, outcomes, expected TypeScript bytes,
categories, rationales and evidence. Source/input identity joins the fixed
manifest; Perl identity joins the independent fixed golden. The checker
recomputes all joins and raw byte comparisons. A regenerated result or
attestation cannot update an accepted category. The synthetic 26 are 16 exact,
two serialization, two origin adaptations, one security correction and five
explicit Unsupported outcomes. The native-derived 384 are 249 exact, 15
serialization, 27 origin adaptations, 13 security corrections and 80 explicit
Unsupported outcomes. Each nonexact row retains its expected TypeScript digest,
a named cause and evidence; the byte differences are not normalized.

`attest-corpus-run.mjs` emits into ignored `artifacts/attestation`, or a fresh
owned `--output DIR` under `artifacts/` or `/tmp`. Creation performs a fresh
locked TypeScript emit into scoped temporary directories and refuses stale
`dist` bytes. The default mode is Node-only and records the 410 comparisons;
`--entry` also runs the existing compiled Entry test once and records all 62
raw reports. The Entry semantic checker requires `--entry` for final acceptance.
Each checker rehashes the run and fixed expectations; `--attestation DIR` selects
an explicit root. A changed source, result or fixed corpus requires a new run
attestation, while permanent expectations remain unchanged.

`native-browser-cases.json` independently pins all 208 admitted XSS-derived
records plus the other admitted native nonexact records: 219 case IDs grouped
into 72 groups. Each member independently joins the same fixed input, Perl
and expected TypeScript identity; the grouping keeps distinct raw source and
retained output even when many cases share sanitized HTML. Each group fixes
its only permitted image URL and request count; all
other requests abort. The browser tool reparses every group as a document and
as `div.entry-content` in Chromium, Firefox and WebKit with JavaScript on and
off. It runs active raw script/image/WebSocket controls, inert-anchor click and
details-toggle controls, and pairs safe serialization/origin differences with
retained Perl output. Unsafe foreign Perl markup is comparison evidence only;
typed Unsupported cases have no fragment to load. Run from `src/content`:

```sh
/opt/dw-node24/bin/node tools/browser-native-entry-matrix.mjs \
    /tmp/slice4-native-results.json > /tmp/slice4-native-browser-report.json
```

The reviewed run produced 1,098 observations: 864 cleaner reparses, 228 safe
Perl comparisons and six active raw controls. All admitted cleaner probes had
zero forbidden requests, page errors, popups, dialogs, active handlers, unsafe
navigation, foreign nodes or DOM API clobbering. The report records exact
resource requests and every covered case ID through the fixed manifest. This
browser matrix does not substitute for the actual stock rich-entry route and
cut-widget check.

## Slice 5: Recent regression and full-entry context

`slice5-recent-binding.json` pins the fixed expectation and golden hashes,
including the Phase 1 native manifest digest. The separate checker requires
all 26 synthetic and 384 native-derived Recent outcomes, refusals, byte
digests and categories to remain the same. It never rewrites a ledger.
Run from `src/content` after both TypeScript builds and corpus preparation:

```sh
/opt/dw-node24/bin/node tools/compare-entry-replays.mjs \
    dist/index.js current synthetic > /tmp/slice5-recent-synthetic.json
/opt/dw-node24/bin/node tools/compare-entry-replays.mjs \
    dist/index.js current native > /tmp/slice5-recent-native.json
/opt/dw-node24/bin/node tools/attest-corpus-run.mjs \
    --synthetic /tmp/slice5-recent-synthetic.json \
    --native /tmp/slice5-recent-native.json --entry
/opt/dw-node24/bin/node tools/check-slice5-recent-regression.mjs \
    corpus/slice5-recent-binding.json /tmp/slice5-recent-synthetic.json \
    /tmp/slice5-recent-native.json
```

`slice5-entry-ledger.json` is a separate full-entry and inert metadata context.
Its 52 named raw sources pin retained Perl helper, final OpenGraph and full-body
strings, plus the reviewed cleaner output and a reason for each body difference.
The body classifications are 28 exact, seven serialization, ten HTML5 whitespace
transformations, two document-context adaptations, three canonical entry URL
adaptations, one table repair and one explicit Unsupported refusal. Six ordinary
omitted paragraph/list/table ends are separately pinned as metadata-visible
adaptations, including literal helper strings and their changed 300-scalar final
OpenGraph values. Four ambiguous initial pre/textarea newline or entity cases
pin the exact retained source-location proof and typed refusal. Full-cut alias,
source-name and div-wrapper cases are among the 52; the component test also
checks raw output-as-input behavior for the div-wrapper exception. No Entry
result is relabeled as a Recent replay.

The attester's `--entry` run invokes the existing compiled test to produce
the raw helper reports. This checker verifies those attested reports against
all 62 permanent records and applies the stock renderer's final OpenGraph
transform. It does not invoke Perl or regenerate reports itself:

```sh
/opt/dw-node24/bin/node tools/check-slice5-entry-ledger.mjs
```

The browser reparse tool accepts actual captured TypeScript EntryPage HTML and
a resource map whose page hash, retained public assets and three named inert
fixture images are checked. Use `--require-full-entry-seed`,
`--require-full-entry-rich` or `--require-full-entry-forged` to require the full
cut, inert forged control and anonymous Reply fallback under the unchanged stock
scripts in all six Chromium/Firefox/WebKit JavaScript modes. Its report labels
the supplied page as a caller-provided assembly; the real route, normal-helper
cleanup and page hash are established by the separate live harness.
