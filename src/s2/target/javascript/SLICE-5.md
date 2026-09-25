<!--
SLICE-5.md

Local anonymous stock EntryPage verification guide.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# S2 JavaScript slice 5: anonymous entry view

The local TypeScript service renders a canonical numeric entry URL for the
same marked `s2js_slice3` journal and unchanged core2 plus core2base/layout
stock style as the [recent view](SLICE-3.md). The admitted path is
`http://localhost:8081/users/s2js_slice3/<ditemid>.html` with GET or HEAD and
no query. The entry must match the stored journal item and anum, be public,
and belong to the approved zero-comment cohort. The service still reads a
local primary snapshot, performs a final independent recheck and sends a
fully buffered page. Rendering uses one bounded, credential-free Node worker
with the reusable [entry cleaner](../../../content/README.md); no request Perl
or exported HTML is involved.

The stock EntryPage receives the selected approved entry object directly.
Its full body and independent inert subject/event metadata are prepared in
the worker from raw source. A recent page continues to omit cut-hidden text;
an entry page includes the full flat cut with generated name anchors. The
OpenGraph description follows the retained helper's text transformation,
ASCII whitespace collapse, 300 Unicode-scalar trim and one HTML escape.
Named omitted paragraph, list and table ends can change the inert metadata
serialization and truncation point; see the separate differential cases.
Subjects keep the plain, nonempty 1 KiB rule from Slice 3.

Body relative URLs on the entry page resolve from its canonical retained
`/~s2js_slice3/<ditemid>.html` document URL, matching the entry permalink;
Recent keeps its canonical `~s2js_slice3/` base. The local `/users/` route is
only the transport path. A browser resolving an unmodified raw relative href
directly at that local path may reach a different destination, so relative
URL changes are recorded as explicit origin adaptations. The inert metadata
helper retains its source URL text, and fragment anchors remain local.

The public reply, style, profile and previous/next controls retain their
original app destinations. The local service does not implement a reply
form, comment RPC or neighboring-entry query. Its finite `/go` redirects
lead to the retained app. On an anonymous page the seven quick-reply form
prerequisites are absent, so the unchanged stock Reply link follows its
canonical retained-app `?mode=reply` URL, with or without JavaScript.

## Build and local checks

Run these commands in this worktree's devcontainer. [Slice 4](SLICE-4.md)
documents the pinned Node 24.21.0 bootstrap, content dependency install,
closed worker staging, browser setup and retained Perl app prerequisite.
Keep the Perl app on port 8080 and the TypeScript listener on loopback 8081.
From the repository root:

```sh
cd src/content
bash tools/bootstrap-node24.sh
PATH=/opt/dw-node24/bin:$PATH npm ci --ignore-scripts --no-audit --no-fund
PATH=/opt/dw-node24/bin:$PATH npm run build
cd ../s2/target/javascript
PATH=/opt/dw-node24/bin:$PATH npm ci --ignore-scripts --no-audit --no-fund
PATH=/opt/dw-node24/bin:$PATH ./node_modules/.bin/tsc --noEmit
PATH=/opt/dw-node24/bin:$PATH ./node_modules/.bin/tsc
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-live.js entry-compare
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-live.js missing
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-live.js resources
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-live.js entry-states
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-live.js pagination
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-live.js cross-journal
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-cleaner.js
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-live.js no-perl
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-live.js empty
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-live.js recheck
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-live.js content-refusal
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-live.js compare
PATH=/opt/dw-node24/bin:$PATH node dist/live/tests/privacy-db.js
```

`entry-compare` runs the TypeScript page before this invocation's retained
Perl GET, records any Perl default-property write, then requests two
independent frozen Perl oracles and compares full GET bytes and HEAD length
for both seed entries. The account may have received Perl entry GETs in an
earlier discovery run; this check makes no first-ever request claim. Each
check rebuilds the local stock artifact and closed runtime as needed. Its
ignored `artifacts/live/entry-comparison.json` gives the two actual numeric
IDs and hashes. `missing` checks valid numeric but absent and wrong-anum IDs.
The marked probe modes verify public, private, usemask, suspended and deleted
entry states, pagination and same-ID cross-journal isolation. Their normal
helpers record exact intent and restore only owned probes. If interrupted,
run the relevant scoped recovery before repeating a mode:

```sh
perl tools/live-probes.pl --restore
perl tools/live-other-probe.pl --restore
perl tools/live-content-post.pl --restore
```

`check-cleaner` creates one marked rich entry and edits only that entry
through reviewed rich/forged/security variants. It saves actual recent and
entry HTML under `artifacts/live/`, checks that hidden cut text appears only
in the full entry body, and deletes only its own marked entry. Both original
seed entries remain present. Run marked DB modes sequentially; the privacy
driver owns separate owner/status/settings probes and exact recovery. The actual
EntryPage screenshot uses the ID recorded by `entry-comparison`:

```sh
PATH=/opt/dw-node24/bin:$PATH node dist/live/server/main.js
# In a second shell in this same container, substituting an actual recorded ID:
PATH=/opt/dw-node24/bin:$PATH node dist/tools/live-screenshot.js --entry 384
```

The screenshot helper accepts only a canonical positive ID in the bounded
numeric range. `entry-compare` has already compiled and staged a fresh
`artifacts/live/stock.json` with its required `.runtime` directory and
`.sandbox` sibling; ordinary `main.js` verifies those files on startup.
Stop the listener when the screenshot is complete. Port forwarding for a host
browser is described in Slice 3; the service does not take over the Perl port.

## Replayed content and real browser checks

From `src/content`, after both TypeScript builds, regenerate the 410 unchanged
Recent cases and verify the separate [binding](../../../content/corpus/README.md):

```sh
CONTENT_SHA=8fc8928659b761cb4f15228059a2c6b2bfd42d75
PATH=/opt/dw-node24/bin:$PATH node tools/prepare-corpus.mjs
PATH=/opt/dw-node24/bin:$PATH node tools/compare-entry-replays.mjs \
  dist/index.js "$CONTENT_SHA" synthetic > /tmp/slice5-recent-synthetic.json
PATH=/opt/dw-node24/bin:$PATH node tools/compare-entry-replays.mjs \
  dist/index.js "$CONTENT_SHA" native > /tmp/slice5-recent-native.json
PATH=/opt/dw-node24/bin:$PATH node tools/check-slice5-recent-regression.mjs \
  corpus/slice5-recent-binding.json /tmp/slice5-recent-synthetic.json \
  /tmp/slice5-recent-native.json
PATH=/opt/dw-node24/bin:$PATH node tools/check-slice5-entry-ledger.mjs
```

For the actual TypeScript page/browser matrix, use one of the IDs in
`artifacts/live/entry-comparison.json`. These example commands use ID 384 from
the recorded local cohort; substitute the actual ID if it differs. The rich
and forged HTML files come from the completed `check-cleaner` run:

```sh
BROWSER_DIR=$(mktemp -d /tmp/slice5-browser.XXXXXX)
ENTRY_ID=384
ENTRY_HTML=../s2/target/javascript/artifacts/live/entry-ts-${ENTRY_ID}.html
RICH_HTML=../s2/target/javascript/artifacts/live/slice5-rich-entry.html
FORGED_HTML=../s2/target/javascript/artifacts/live/slice5-forged-entry.html
for case in seed rich forged; do
  case "$case" in
    seed) page="$ENTRY_HTML" ;;
    rich) page="$RICH_HTML" ;;
    forged) page="$FORGED_HTML" ;;
  esac
  PATH=/opt/dw-node24/bin:$PATH node tools/capture-browser-resources.mjs \
    "$page" "$BROWSER_DIR/$case-resources.json" /img/controlstrip/bg-dark.gif
  PATH=/opt/dw-node24/bin:$PATH node tools/browser-entry-reparse.mjs \
    /tmp/slice5-recent-synthetic.json "$page" "$BROWSER_DIR/$case-resources.json" \
    "--require-full-entry-$case" > "$BROWSER_DIR/$case-browser.json"
done
```

The resource capture reads only the retained public assets emitted by the
actual page; three named synthetic rich-entry images are fulfilled as inert
pixels and never fetched externally. Each report has 204 observations across
Chromium, Firefox and WebKit with JavaScript on and off, including six stock
EntryPage executions. The tool marks supplied HTML as caller-provided
assembly. The live harness establishes its actual route, output hash and
normal-helper restoration separately. Anonymous Reply follows the retained
app URL because the page has none of the seven quick-reply form prerequisites.

## Boundary and evidence

Entry selection returns fixed 404 for an absent, private, usemask or
wrong-anum target after an authorized load. An exact public target still
passes the whole journal's owner, status, style and public-comment policy;
unsupported states return fixed 422. A changed final fingerprint returns
409, and unavailable work returns 503. Malformed paths, any entry query,
unknown journal aliases and unadmitted methods return fixed 400. These are
intentional local bounds; retained Perl may alias some wrong-anum URLs.
Successful responses use `private, no-store`, exact UTF-8 byte length and
no serving write. The app-owned token and challenge are generated from the
local existing secret source and never enter the reusable cleaner.

The [content policy inventory](live/tests/CLEANER-POLICY.md) documents the
examined formatting/CSS/URL domain and named security refusals. Full cuts
retain only flat, provable source spans, at most 16 per entry. Metadata
refuses contextual helpers it cannot reproduce safely, including Markdown,
mentions and ambiguous source locations, while ordinary email, links,
newlines and supported tags remain available. The previous Slice 4 accepted
ledgers remain unchanged; a distinct Slice 5 binding verifies all 410 prior
Recent replay outcomes and bytes against the new compiled content build.
Full-entry body, metadata and browser cases use a separate context and
record any visible adaptation or explicit refusal individually.

The [retained EntryPage differential](live/tests/entry-cleaner.test.ts) runs
52 retained Perl helper probes with exact subject/event metadata, six named
omitted-end metadata adaptations for paragraph/list/table and the associated
300-character budget, and four ambiguous initial newline/entity cases that
refuse with raw source proof. These metadata records are separate from the
Recent display corpus; they do not waive the earlier byte comparisons.
HTML5 full-document parsing can remove leading body whitespace generally;
the measured unchanged stock page uses normal `white-space` where the cut
leading-LF pair is visually equivalent. A `pre` or `pre-wrap` diagnostic
produces an 18-pixel geometry difference, so this is no arbitrary-stylesheet
equivalence claim and does not change inert metadata source text. The named
`inert-quote` full-body probe refuses at the cleaner's `SAFE_FOR_XML` boundary;
it is not a blanket refusal for ordinary quoted attributes or entities.

The `spamreportBans` positive refusal is exercised with a typed repository
fact and actual worker; the ordinary marked local DB has zero matching bans.
This suite does not insert a persistent historical sysban row just to test the
count. The loader's exact read-only BINARY count, transaction, fingerprint and
scoped grant checks remain separate from that injected positive policy test.

## Regression commands

Run these inside the same devcontainer after the builds and fresh artifact
setup above. The browser/component test using a stock artifact requires the
explicit environment variable; the stage mechanics test takes its sandbox
binary as a positional argument. Other Slice 4 corpus and browser commands
remain in [its guide](SLICE-4.md).

```sh
cd /workspaces/dreamwidth/src/s2/target/javascript
export S2_LIVE_TEST_ARTIFACT=$PWD/artifacts/live/stock.json
PATH=/opt/dw-node24/bin:$PATH node --test dist/live/tests/*.test.js
PATH=/opt/dw-node24/bin:$PATH node --test live/tests/cleaner-browser.test.mjs
PATH=/opt/dw-node24/bin:$PATH node --test live/tests/entry-cleaner-browser.test.mjs
PATH=/opt/dw-node24/bin:$PATH node --test live/tests/entry-newlines.test.mjs
PATH=/opt/dw-node24/bin:$PATH node dist/tools/selftest.js
PATH=/opt/dw-node24/bin:$PATH node dist/tools/run.js
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-page.js
cd /workspaces/dreamwidth/src/content
PATH=/opt/dw-node24/bin:$PATH node tools/prepare-corpus.mjs
PATH=/opt/dw-node24/bin:$PATH node --test tests/entry-replay-oracle.test.mjs \
  tests/native-derived-entry.test.mjs tests/native-inventory.test.mjs
PATH=/opt/dw-node24/bin:$PATH node tests/stage-runtime.test.mjs \
  "$S2_LIVE_TEST_ARTIFACT.sandbox"
cd /workspaces/dreamwidth
prove t/cleaner*.t
cd src/s2
perl -I. runtests.pl --force
cd ../..
perl t/02-tidy.t
perl t/00-compile.t
bash bin/build-static.sh
```

The last static build currently emits Sass `@import` deprecation warnings;
its exit status and tracked-file diff must still be checked. The retained
Perl suite has 14 cleaner files and 1,116 TAP assertions. Do not treat an
injected repository fault as a demonstrated physical MySQL outage.

The exact recorded local run and ignored artifact hashes are in
[the acceptance evidence](tools/SLICE-5-EVIDENCE.md). Reproduce the commands
on the current source and database state before relying on those observations.
