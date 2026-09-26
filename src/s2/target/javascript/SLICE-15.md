<!--
SLICE-15.md

Public comment-author eligibility and native badge presentation.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Slice 15: ordinary comment authors

## Display and privacy

Personal comment authors no longer require validated email or visibility `V`.
Email status is a bounded, fingerprinted source scalar, independent of display
permission; no email address is loaded. Known visibility states `V`, `D`, `X`,
`L`, `M`, and `O` preserve their public comments. Deleted and expunged authors
normally have struck badges; locked, memorial, visible, and read-only authors
use their native unstruck presentation. Unknown visibility states and visible
non-Personal/redirect authors remain explicit refusals.

This changes author display only. Journal-owner admission, comment-state
screening/deletion, suspended-author redaction and disabled-comment no-read
behavior are unchanged. Suspended and hidden authors cannot register a poster
or page-summary fragment, reach badge hooks/capabilities, or send public profile,
picture, subject or text to the worker.

Cluster zero means source-expunged, independently of the visibility label.
Fresh expunged objects do not preload timezone. A cluster-zero author opens no
cluster connection or picture/map lookup, even when its global default picture
ID is nonzero. Native Talk does not load that picture record, so no skeleton or
invented picture is projected. An expunged author with a positive cluster still
uses storage-backed selected pictures but has no freshly loaded timezone.
Other positive-cluster authors reuse the bounded public timezone/picture reads.
No biography, private profile settings or email data is fetched.

Two-way author identity, status, cluster, caps, name, default picture and selected
public picture/property dependencies remain bracketed and freshly reread.
Persistent moves, renames, status or displayed-data changes revoke buffered HTML.
The guarantee remains optimistic detection of persistent changes, without an
arbitrary ABA or distributed atomicity claim.

## Badge configuration

Re-export private configuration and restart before showing comment authors.
`site-config.pl` exports the actual `head_icon` hook presence, capability
facts for `staff_headicon`, `readonly`, and `avoid_readonly`, and configured
readonly-cluster overrides. No callback is executed or exported. Missing newly
required facts refuse only a displayed author badge; no-comment and anonymous
comments remain compatible with older configuration.

An encountered `head_icon` or required capability hook refuses. Personal staff
badges use the source `user_staff.png`, 17 by 17, with the staff profile label.
The child receives only approved badge kind/deletion presentation, not private
cluster or capability configuration. Complete poster and summary chunks freeze
that approved badge output; mutable or unregistered bytes gain no authority.

Native `V`/`M`/`L`/`O` short-circuit readonly evaluation. Other admitted states
use the source forced-or-advisory/avoid-readonly ordering before normal readonly
capabilities. Static overrides are supported. A reached exact `when_needed`
branch refuses because it requires request-time cache/DB-pressure behavior;
no `SHOW PROCESSLIST`, cache port, blanket configured-site refusal or operational
framework is added. Configured facts are startup snapshots, refreshed by
re-export and restart.

## Reproduction and evidence

Run inside the owning devcontainer. Follow [SLICE-6.md](SLICE-6.md) for explicit
Node24 bootstrap, locked installs, no-connect export and ordinary main startup.
Follow [SLICE-14.md](SLICE-14.md) for the pinned browser install/qualification and
current Entry comparison stock-page prerequisite. Do not use an owner-specific
hardcoded entry ID: read `artifacts/live/entry-comparison.json` first.

```sh
cd "$LJHOME/src/content"
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
cd "$LJHOME/src/s2/target/javascript"
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
mkdir -p /tmp/author-check
perl tools/live-compile.pl /tmp/author-check/stock.json
/opt/dw-node24/bin/node ../../../content/tools/stage-runtime.mjs /tmp/author-check/stock.json
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT=/tmp/author-check/stock.json \
  /opt/dw-node24/bin/node --test dist/tools/comment-authors.test.js \
  dist/tools/comments-data.test.js dist/tools/site-config.test.js
```

For the representative browser, supply the exact stock page selected from the
current comparison and preserve the ignored report/screenshots:

```sh
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT=/tmp/author-check/stock.json \
S2_COMMENTS_STOCK_PAGE="$LJHOME/src/s2/target/javascript/artifacts/live/entry-ts-<current-id>.html" \
S2_COMMENTS_BROWSER_OUTPUT=/tmp/author-browser-check \
  /opt/dw-node24/bin/node --test dist/tools/comment-authors.test.js
```

The native helper uses synthetic public facts, real UserLite/badge/capability
functions, exact suspended-redaction source and DB tripwires. It proves status
and short-circuit behavior independently; fixed absent hooks/capability values
in the basic rows are not a claim about every site's configuration. Exporter
tests separately prove hook/config preservation without execution or connection.

Actual fixture tests create/drop only task-owned schemas. They exercise the
current store, child and HTTP for unvalidated, deleted, expunged and suspended
authors, source-empty cluster-zero facts, positive-cluster pictures and final
status revocation/restoration. Poisoned expunged timezone records and counted
picture reads make no-read assertions non-vacuous. The representative browser
uses real selected TS pages, retained stock assets/scripts and one exactly
emitted configured fixture picture URL, fulfilled with an inert PNG. The report
records its declaration/hash; unobserved or external declarations and all
undeclared requests fail. Staff icon bytes are captured normally. It checks
struck staff badge CSS, native17x17 icon dimensions and selected40x30 picture
dimensions, without claiming the synthetic pixel is the actual userpic binary; it distinguishes fixture resource mechanics from native
binary-resource parity. Native serialized badge equality and actual SQL/model
facts are independent proofs, not full native feature-page HTML parity.

The cleaner, compiler, runtime and stage security rules are unchanged. Existing
410 Recent and 62 Entry fixed expectations remain historical independent
baselines, with fresh current-build attestation. Existing comment expansion,
privacy and no-comment byte parity remain required regression checks. Visible
identity authors, comment edit time/icons/unknown encoding and broader editor
formats remain named later work, not silently rendered or omitted here.
