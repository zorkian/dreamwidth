<!--
SLICE-16.md

Original-source entry editor formats and independent metadata.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Slice 16: ordinary entry editor formats

## Source format selection

Selected Personal Recent and Entry bodies support explicit `html_raw0`,
`html_casual0`, `html_casual1`, and `rte0`. The retained `rte0` has no formatting
option map and uses casual1, even when preformatted is set. Unsupported truthy
editor names refuse; native unknown names default to casual1, so this is an
explicit unsupported-format boundary.

An absent, null, empty, or Perl-false `0` editor follows the original source
order: magic `!markdown` at the beginning of the raw body; preformatted;
**defined** import source; stored logtime before `2019-05`; otherwise casual1.
Stored empty and `0` import sources are defined and choose casual0. Missing or
null import source does not. Explicit editor wins over all inference inputs.
False body empty/`0` returns before format work. Markdown, including aliases and
inferred magic Markdown, is deferred and refuses only when reached.

Casual0 adds LF/CRLF breaks and HTTP autolinks without mentions; casual1 also
uses native byte-semantics mention/escape ordering. Ordinary email remains
literal. Reached account/custom expansion refuses; no raw or plain downgrade.
Pre/textarea preserve source whitespace and suppress autolinks/mentions. Code
suppresses mentions but still adds breaks. Bare CR remains literal when its
source extent has a maintained-parser equality proof; ambiguous provenance
refuses. Existing source/cut/CSS safety and resource limits remain in force.

This is a separate entry operation. It does not apply customtext final-LF or
second-clean behavior, or comment extraction/deny/class rules. Recent cuts omit
hidden text before reached casual checks; full Entry displays its cleaned body
and inert cut anchor. Original props/text/logtime remain fingerprinted and
freshly reread, and persistent changes revoke buffered HTML.

Any reached unsupported format or capability in **any selected Recent body
refuses the entire selected page**. There is no silently omitted entry or
partial response. Journal/entry privacy and disabled-comment no-read boundaries
are unchanged.

## Independent OG and representation boundaries

Entry OG description comes from the existing original-source `event_text`
operation, without display editor, import, preformatted or logtime. It never
uses displayed HTML or DOM textContent. Casual0 can display a literal mention
in Recent while Entry OG encounters that mention and refuses. Explicit raw can
display `!markdown` in Recent while Entry OG requires deferred Markdown and
refuses. The existing metadata proof refusal for escaped-at text also remains;
display unescaping does not grant a metadata capability. Subject/title,
literal-tag/entity 300-character budget, trimming and escaping are unchanged.

Native fixed outputs and viewer expected outputs are asserted separately.
HTML5 display serializes generated breaks as `<br>` rather than native
`<br />`, and safely serializes literal ampersands as `&amp;`. No comparison
normalizes either result. Ordinary styling and the existing explicit URL-origin,
containment and sanitizer boundaries remain documented in
[live/tests/CLEANER-POLICY.md](live/tests/CLEANER-POLICY.md). This package does not
claim general Perl editor/Markdown or arbitrary caller stylesheet parity.

## Reproduction

Run in the owning devcontainer. [SLICE-6.md](SLICE-6.md) provides Node24 bootstrap,
locked package setup and no-connect private config export/main startup.
[SLICE-14.md](SLICE-14.md) provides pinned browser installation and qualification.
Use a current Entry comparison page as the stock stylesheet reference, with its
actual ID; do not assume an owner-specific ID.

```sh
cd "$LJHOME/src/content"
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
cd "$LJHOME/src/s2/target/javascript"
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
mkdir -p /tmp/editor-check
perl tools/live-compile.pl /tmp/editor-check/stock.json
/opt/dw-node24/bin/node ../../../content/tools/stage-runtime.mjs /tmp/editor-check/stock.json
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT=/tmp/editor-check/stock.json \
  /opt/dw-node24/bin/node --test dist/tools/editors.test.js dist/tools/editors-http.test.js
```

Optional representative actual browser:

```sh
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT=/tmp/editor-check/stock.json \
S2_EDITORS_STOCK_PAGE="$LJHOME/src/s2/target/javascript/artifacts/live/entry-ts-<current-id>.html" \
S2_EDITORS_BROWSER_OUTPUT=/tmp/editor-browser-check \
  /opt/dw-node24/bin/node --test dist/tools/editors-http.test.js
```

The compact native driver uses actual Entry/CleanHTML helpers, DB tripwires and
31 fixed cases. Its synthetic mention provider proves reached capability only,
not account/link behavior. The actual isolated SQL/store/child/HTTP test proves
selected formats, independent OG refusal, private/foreign exclusion and
editor/import/logtime revocation with exact restoration. Task-owned schemas are
dropped in the existing fixture finally cleanup. The browser uses actual TS
output with exact observed retained assets and an explicitly recorded mapping
from fixture style44 to the same qualified stock layout. Its single declared
navigation is intercepted; undeclared resources fail, with no external fetch.
It proves newline, destination, CSS and full-cut display, not native full-page
feature byte equality or binary-route parity. Generated reports are ignored.

Fresh current-build410 raw/Entry62 attestations, no-format Recent/Entry parity,
canonical prior feature/privacy tests and repository checks remain final gates.
Compiler/runtime/stager/dependency rules are unchanged. Broader Markdown,
custom capabilities, remaining comment metadata and broader styles remain
explicit subsequent work.
