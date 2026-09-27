<!--
SLICE-17.md

Bounded anonymous entry Markdown rendering and independent metadata.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Entry Markdown

The private anonymous viewer supports explicit `markdown0`, its retained
`markdown` and `markdown_latest` aliases, and the native ASCII `!markdown`
first-line inference for missing or Perl-false editor values. Explicit editor
precedence, false body bypass, import definedness and date inference remain as
[Slice16](SLICE-16.md). An unsupported selected entry refuses the whole Recent
page; entries are never silently omitted.

## Semantics and safety

This is CommonMark rendering through pinned MIT `markdown-it` **15.0.2**, followed
by the existing credential-free semantic HTML/CSS cleaner. It is not general
`Text::Markdown` parity. The explicit commonmark options enable raw HTML and XHTML
void output, disable linkify/typographer/breaks/highlighting, and set maxNesting20.
Fences are disabled. Maintained ordered-list tokens lose their `start` attribute,
matching the native default start1, including parsed nested lists. Classic nested
non1 lists without a separating blank line can instead remain continuation text
in CommonMark; that visible parser difference is recorded, not normalized away.

Conversion runs in the existing bounded worker. Original source/context hashes
remain separate from the stripped/selected conversion source and intermediate
HTML hashes. Conversion provenance records the converter/options digest and token
count. Parser locations, cut and image spans, and inert helper slices refer to the
**intermediate HTML**, never pretend to index original Markdown. Request-auth
preprocessing uses the shared helper from the original selected input. Converted
HTML receives no safePrint membership or special sanitizer bypass.

The original and intermediate UTF8 inputs are each bounded to64KiB; conversion
counts at most4096 maintained tokens including children. Instance-local delegates
refuse nesting beyond16 before the maintained parser can silently truncate at20.
A delegate around the original backticks rule inspects only source spans actually
consumed into emitted code_inline tokens: multiline/edge-LF code spans refuse
because classic Markdown retains their visible newline while CommonMark replaces
it with space. Ordinary paragraph line breaks beside single-line code remain
supported. No prototype or shared parser is mutated. An instance-local delegate declines only
the exact backslash-at match in the maintained escape rule, preserving both bytes
for native-order mention processing. All other escape grammar remains maintained.

Block `div.ljcut` supports full Entry content and Recent omission. Inline cuts under
paragraph ancestry refuse under the existing cut boundary. Raw HTML with decoded
`markdown=1/on/yes` requests unported recursive Markdown and refuses; a code literal
containing that attribute remains ordinary text. Reached account/site expansions,
including native eligible mentions, refuse. Harmless email and code examples and
native escaped-at pairs retain their context-specific behavior. Markdown adds
neither casual autolinks nor automatic BRs after conversion.

Unsafe Markdown link destinations are filtered by the maintained converter. Its
literal syntax can differ visibly from the native label-only anchor; this is an
explicit security/representation adaptation. Safe relative destinations retain
the existing canonical-origin adaptation. Email links are deterministic rather
than the native randomized decimal/hex character entity representation, including
literal helper text and its300-character preview budget. No email/entity output
normalization is used in comparisons.

All existing DOM/CSS/cut/image/cohort/output limits, worker10s/128MiB and closed
runtime denials remain unchanged. The sole staging import addition permits the
pinned `markdown-it` production package; unknown dependencies, path escapes,
manifest/lock tampering and credentials/network/children remain denied.

## Independent OG

The inert event helper selects from the original body independently of display:
magic chooses independently stripped Markdown; no magic retains the native casual
helper even if display is explicitly Markdown. Conversely, an explicit raw entry
with magic remains raw on display but gets Markdown OG. False body returns before
conversion. Subject helper and final collapse/trim300/attribute escaping remain
unchanged. The helper never consumes displayed sanitized HTML or DOM textContent.
Existing nonmagic source-proof/capability refusals remain, including the raw
angle-email proof boundary and escaped-at helper boundary.

Raw parser whitespace bytes are preserved as measured. Any representative stock
normal-white-space equivalence has only that scope; arbitrary pre/pre-wrap caller
styles are not claimed equivalent. The unchanged independent410 Recent and62 Entry
expectations are preserved; new Markdown contexts have separate native assertions.

## Reproduce focused checks

Run in the owning devcontainer with the pinned Node24 setup described in
[Slice6](SLICE-6.md). Installation disables lifecycle scripts; system Node remains
unchanged. From `$LJHOME`:

```sh
cd src/content
PATH=/opt/dw-node24/bin:$PATH npm ci --ignore-scripts
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
/opt/dw-node24/bin/node --test tests/markdown-adapter.test.mjs
cd ../s2/target/javascript
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
/opt/dw-node24/bin/node --test dist/tools/editors.test.js
mkdir -p /tmp/markdown-check
perl tools/live-compile.pl /tmp/markdown-check/stock.json
/opt/dw-node24/bin/node ../../../content/tools/stage-runtime.mjs /tmp/markdown-check/stock.json
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT=/tmp/markdown-check/stock.json \
  /opt/dw-node24/bin/node --test dist/tools/editors-http.test.js
```

The native provider keeps all31 prior editor records and separately supplies27
compact Markdown records. The actual isolated SQL/current-child HTTP test covers
explicit aliases and inference, private/usemask invalid bytes and foreign journal
isolation, independent OG and editor/source during-render409 with exact restore.
Its fixture schemas are cleaned by their existing guarded finally mechanism;
ordinary accounts are not mutated.

Representative Chromium proof reuses the finite captured stock resources and
qualified fixture-style44 mapping from [Slice16](SLICE-16.md). Set
`S2_MARKDOWN_BROWSER_OUTPUT` and `S2_EDITORS_STOCK_PAGE` to the current retained
Entry comparison page while running the actual fixture HTTP test. It checks heading,
list start1, computed rich styling, full cut, OG and an exactly intercepted declared
safe destination. This is layout/destination evidence, not native whole-page byte
parity or a new blanket resource fulfillment policy.
