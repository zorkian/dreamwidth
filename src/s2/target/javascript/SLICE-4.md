<!--
SLICE-4.md

Local rich entry cleaner and live S2 verification guide.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# S2 JavaScript slice 4: rich entry content

The reusable [content package](../../../content/README.md) cleans untrusted
`html_raw0` bodies inside the same bounded, credential-free child that then
executes unchanged stock `Page.print`. The parent reads a fresh primary
snapshot, prepares only approved data, and rechecks it before sending a
buffered page. The stock core2 plus core2base/layout stack, anonymous route,
privacy decisions and read-only database credential remain as described in
[Slice 3](SLICE-3.md). No retained Perl GET or exported page is used to render
the live TypeScript route.

## Build and run

Use this worktree's devcontainer with scoped setup privileges. Node 24.21.0
is pinned by the content bootstrap; it leaves the system Node unchanged.
From the repo root, with the retained local Perl app available on port 8080:

```sh
cd src/content
bash tools/bootstrap-node24.sh
PATH=/opt/dw-node24/bin:$PATH npm ci --ignore-scripts --no-audit --no-fund
PATH=/opt/dw-node24/bin:$PATH npm run build
cd ../s2/target/javascript
PATH=/opt/dw-node24/bin:$PATH npm ci --ignore-scripts --no-audit --no-fund
PATH=/opt/dw-node24/bin:$PATH ./node_modules/.bin/tsc --noEmit
PATH=/opt/dw-node24/bin:$PATH ./node_modules/.bin/tsc
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-live.js missing
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-cleaner.js
PATH=/opt/dw-node24/bin:$PATH node dist/tools/check-live.js content-refusal
```

The `missing` setup uses normal offline seed, public-config and scoped-grant
helpers. It compiles the unchanged stock source to `artifacts/live/stock.json`
and builds and verifies its sibling `.sandbox` and closed `.runtime` directory.
The same setup runs before a fresh `check-cleaner` or `content-refusal` check;
neither depends on a previously staged artifact. The service itself can be
started from the S2 package with
`PATH=/opt/dw-node24/bin:$PATH node dist/live/server/main.js`; it listens on
container loopback port 8081. The retained Perl app stays on 8080. Follow the port-forwarding
directions in Slice 3 for a host browser.

`check-cleaner` creates exactly one marked temporary entry through the normal
Perl post helper, edits it through six rich/forged/security variants, requests
the actual TypeScript HTTP route and verifies safe output, response headers,
read-only GET and the primary fingerprint. It fully deletes only that entry,
checks both original seed IDs and fingerprint, and saves actual full rich and
forged pages under `artifacts/live/`. If interrupted, recover its exact owned
record before rerunning:

```sh
perl tools/live-content-post.pl --restore
```

The historical `content-refusal` mode now checks three precise migrations:
an unterminated paragraph is repaired to `<p>unterminated</p>`, a JavaScript
anchor keeps visible `bad link` without an active href, and a script-only body
becomes empty. Each is HTTP 200 with an exact fragment, safe headers, no
journal write, and full normal-helper restoration. It saves actual full pages
as `artifacts/live/slice4-bad-{malformed,url,script}-page.html`. These three
changes do not relax the owner/privacy/recheck refusal tests. Recover an
interrupted marked entry with `perl tools/live-probes.pl --restore`.

## Content boundary

The entry cleaner covers examined modern and legacy div-flow formatting,
classes and ordinary names, broad inline CSS including custom properties,
and contextual links, images, maps and forms. It retains safe content and
documents named security differences; it does not claim parity for every
native cleaner context. Subjects remain nonempty plain UTF-8, at most 1 KiB.
Per body, the limits are 64 KiB input, nesting depth 16, 4,096 DOM nodes,
64 KiB CSS and 4,096 CSS nodes, 256 image candidates and 16 cuts. Selected
subject plus body text totals at most 2 MiB across at most 200 rows. The
one-worker request has a 10-second deadline, 128 MiB heap, 2 MiB HTML cap and
at most two children. The bounded source audit parses only HTML/BODY wrapper
fragments, at most 32 parses and cumulatively at most four times the body
input byte limit; remaining source gaps are checked as text.

The [policy decisions](live/tests/CLEANER-POLICY.md) name the exact examined
domain, sanitizer differences and explicit Unsupported representations,
including rawtext, unusual head/template and ambiguous formatting repairs.
Ordinary omitted paragraph/list ends are supported. A flat cut retains its
generated controls and permalink while omitting hidden text; AJAX expansion
is unsupported. Source-forged cut IDs never acquire a trusted widget. Ordinary
flow, CSS and links remain stable on output re-entry. Two retained exceptions
are generated cut IDs treated as untrusted source IDs on re-entry and
`extractImages` re-extracting a generated placeholder.

Body relative URLs and CSS URLs resolve against the canonical retained
document URL, including explicit skip; fragment hrefs remain local. CSS URLs
are never image-proxied. Form action validation precedes URL resolution.
Ordinary startup requires `imageProxy: not-configured`; an empty site domain
is not a wildcard. [Image qualification](live/tests/IMAGE-QUALIFICATION.md)
proves a separate offline synthetic signing exchange, not a production proxy
path. Reader option flags are available in the shared API; the ordinary live
recent-page worker passes removal/extraction flags false and image bounds null.

## Evidence and browser verification

The [corpus guide](../../../content/corpus/README.md) retains all 14 original
cleaner suites (1,116 TAP assertions), 384 source-derived `html_raw0` replays,
26 separate synthetic cases and their accepted per-case byte/difference ledgers.
Its fixed native browser matrix maps 219 admitted case IDs to 72 exact groups
and runs Chromium, Firefox and WebKit with JavaScript on/off. Unsafe raw
controls must demonstrate that the traps can fire; admitted fragments must
not gain active handlers, foreign nodes, unexpected resources or DOM clobbering.
The five named synthetic cut/rawtext/form refusals carry no fragment to parse.

Before browser checks, install the pinned browsers and their OS libraries
with scoped setup privileges, then verify all three engines in both JavaScript
modes. From `src/content`:

```sh
PATH=/opt/dw-node24/bin:$PATH ./node_modules/.bin/playwright install --with-deps chromium firefox webkit
PATH=/opt/dw-node24/bin:$PATH node tools/qualify-browsers.mjs
```

For actual route pages, from `src/content`, first generate and verify the
26-row synthetic comparison result as shown in the corpus guide. Then capture
only the exact public resources emitted by the saved page. These commands
include the observed local cut controls; unlisted resources fail the browser
run, and the three declared `asset.slice4.invalid` rich images are fulfilled
as inert pixels without an external fetch:

```sh
for variant in rich forged; do
    /opt/dw-node24/bin/node tools/capture-browser-resources.mjs \
        ../s2/target/javascript/artifacts/live/slice4-$variant-page.html \
        /tmp/slice4-$variant-resources.json \
        /img/controlstrip/bg-dark.gif /img/collapse.svg \
        /img/collapseAll.svg /img/expandAll.svg /img/ajax-loader.gif
done
/opt/dw-node24/bin/node tools/browser-entry-reparse.mjs \
    /tmp/slice4-synthetic-results.json \
    ../s2/target/javascript/artifacts/live/slice4-rich-page.html \
    /tmp/slice4-rich-resources.json --require-rich
/opt/dw-node24/bin/node tools/browser-entry-reparse.mjs \
    /tmp/slice4-synthetic-results.json \
    ../s2/target/javascript/artifacts/live/slice4-forged-page.html \
    /tmp/slice4-forged-resources.json --require-forged-cut
```

For each saved migrated legacy page, capture its observed public resources
with `tools/capture-browser-resources.mjs`, then run
`tools/browser-entry-reparse.mjs` with `--stock-only` and that exact map.
The browser report counts observations across six engine/JavaScript
combinations; its number of observations is not an engine count. It checks
both document and entry-container reparsing and the actual stock page. The
capture/browser tools intercept page requests and block service workers;
they do not claim browser-process or DNS telemetry outside those routes.

HTML5 full-document parsing can drop leading whitespace generally: `LFHello`,
`LFLFspacesHello`, `spaces<b>x</b>` and `LF<p>` are examples. Two measured
native cut cases, `t/cleaner-event.t#call-0020/0021:html_raw0`, differ
by one retained leading LF byte. With the actual unchanged stock stylesheet
(`white-space: normal`), visible text, cut label and following stock layout
match in Chromium with JavaScript off/on. The raw LF and digests remain in
the ledger. Diagnostic `pre` and `pre-wrap` overrides instead make the Perl
page 18 px taller and move following content by 18 px, so this classification
applies only to this stock context; see
[the bounded measurement](../../../content/corpus/cut-stock-whitespace.md).
