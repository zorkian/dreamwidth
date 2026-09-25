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

This package is independent of S2, the HTTP server, and the database. Its source
and policy API are owned separately from the build and corpus tooling. It parses
untrusted entry HTML only inside the bounded, credential-free stock render child.

The pinned qualification runtime is Node 24.21.0. Verify the official signed
release list and Linux x64 archive hash with `tools/bootstrap-node24.sh` inside
the owning devcontainer. The script extracts to `/opt/dw-node24` and leaves
`/usr/bin/node` unchanged. Build using that binary and npm:

```sh
PATH=/opt/dw-node24/bin:$PATH npm ci --ignore-scripts
PATH=/opt/dw-node24/bin:$PATH npm run build
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
`trusted-types`; Playwright and native canvas are absent. It is dependency
qualification, not a claim that the cleaner policy or stock worker is complete.

Runtime dependencies are exactly pinned in `package.json` and locked transitively
in `package-lock.json`. Playwright and TypeScript are development dependencies;
the render child must not read them. The S2 CLI and output paths remain under
`src/s2/target/javascript/dist`.

`tools/stage-runtime.mjs` builds an artifact-relative closed runtime directory
once the shared cleaner and stock worker implementations have been compiled.
Given absolute compiled stock artifact path `A`, it writes
`A.runtime/manifest.json`, with the worker at
`A.runtime/app/dist/live/render/worker.js`. It copies only enumerated compiled
S2 modules and the locked production content package closure. The parent verifies
the manifest and grants the child read access only to this root. Staging never
copies app config, credentials, browser packages or repository-wide modules.
The worker and shared package code are collected from their compiled entrypoints
through literal CommonJS relative imports. Unexpected bare or dynamic imports
fail staging. Every regular staged file is hashed in sorted manifest order;
the previous stage may be replaced only when its entire inventory still matches
its manifest. The CLI takes only the absolute artifact path, never a caller
supplied runtime root or source override.

The synthetic mechanics test runs before the real worker source is available:

```sh
/opt/dw-node24/bin/node tests/stage-runtime.test.mjs \
  /workspaces/dreamwidth/src/s2/target/javascript/artifacts/live/stock.json.sandbox
```

It stages one synthetic worker and one synthetic content module, runs them
under the original seccomp launcher with only the staged root readable, then
checks a byte-identical rebuild and rejects an unlisted symlink. Its result
qualifies the packaging boundary, not S2 rendering or sanitizer behavior.
The real stage still needs the reviewed compiled `dist/index.js` and updated
stock worker, followed by full artifact/manifest/worker route tests.

Browser availability can be checked with `tools/qualify-browsers.mjs` after
installing the pinned Playwright browser binaries and OS dependencies. It
intercepts one synthetic document and one synthetic image in each Chromium,
Firefox and WebKit JS-on/off mode. The actual assembled stock output and
security corpus need their own browser harness.

The original `t/cleaner*.t` source suites remain unmodified. `corpus/` records
their source contexts, provenance, and assertion counts. Native Perl behavior is
the compatibility oracle; browser execution and resource checks are separate
security evidence. A source case is never dropped to make the new cleaner pass.
