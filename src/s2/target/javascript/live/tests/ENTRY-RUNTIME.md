<!--
ENTRY-RUNTIME.md

Anonymous EntryPage policy and isolated runtime checks.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Anonymous EntryPage runtime checks

Use the owning devcontainer and the dependencies described in
[the component guide](COMPONENT.md). From the repository root, build the shared
content package and complete S2 package, then compile and stage a fresh artifact:

```sh
/opt/dw-node24/bin/node src/content/node_modules/typescript/bin/tsc -p src/content/tsconfig.json
/opt/dw-node24/bin/node src/s2/target/javascript/node_modules/typescript/bin/tsc -p src/s2/target/javascript/tsconfig.json
perl src/s2/target/javascript/tools/live-compile.pl /tmp/entry-stock.json
/opt/dw-node24/bin/node src/content/tools/stage-runtime.mjs /tmp/entry-stock.json
S2_LIVE_TEST_ARTIFACT=/tmp/entry-stock.json /opt/dw-node24/bin/node --test --test-concurrency=1 src/s2/target/javascript/dist/live/tests/entry-*.test.js
```

The tests use the actual closed stage, source-derived stock page model, one
isolated rendering child and ordinary HTTP adapter. Repository fault and mutation
tests inject typed snapshots; they do not simulate an actual database outage.
Their fixed GET/HEAD failures cover missing/private/usemask/wrong-anum targets,
unsupported journal or comment state, loader errors, recheck errors and changed
fingerprints. They assert status, exact body and length, no-store, content type,
and absence of HTML, cookies, redirects and error sentinels.

Selection precedes cohort inspection: a missing or nonpublic selected target is
404 even when another cohort gate would refuse the journal. Public targets retain
all journal-wide gates. A positive `spamreportBans` count refuses EntryPage before
token generation or rendering; RecentPage keeps its existing gate. Mutations of
an entry outside the RecentPage window, its anum, journal status, actual comment
count, replycount or spamreport count invalidate the complete buffered result.
The next request observes the new state.

Only canonical GET/HEAD `/users/s2js_slice3/<decimal>.html` paths are admitted,
with positive IDs through 4294967295 and no query. ID arithmetic uses division
and remainder. IDs below 256 are syntactically valid but have no positive entry
row. `/go` and OpenID controls redirect only through their finite checked forms.
The retained application's wrong-anum behavior on its `/users/` route is not
reproduced: a mismatched stored anum returns 404 here.

The child prepares the selected full-cut body and independently derives inert
metadata from the original approved entry. The stock engine escapes metadata at
the OG attribute boundary. Neither fragment returns to the credential-bearing
parent. Tests cover cut visibility, independent metadata, inactive entity-escaped
markup, typed content refusal and recovery, page/identity invariants and the
parent's absence of DOM/CSS runtime imports. The shared cleaner tests establish
the detailed metadata proof boundaries and preformatted newline behavior.

The prior [renderer probes](COMPONENT.md) still establish credential-file,
network, process, worker and addon denials, inherited-descriptor closure, timeout,
output limits and closed-stage integrity. The new entry tests do not replace
those probes or relax their grants.

## Real database status and setting checks

After normal marked-journal setup, offline public config and read-only grants,
run from `src/s2/target/javascript`:

```sh
S2_LIVE_TEST_ARTIFACT=/tmp/entry-stock.json /opt/dw-node24/bin/node dist/live/tests/privacy-db.js --entry
```

This discovers the actual public entry ID from the primary snapshot and checks
both GET and HEAD through the live service and HTTP socket. The existing offline
Perl helper changes only the marked owner's status, settings and style selection
between requests. Each refusal must restore the exact baseline fingerprint and
successful response. It does not create ban records or alter entries/comments.
Run sequentially without other marked-journal mutations. Interrupted runs retain
the same scoped recovery state and use the existing recovery command:

```sh
/opt/dw-node24/bin/node dist/live/tests/privacy-db.js --recover
```

No Perl helper runs on the serving path. Full retained-page differential,
post/edit/comment refresh, browser behavior and serving while the retained app
is unavailable remain integrated acceptance checks beyond this component suite.
