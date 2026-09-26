<!--
SLICE-6.md

Private real-data standalone S2 viewer startup guide.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Private standalone S2 viewer

This listener reads configured global and cluster primary databases and executes
unchanged core2 plus core2base/layout in a credential-free child. It does not
require a fixture account, bio/style marker, database name, principal or cluster1.
Recent GET/HEAD uses `/users/<username>/`; a public numeric Entry uses
`/users/<username>/<ditemid>.html`. Only canonical admitted query/path forms work.
The listener is a private anonymous viewer, not a replacement public Dreamwidth
frontend. Routing and access to the private listener belong to its operator.

## Deliberate scope

There are no Memcached reads/writes, request bans, rate limits or captcha checks.
Cache-only IP/uniq tempbans are not reproduced. Authentication-bearing requests
are refused; no authenticated data is rendered. Journal/entry privacy, deleted
and suspended state, configured move capability, identity mapping, adult-content
policy and cross-journal isolation remain enforced. Unsupported styles, comments,
userpics, tags, links and content/settings are refused rather than represented
with the wrong stock artifact. Ordinary non2 `stylesys` ignores stale persisted
S2 layer IDs and resolves the configured hash-qualified default. Malformed
nondigit style-system values refuse explicitly; custom `force_s1` style-dispatch
hooks are not reproduced and sites relying on them are unsupported. See [cleaner policy](live/tests/CLEANER-POLICY.md)
for supported body/context boundaries and named compatibility changes.

Production image proxying is deferred even when the retained site configures it.
No salt is exported/read or URL signed/fetched. Valid original image URLs remain;
HTTPS viewers can therefore block mixed HTTP content. Existing source-derived
known-HTTPS URL semantics and unsafe URL sanitation still apply; HTTP URLs are
not upgraded blindly. Inline CSS URLs are not proxied. The independent offline
[proxy qualification](live/tests/IMAGE-QUALIFICATION.md) remains historical proof,
not serving-path proxy support.

Configuration and public placeholder translation are startup snapshots. Re-export
and restart after endpoint/password, active a/b pair, capabilities, default-style,
origin, prefixes or language changes. Translation follows retained DB/file
precedence using SELECT/file reads only, without helper writes or cache access.
Language tables may be MyISAM: their selected labels are a startup snapshot,
not journal authorization dependencies or an InnoDB consistency claim.

## Build, export and start

Run inside the owning devcontainer, with scoped setup privileges where needed.
Keep the system Node unchanged. From `/workspaces/dreamwidth`:

```sh
bash src/content/tools/bootstrap-node24.sh
cd src/content
PATH=/opt/dw-node24/bin:$PATH npm ci
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
cd ../s2/target/javascript
PATH=/opt/dw-node24/bin:$PATH npm ci
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
mkdir -p artifacts
S2_RUN=$(mktemp -d "$PWD/artifacts/site-run.XXXXXX")
perl tools/live-compile.pl "$S2_RUN/stock.json"
/opt/dw-node24/bin/node ../../../content/tools/stage-runtime.mjs "$S2_RUN/stock.json"
perl -I"$LJHOME/cgi-bin" tools/site-config.pl --output "$S2_RUN/site.json" \
  --artifact "$S2_RUN/stock.json" \
  --app-origin http://localhost:8080 --listen-origin http://localhost:8081 \
  --listen-host 127.0.0.1 --listen-port 8081 \
  --local-socket /var/run/mysqld/mysqld.sock
/opt/dw-node24/bin/node dist/live/server/main.js --config "$S2_RUN/site.json" \
  >"$S2_RUN/listener.log" 2>&1 &
S2_LISTENER_PID=$!
```

The example origins/socket are this devcontainer's explicit inputs; use the
actual retained app origin, desired private listener and native local socket for
another configuration. Export loads ordinary site configuration with a no-connect
tripwire. It writes a private mode0600 file without overwriting prior evidence;
never print/share it or put it into the staged root. No journal GET, seed, grant
helper or DB connection is needed by export/build. Serving uses configured
primary credentials under session READ ONLY, including privileged credentials;
normal runtime does not change grants, records or schemas.

For absent/empty/exact lowercase `localhost`, native MySQL uses local transport:
configured socket wins, otherwise explicit `--local-socket` is required. No guessed
socket or TCP fallback occurs. Nonlocal host (including uppercase `LOCALHOST`)
uses TCP and ignores socket for transport, matching native behavior. Active cluster
pairs and configured weighted primary roles are selected; slave/reader roles are
not used. Existing local signing secrets are read-only: absent/too-old secret
fails closed; any normal offline refresh belongs to retained app setup.

The listener above runs in the background in the existing workspace. Inspect
`$S2_RUN/listener.log` for readiness; no credentials are logged. An IDE port
forward can expose the private port without changing the retained app port. With
a real supported username:

```sh
curl -i http://localhost:8081/users/USERNAME/
curl -I http://localhost:8081/users/USERNAME/
curl -i http://localhost:8081/users/USERNAME/DITEMID.html
# Stop this exact listener when finished; preserve its artifact/evidence root.
kill -TERM "$S2_LISTENER_PID"
wait "$S2_LISTENER_PID"
```

The normal main has no frozen clock/random switch. Stock root-relative controls
and resources have finite redirects to the configured retained app; no proxy,
request Perl, local authentication, reply/RPC or other journal-view implementation
is provided. Browser following those explicit app redirects is outside rendering.
SIGTERM/SIGINT closes the app, active render children and database pools.

## Selected data and final authorization

Recent public filtering precedes bounded SQL LIMIT; the source lookahead/order
and MAX_SCROLLBACK_LASTN clamps are preserved without a second model skip.
Only selected bodies/logprops are decoded. An older Entry is selected directly
by journal/jitemid/anum, not by scanning recent bodies or imposing a total-history
cap. Calendar day/month/neighbor aggregates have their own bounded public witnesses,
including lookahead status/poster facts, without loading those bodies.

Global identity/settings/style facts bracket the cluster snapshot. After the
entire HTML is buffered, an independent complete request-specific primary reread
is the last asynchronous authorization step before enqueue. Persistent edits,
rename/move/mapping changes, private transitions and selected-window changes
invalidate the result. This is bounded optimistic validation across configured
servers; it does not claim a distributed atomic snapshot, arbitrary ABA detection,
or protection from commits after the final reread/network delivery.

Worker limits and closed-root manifest/seccomp/Node permission denials remain
unchanged. No DB credentials, placeholder source files or ordinary application
filesystem are granted to the child. Browser setup, corpus preparation and fresh
attestation commands remain in the [content guide](../../../content/README.md).
Historical Slice3–5 seed/oracle tools are offline regression helpers, never
ordinary startup prerequisites. Leading whitespace HTML5 transformations are
qualified only under the unchanged stock normal-white-space context;
pre/pre-wrap can expose 18px differences, with no arbitrary stylesheet-equivalence
claim. Existing Recent410 and Entry62 semantic expectations remain independent
of freshly generated current-run attestations.

## Regression setup and evidence boundaries

The retained regression helpers accept `S2_SITE_CONFIG` pointing at the private
export above. Their offline seed/grant/oracle setup is test preparation; ordinary
main startup does not run it. After a full normal TypeScript emit, each helper's
setup recompiles the stock artifact at the configured path and stages its fresh
closed runtime. Preserve the private export and generated evidence roots.

```sh
export S2_SITE_CONFIG="$S2_RUN/site.json"
S2_STANDALONE_MAIN=1 /opt/dw-node24/bin/node --test dist/tools/main-startup.test.js
/opt/dw-node24/bin/node dist/tools/check-live.js compare
/opt/dw-node24/bin/node dist/tools/check-live.js entry-compare
/opt/dw-node24/bin/node dist/tools/check-cleaner.js
```

The opt-in main test starts the ordinary unfrozen CLI and checks Recent and Entry
GET/HEAD, exact lengths, private no-store, no privileged cookie/redirect, and an
unchanged raw fingerprint. Frozen comparisons are separate offline tests:
Recent is 17937 bytes and the two retained Entry pages are 15409 and 15414 bytes.
Their per-run TS-before-oracle order is not a first-ever request claim: discovery
already visited those seed entries.

Selected-data tests cover 300 public entries and two qualified nonmarker journals
on independently configured clusters. Actual primary mutations test identity,
move and selected-window freshness; actual child/HTTP tests are distinguished
from injected failures in [runtime qualification](live/tests/ENTRY-RUNTIME.md).
Actual current Entry seed/rich/forged pages pass the retained browser reparse
checks in Chromium, Firefox and WebKit with JavaScript on and off: 204 observations
per page across six combinations, with exact captured local resources and only
the explicitly declared synthetic images fulfilled inertly. The actual ordinary
main Entry screenshot is preserved in the owning run root as
`actual-main-entry-660.png`; it is a private-viewer demonstration, not a general
site/style compatibility claim.
The retained same-ID test preserves both seed records and deletes only its two
recorded probes. Its older secondary account has unqualified stored layer IDs
and therefore returns fixed 422; positive multi-journal serving is proved by the
qualified isolated fixture, not by changing those unrelated stored layers.

The retained entry-state helper now verifies private/usemask bodies are absent
from both the selected Recent snapshot and direct Entry load, alongside their
404 HTTP behavior and calendar exclusion. Suspension remains fixed 422; exact
owned probe recovery restores normal responses. Real-DB recheck mutation in the
retained harness is Recent-only; Entry 409 is injected through the actual child
and HTTP service. No physical Entry mutation claim is inferred from that test.
