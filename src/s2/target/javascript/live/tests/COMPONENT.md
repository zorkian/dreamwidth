<!--
COMPONENT.md

Component test guide for the bounded local live S2 renderer.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Live S2 component checks

See [the slice 3 guide](../../SLICE-3.md) for local setup, the actual HTTP route,
real-database differential testing and retained-app navigation. Run these
component checks inside the checkout's own devcontainer, from the repository root:

```sh
perl src/s2/target/javascript/tools/live-compile.pl /tmp/slice3-stock.json
cd src/s2/target/javascript
./node_modules/.bin/tsc --strict --target ES2022 --module CommonJS --moduleResolution Node --esModuleInterop --types node --noUncheckedIndexedAccess --outDir dist --rootDir . live/contracts.ts live/policy/*.ts live/render/*.ts live/tests/*.ts
node --test dist/live/tests/*.test.js
```

`S2_LIVE_TEST_ARTIFACT` can select another compiled artifact path for the tests.
The offline compiler requires existing `cc` and emits the JSON artifact plus
`<artifact-path>.sandbox`. Keep generated files outside version control. JSON
schema 1 / ABI 1 contains two ordered source/hash/variable/code records; both source
hashes and deterministic compiled-code hashes are verified. No prepared
properties, pages, database data or HTML are compiler inputs.

The suite checks:

- Content admission and actual retained `html_raw0` cleaner identity for Unicode,
  entities, paragraphs, inline tags, whitespace and empty elements.
- Anonymous request/redirect admission, tainted headers and ambiguous paths,
  private-entry exclusion, suspended-public whole-response refusal, unsupported
  features, source hashes and dynamic `system` layer-owner identity.
- Cookie parsing, legacy two-part timestamp backtracking/renewal, first/return
  requests, percent-encoded colons, exact expiry headers and challenge bytes
  against actual retained Perl helpers with explicit offline fixture entropy.
  This protocol unit test uses a declared fixture key. Real local-key verification
  belongs to the integrated HTTP/oracle checks.
- Actual isolated child filesystem, network, subprocess and worker restrictions,
  inherited-descriptor closure, deadline/output/close behavior, artifact tampering,
  live entropy, revocation during rendering and subsequent-request visibility.
- Request skip/presence, the retained page 80 / loader 79 clamps, mixed public/private
  pagination, original request echoes and the exactly-full final-page link corner.

Component tests do not establish full real-database HTML parity. Integration must
also prove the first TS request before any Perl journal GET, normal post/edit
refresh, full-page byte comparisons, real-key verification, and the actual TS
recent endpoint while the Perl app is unavailable. The comparison is controlled
by explicit clock/random/uniq and `PERL_HASH_SEED=0 PERL_PERTURB_KEYS=0`; HTML is
never normalized. Serialization order can differ under another Perl hash seed.

## Real database privacy checks

After the first TS-before-Perl-GET proof and local setup in the slice 3 guide, run
from `src/s2/target/javascript` inside the owning container:

```sh
./node_modules/.bin/tsc
node dist/live/tests/privacy-db.js
```

Run sequentially, with no other mutations of the marked journal. This uses the
real read-only store, ordinary live service and Fastify over a loopback HTTP
socket. An offline Perl driver changes only the marked owner's visibility,
activation status, reply/adult/analytics/custom-content settings and style
selection through normal `update_self` / `set_prop` helpers between requests.
It does not invoke account deletion/cancellation hooks, alter style records or
change entries. Each case must revoke the original fingerprint, return the exact
fixed HTTP 422 refusal without HTML or cookies, then restore the full raw
fingerprint and HTTP 200. Unsupported custom content is never reflected.

The driver records the primary baseline and mutation intent in the ignored,
mode-0600 `artifacts/live/privacy-state.json` before changing anything. Existing
recovery state and unexpected field changes are refused. Normal `finally` cleanup
restores the baseline and removes this state only after fingerprint verification.
If interrupted, use the same scoped recovery path:

```sh
node dist/live/tests/privacy-db.js --recover
```

Recovery verifies the marked identity, restores only recorded test fields and
checks the saved complete primary fingerprint before closing its state. If an
unrelated change prevents verification, the recovery state is retained for
inspection; never reset the database or clear it to bypass the check. No Perl
driver runs in the product request path. Entry mutations, pagination, crossjournal
checks and full HTML comparisons remain in the integrated slice 3 harness.

## Boundaries

The supported launcher platform is Linux x86_64 with Node 20. It closes inherited
file descriptors beyond explicit stdio, sets `no_new_privs`, validates the syscall
architecture, rejects x32, and denies sockets, network calls and `io_uring`.
Filter/launcher failure stops rendering. Node permission mode restricts readable
JS modules and denies writes, subprocesses, workers and addons. The parent sends
only LANG/TZ and approved public input. This isolates **trusted pinned stock
code**; it is not an arbitrary JavaScript hosting sandbox. No privilege,
capability or container changes are required.

The renderer is capped at two concurrent children, 10 seconds, 2MiB HTML and
128MiB heap. It executes source-derived defaults, `prop_init`, `modules_init` and
stock `Page.print`. Static resource timestamps are loaded at service creation;
restart the service after rebuilding static resources.

The body grammar permits plain UTF8 text, balanced lowercase `p`, `strong`, `em`,
`b`, `i`, and `br`/`br />`, with no attributes or URLs. Only `amp`, `lt`, `gt`,
`quot` entities are admitted. Limits are 64KiB per body, nesting 16, tokens 4096
and 2MiB for the complete candidate cohort. Subjects are nonempty plain UTF8,
at most 1KiB, without markup, entities, quotes or controls. Unsupported input is
refused rather than repaired. Trusted stock markup is separate from user content.

Only the finite stock-page destinations enumerated by `policy/redirects.ts` are
redirected to the configured retained app: exact controls/date paths and
constrained `/stc`, `/img`, `/js` resources. POST `/login` and `/multisearch` receive
an early 307 without body access. These browser navigations are distinct from TS
page preparation; redirects neither fetch nor process app output.

A fresh independent primary fingerprint check is the final authorization decision
after full HTML buffering. The server must enqueue immediately after success.
Later commits and network receipt are outside this guarantee. The dev-cohort
refusal design exposes a coarse 422/200 distinction for unsupported private-state
or count changes; it never returns those fields, bodies or calendar counts. This
bounded behavior must not be generalized to arbitrary production journals.

Ported helpers retain inherited LiveJournal GPL notices; template/FormHTML and
challenge source authors/notices are retained separately. Static template strings
come from repository source and shipped `en.dat`, never recorded oracle fragments.
