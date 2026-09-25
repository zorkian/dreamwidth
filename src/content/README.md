<!--
README.md

Build and containment guide for the reusable Dreamwidth content cleaner.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Content package

This reusable package is independent of S2, the HTTP server, and the database.
The stock renderer imports it only inside the bounded, credential-free child.
The [policy inventory](../s2/target/javascript/live/tests/CLEANER-POLICY.md)
records supported entry markup and explicit refusals. The separate
[image qualification](../s2/target/javascript/live/tests/IMAGE-QUALIFICATION.md)
uses synthetic proxy credentials; ordinary serving requires an unconfigured
image proxy.

The pinned qualification runtime is Node 24.21.0. In the owning devcontainer,
run the bootstrap with scoped setup privileges before any Node 24 command. It
verifies the signed release list and Linux x64 archive hash, installs to
`/opt/dw-node24`, and leaves `/usr/bin/node` unchanged. From `src/content`:

```sh
bash tools/bootstrap-node24.sh
PATH=/opt/dw-node24/bin:$PATH npm ci --ignore-scripts
PATH=/opt/dw-node24/bin:$PATH npm run build
```

The S2 TypeScript package consumes the built content contracts while compiling.
Its local development dependency resolves this package through the checked-in
relative path; the render worker receives a separate closed runtime from
`stage-runtime.mjs`. From the repository root, build in this order:

```sh
cd src/content
PATH=/opt/dw-node24/bin:$PATH npm ci --ignore-scripts --no-audit --no-fund
PATH=/opt/dw-node24/bin:$PATH npm run build
cd ../s2/target/javascript
PATH=/opt/dw-node24/bin:$PATH npm ci --ignore-scripts --no-audit --no-fund
PATH=/opt/dw-node24/bin:$PATH ./node_modules/.bin/tsc --noEmit
PATH=/opt/dw-node24/bin:$PATH ./node_modules/.bin/tsc
PATH=/opt/dw-node24/bin:$PATH npm run check:page
```

The bootstrap pins the official release keyring, signed release checksum,
archive digest and extracted executable digest. The container's system Node 20
remains available for earlier S2 checks. Node 24 uses `--permission` for the
existing child policy; `--experimental-permission` is rejected. Qualify the
production-only dependency installation and original denial probe from this
directory after the S2 sandbox artifact and compiled probe exist:

```sh
/opt/dw-node24/bin/node tools/qualify-runtime.mjs \
  /workspaces/dreamwidth/src/s2/target/javascript/artifacts/live/stock.json.sandbox \
  /workspaces/dreamwidth/src/s2/target/javascript/dist/live/tests/sandbox-probe.js
```

This probe installs the lockfile into a disposable closed root, loads DOMPurify,
jsdom and CSS Tree through the original seccomp launcher with a 128 MiB heap
and ten-second bound, and checks the original credential, write, child, worker
and socket denials. The only production `@types` package is DOMPurify's
`trusted-types`; Playwright and native canvas are absent. This is dependency
qualification; the live route and browser checks below exercise the assembled
worker.

Runtime dependencies are exactly pinned in `package.json` and locked transitively
in `package-lock.json`. Playwright and TypeScript are development dependencies;
the render child must not read them. The S2 CLI and output paths remain under
`src/s2/target/javascript/dist`.

`tools/stage-runtime.mjs` builds an artifact-relative closed runtime directory
after compiling the shared cleaner and stock worker.
Given absolute compiled stock artifact path `A`, it writes
`A.runtime/manifest.json`, with the worker at
`A.runtime/app/dist/live/render/worker.js`. It copies only enumerated compiled
S2 modules and the locked production content package closure. The parent verifies
the manifest and grants the child read access only to this root. Staging never
copies app config, credentials, browser packages or repository-wide modules.
The worker and shared package code are collected from their compiled entrypoints
through literal CommonJS relative imports. Unexpected bare or dynamic imports
fail staging. Every regular staged file is hashed in sorted manifest order;
the previous stage may be replaced only when its entire inventory and owner
still match. The stager recreates its own synthetic package file after npm's
install step, so every published member has the invoking UID. It removes only a
validated, renamed previous stage or its own unfinished temporary stage. The
private temporary root must remain owned by the invoker; npm may have changed
the ownership of files within it before a failed install. Cleanup never follows
symlinks or masks the original install failure. Readonly directories are made
writable for this bounded cleanup. The published stage remains `0555`/`0444`.
The CLI takes only the absolute artifact
path, never a caller supplied runtime root or source override.

The synthetic packaging test checks the stage boundary independently:

```sh
/opt/dw-node24/bin/node tests/stage-runtime.test.mjs \
  /workspaces/dreamwidth/src/s2/target/javascript/artifacts/live/stock.json.sandbox
```

It stages one synthetic worker and one synthetic content module, runs them
under the original seccomp launcher with only the staged root readable, then
checks every staged directory is mode `0555` and file is mode `0444` with a
uniform owner, and runs the same worker as an ordinary non-root user. Root and
uid 65534 repeat builds leave no backup directories; the manifest is byte
identical on rebuild, and an unlisted symlink blocks replacement. Its result
qualifies the packaging boundary, not S2 rendering or sanitizer behavior.

Install the lockfile's Playwright engines and system libraries with scoped
setup privileges, then qualify all six combinations from `src/content`:

```sh
PATH=/opt/dw-node24/bin:$PATH ./node_modules/.bin/playwright install --with-deps chromium firefox webkit
PATH=/opt/dw-node24/bin:$PATH node tools/qualify-browsers.mjs
```

The qualifier intercepts one synthetic document and one synthetic image in each Chromium,
Firefox and WebKit JavaScript on/off mode. The actual assembled stock output
and security corpus use the checks below.

`tools/browser-entry-reparse.mjs` accepts a 26-row cleaner result JSON. It
checks the IDs against `corpus/entry-replay-cases.json` and checks each output
against its own digest. The permanent per-case bytes and categories are checked
separately by `tools/check-difference-ledger.mjs` using an ignored current-run
attestation; a browser input alone cannot authenticate a cleaner build. The
browser tool tests each admitted output in
both document and `div.entry-content` contexts across all six installed browser
modes. A raw control must execute only with
JavaScript enabled and must hit the denied image/WebSocket traps. Browser
service workers are blocked, every request is intercepted, and only enumerated
synthetic image URLs are served. Five named ambiguous cut/rawtext/form cases
must remain explicit refusals. This run is a fragment/reparse check; the
separate stock-page modes use actual route output.

For the assembled check, supply the **actual TS route response bytes** and an
exact public-resource map. Capture only the public resources referenced by
that page from the retained local app, then add any CSS background URL observed
by the browser as a named extra path; an unlisted request fails the run. The
capture helper uses a fixed loopback app origin and allows only stock static
and stylesheet paths. It stores response hashes and bytes, with no cookies or
account data.

The rich-entry fixture declares exactly three `asset.slice4.invalid` image
URLs (`pixel.png`, `map.png`, `bg.png`). The capture helper never fetches that
origin: it records inert pixel bytes with separate synthetic-fixture provenance
only when an emitted image or inline CSS background actually references one of
those URLs. The browser runner checks the same fixed set and requires all
three requests for the normal rich variant. Any other external image request
is trapped. Generated cut-arrow images are retained local `/img/` assets;
record their exact observed paths as extra capture arguments for a cut page.
With JavaScript on, a generated cut ID must acquire a stock widget and the
global cut control must target it; a source-forged ID must remain inert. One
deliberate cut click receives a fixed unsupported 400 in the synthetic browser
route, leaving hidden text absent. The real TS route's unsupported RPC response
is checked separately by the live HTTP harness.

Example, from `src/content` in the owning devcontainer after generating the
reviewed 26-row results as shown in [the corpus guide](corpus/README.md):

```sh
/opt/dw-node24/bin/node tools/capture-browser-resources.mjs \
    ../s2/target/javascript/artifacts/live/page-ts.html \
    /tmp/slice4-stock-resources.json /img/controlstrip/bg-dark.gif
/opt/dw-node24/bin/node tools/browser-entry-reparse.mjs \
    /tmp/slice4-synthetic-results.json \
    ../s2/target/javascript/artifacts/live/page-ts.html \
    /tmp/slice4-stock-resources.json > /tmp/slice4-browser-report.json
```

Add `--require-rich` for the normal rich entry: it requires the visible rich
marker, one generated cut, and all three declared synthetic image requests.
Run the separate normal-helper `forged-cut` entry with
`--require-forged-cut`: it requires one generated cut and one inert source
forged cut span. A preserved Slice3 page or test-only stock assembly qualifies
harness mechanics and resource wiring only. The browser report labels its
candidate and page as caller-supplied, unverified inputs; it never marks source
review or live-route acceptance. For acceptance, capture fresh actual TS route
responses for both variants, generate cleaner results from the exact reviewed
build, and verify them against the pinned per-case difference ledger.
A self-consistent JSON file is insufficient.
Browser process telemetry and DNS outside intercepted page requests are not
claimed by this test.

To reproduce **browser mechanics only**, build two labeled synthetic assemblies
from the preserved Slice3
stock page. This builder supplies literal test cut markup and inert images; it
does not use or qualify cleaner output. From `src/content` in the owning
devcontainer, with the retained local app running:

```sh
/opt/dw-node24/bin/node tools/build-stock-mechanics-page.mjs \
    ../s2/target/javascript/artifacts/live/page-ts.html normal-rich \
    /tmp/slice4-mechanics-rich.html
/opt/dw-node24/bin/node tools/build-stock-mechanics-page.mjs \
    ../s2/target/javascript/artifacts/live/page-ts.html forged-cut \
    /tmp/slice4-mechanics-forged.html
for variant in rich forged; do
    /opt/dw-node24/bin/node tools/capture-browser-resources.mjs \
        /tmp/slice4-mechanics-$variant.html \
        /tmp/slice4-mechanics-$variant-resources.json \
        /img/controlstrip/bg-dark.gif /img/collapse.svg \
        /img/collapseAll.svg /img/expandAll.svg /img/ajax-loader.gif
done
/opt/dw-node24/bin/node tools/browser-entry-reparse.mjs \
    /tmp/slice4-cleaner-results.json /tmp/slice4-mechanics-rich.html \
    /tmp/slice4-mechanics-rich-resources.json --require-rich \
    > /tmp/slice4-mechanics-rich-report.json
/opt/dw-node24/bin/node tools/browser-entry-reparse.mjs \
    /tmp/slice4-cleaner-results.json /tmp/slice4-mechanics-forged.html \
    /tmp/slice4-mechanics-forged-resources.json --require-forged-cut \
    > /tmp/slice4-mechanics-forged-report.json
```

`/tmp/slice4-cleaner-results.json` is a local 26-row comparison input for the
fragment checks. Both reports remain mechanics-only even if all six browser
modes pass. For the actual route, `node dist/tools/check-cleaner.js` in the S2
package creates and restores one exact marked post, records six live variants,
and saves rich and forged full pages under `artifacts/live/`. Capture their
exact public resources, then run the two required modes against those bytes.
`--stock-only` checks a full stock page without replaying all 26 fragments;
the three migrated legacy-content probes use it with their actual saved pages.

The original `t/cleaner*.t` source suites remain unmodified. `corpus/` records
their source contexts, provenance, and assertion counts. Native Perl behavior is
the compatibility oracle; browser execution and resource checks are separate
security evidence. A source case is never dropped to make the new cleaner pass.
The [corpus guide](corpus/README.md) covers all 1,116 native TAP assertions,
384 source-derived entry replays, their accepted ledger and the 219-case native
browser matrix. The [S2 live guide](../s2/target/javascript/SLICE-4.md) gives
the complete route, recovery and browser sequence.
