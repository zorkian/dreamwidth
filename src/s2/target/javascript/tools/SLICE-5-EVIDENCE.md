<!--
SLICE-5-EVIDENCE.md

Recorded local anonymous EntryPage acceptance evidence.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Slice 5 local acceptance record

This record describes one owning-devcontainer run on 2026-09-25. The parent
runtime incorporated the reviewed canonical Entry body URL correction at
`b87ffde7457c48ace64e0b8b9be5ea2b4224afac`. The reviewed content source
is `8fc8928659b761cb4f15228059a2c6b2bfd42d75`; compiled content SHA256
is `c5b0e7ceeb901c540a4b2cb955691d3ce1f355dcc6c47891a9c4103ee339dae2`.
No request Perl, exported HTML or DB credential entered the render child.

The owner container `4691cbc59e5e3f2049f3e3156b7c92516aafee6fd0f8fb7457282b8960c9c426`
mounted this implementation checkout at `/workspaces/dreamwidth`. Its ignored
`artifacts/live/stock.json` SHA256 was
`f0b2a5bce6833dfda45d9edaf1e3d6d6e55fd390588bad4595e1afdc270d4840`.
The sibling closed-worker manifest SHA256 was
`5a82ec6ae75dfac2f6f7d84fdc128491b3b83714b6358920c9dc9eac73766e2b`,
with schema 1, 1,898 listed files, Node 24.21.0 and the literal worker entry
`app/dist/live/render/worker.js`. The sibling seccomp binary SHA256 was
`52c888dcb543cb9c6b029811a2e26444a10d72ac88bb02655b75740d5c2bb366`.
These are local build outputs, not committed fixture data. The guide's setup
commands rebuild and verify them before serving.

## Actual HTTP and database checks

From `src/s2/target/javascript` after strict content/S2 builds, these
`node dist/tools/check-live.js <mode>` modes passed sequentially with the
normal-helper recovery paths in [the guide](../SLICE-5.md):

| Mode | Observed result |
| --- | --- |
| `entry-compare` | Two independent frozen retained Perl GETs per entry; exact TS GET bytes 15,409 and 15,414; HEAD same content length and empty body; raw fingerprint unchanged after TS GET/HEAD. TS ran before this invocation's Perl Entry GET. |
| `missing`, `resources` | Absent and wrong-anum targets returned fixed 404; 31 emitted root-relative destinations redirected exactly, 13 retained static targets returned 200, exact `/go` GET/HEAD admitted and reordered query refused. |
| `entry-states` | Marked public entry 200; suspension returned fixed 422 for the whole cohort; private, usemask and deleted exact targets returned fixed 404. Normal-helper status/security/delete operations restored only the marked probe. |
| `pagination`, `cross-journal` | Seven real Perl/TS mixed skip outputs matched; 24 marked rows restored. Two marked journals received equal monotonic jitemids without counter reset; foreign content did not alter primary Recent or Entry output, and both probes were restored. |
| `empty`, `recheck`, `no-perl` | Temporary private seed cohort hid exact entries and calendar metadata, then restored the two seed posts; a real primary mutation before final recheck blocked a Recent response; Recent and Entry GET/HEAD returned 200 while Starman was unavailable and the app was restarted. |
| `content-refusal`, `update`, `recovery`, `compare` | Three retired tiny-grammar probes were safely repaired/sanitized with exact cleanup; normal post/edit appeared on next GET; SIGKILL probe recovery restored baseline; original RecentPage remained byte-equal to real Perl at 17,937 bytes. |
| `check-cleaner.js`, `privacy-db.js` | One owned rich entry ran rich, edited, forged-cut, escaped CSS, scheme and unsafe-anchor variants through actual Entry and Recent routes; unsupported cut RPC returned fixed 400 without HTML or state change. The entry was fully deleted by normal helper. Ten owner/status/setting/style refusals and exact privacy recovery passed. |

The ordinary main listener started from the freshly staged default artifact,
served an actual EntryPage, and then stopped. The inspected screenshot at
`artifacts/live/ts-entry-384.png` has SHA256
`19bba3616e80cfff32ef8eb094a4845721027e2ccb91283596403fc2f9e39037`.
The two seed HTML files `entry-ts-384.html` and `entry-ts-660.html` have SHA256
`377e3a5ad621bea3a0b2764e76c7e9a99adc3dd253569727f66f4c73fb8c4392`
and `b93946dd811f8e63659fa9da8b35cb99aa8b65e9f5f35e7dd7f63fcf15246cb8`.
The selected IDs are local fixture facts; the commands derive actual IDs from
the DB and comparison report rather than assume them.

The real-DB `recheck` mode exercises Recent only. Entry 409/change gating is
tested with injected repository mutations through the actual isolated child
and HTTP transport in the Entry component tests; this record makes no physical
Entry mutation or MySQL outage claim.

## Content and browser evidence

The separate [Slice 5 corpus](../../../../content/corpus/README.md) binding passed
all 410 unchanged Recent raw results against the new compiled content build.
Its Entry checker passed 52 raw body/metadata cases, six literal-tag and
300-scalar metadata-visible adaptations, and four source-proof refusals. An
anchor origin-adaptation deliberately mislabeled `exact` was rejected by the
checker. The old Slice 4 ledgers were left byte-for-byte intact.

The actual TypeScript seed, rich and forged EntryPage files had SHA256
`377e3a5a...`, `50d1a592...` and `23f09466...`, respectively. Each page was
captured with its own hash-bound exact resource map, then run through Chromium,
Firefox and WebKit with JavaScript on and off. Each final report contains six
actual-stock observations plus 198 synthetic controls, zero forbidden
requests/page errors/sockets, full-cut and forged-control checks, and anonymous
Reply navigation to the canonical retained app. The rich map contains the
three named inert synthetic image pixels. Host-readable report copies are
`/tmp/slice5-sol-slice5-ts-entry-{seed,rich,forged}-browser-final.json`;
their source-bound replay inputs and resource maps use the corresponding
`/tmp/slice5-sol-` prefixes. Browser reports label the input as supplied
assembly. The actual-route checks and hashes above establish its provenance.

## Repository checks and limits of evidence

The assembled TypeScript test run passed 81 component tests. Slice 1 passed
all nine mandatory JS fixtures; Slice 2 matched 17,716 bytes; the legacy S2
Perl suite passed; all 14 original cleaner suites passed 1,116 assertions.
`perl t/02-tidy.t` passed 1,072 checks, `perl t/00-compile.t` passed 1,582,
and `bash bin/build-static.sh` exited zero with existing Sass `@import`
deprecation warnings. The content oracle, native call inventory and replay
tests passed; the closed-stage mechanics test passed when supplied its required
sandbox binary argument. The Entry cleaner Chromium and source-newline browser
component tests passed. The retained Slice 4 formatting browser fixture was
corrected in reviewed `1e54a8615854b1a5b7a916c4a65c1ef6cb51c2c2`, picked
locally as `33fa010c31fab47305a796aef8e482bb6d372547`. With the fresh
stock artifact explicitly supplied,
`node --test live/tests/cleaner-browser.test.mjs` passed 2/2, including all
98 raw/native stock rows with JavaScript on and off.

The local database's exact `spamreportBans` count is zero. A positive count
was tested through typed repository injection and an actual worker, while the
local read-only count, fingerprint and scoped grant were checked separately.
No historical sysban row was written for this run. The HTTP fault matrix is
typed repository injection, not a physical MySQL outage claim. Later commits
or database state changes require rerunning the relevant checks before using
this record as acceptance evidence.
