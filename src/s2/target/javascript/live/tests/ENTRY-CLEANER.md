# Full-entry content component checks

Run inside the owning devcontainer after the shared package build:

```sh
cd /workspaces/dreamwidth/src/content
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc -p tsconfig.json
cd /workspaces/dreamwidth/src/s2/target/javascript
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc -p live/tests/entry-cleaner.tsconfig.json
SLICE5_METADATA_REPORT=/tmp/entry-metadata.json /opt/dw-node24/bin/node --test dist/live/tests/entry-cleaner.test.js
/opt/dw-node24/bin/node --test live/tests/entry-cleaner-browser.test.mjs
```

The optional report records raw source, retained Perl helper output, candidate
output and source SHA256. Its `.adaptations.json` companion records both helper
strings and final collapsed, 300-character-trimmed, escaped OpenGraph values for
the explicitly classified parser differences. Nothing is normalized for equality.
The Perl oracle is an offline test driver. Serving does not execute it.

These tests cover the shared content component. They do not establish an actual
EntryPage route, repository privacy, the staged render worker or full application
acceptance. Existing `cleaner.tsconfig.json` / `cleaner.test.js` checks must also
pass to establish that Recent behavior remains unchanged.

## Full cuts

The entry context admits the same maximum16 flat, explicitly closed,
source-proven lj-cut/cut/div.ljcut boundaries as the recent context. Recent omits
their bodies; entry cleans every displayed descendant and generates inert
`name="cutidN"` anchors. div.ljcut keeps its retained wrapper and label. Neither
source IDs nor ordinary named anchors confer generated-widget authority. Duplicate
cut names preserve the retained first-match fragment behavior.

Ordinary full lj-cut output is stable on actual raw re-entry. Full div.ljcut
output gains another anchor when passed through the retained cleaner again;
tests record that explicit source-transform exception instead of claiming byte
idempotence. Browser reparse checks remain separate. Hidden unsupported template
content can be omitted in Recent yet refuse the full entry.

## Inert metadata

`EntryCleaner.metadata` parses the approved raw input independently. It returns
`InertEntryMetadata`, never a body fragment. Retained `event_text` is not DOM text:
it retains serialized rich tags and entity lexemes, performs contextual newline
and HTTP URL autolinking, and includes full cut text without generated cut markup.
It does not apply the body URL-origin adaptation. The plain-subject gate remains,
including refusal of an empty subject. Eligible user-mention/escape conversions,
legacy Markdown markers and unsupported application tags explicitly refuse;
ordinary email, code/pre examples, attributes and eaten text are not blanket
refused for containing `@`.

Only the render child consumes these strings, using retained ASCII whitespace
collapse/trim, Unicode-scalar300 truncation and exactly-once attribute escaping.
Entities count by their literal helper spelling before escaping. NBSP is not
ASCII whitespace. Unsafe-looking serialized strings never become active HTML.

Source whitespace before BODY exists is meaningful here. Leading whitespace and
independently located HTML/implicit-HEAD whitespace are retained; explicit source
HEAD contents remain eaten. A merged text extent may omit only exact wrapper
endTag spans supplied by the maintained parser. A private textarea fragment
decodes entities solely to prove correspondence with parsed text; its decoded
value is never the metadata output. The proof processes at most twice the raw
input byte limit. Unlocated ignored closes such as `x</b>y` are ambiguous helper
representations and refuse explicitly. No custom tokenizer or whole-gap waiver
is used. Existing source-audit limits, including32 wrapper helpers and four input
byte ceilings, remain in force.

The HTML5-discarded initial pre/textarea newline has two exclusive source-proof
cases. An exact single LF/CRLF gap between the located start tag and first child
or end tag is restored once. If the first text extent includes it instead, only
the consistency comparison may omit that one initial LF/CRLF; output retains the
raw bytes. No later child, intervening markup, bare CR, encoded newline or general
mismatch is normalized. Displayed body handling is unchanged.
The locked parser reports an inconsistent text start inside `&amp;` for
`<pre>\n&amp; &#10; one</pre>`; the decoder proof detects this and the metadata
operation explicitly refuses. The `.refusals.json` report retains that raw case
and native helper result, alongside unqualified bare-CR/entity-initial-newline
cases. This limitation does not rewrite stored content or widen source offsets.

Three named families retain modern DOM serialization in inert metadata:
ordinary omitted p ends, omitted li ends, and previously admitted table/cell
omitted ends. Retained Perl can emit nested or unclosed tokens where the maintained
parser serializes siblings and closing tokens. These are metadata-visible
adaptations: literal tags affect the parsed OG string and the300-character budget.
Tests preserve source text order, compare unchanged displayed body behavior, and
record exact raw helper/OG differences near that boundary. They are not a general
waiver for other metadata differences.

All parsing stays in the existing single credential-free worker with no scripts,
resource loading or caller DOM. Original input, node, depth, CSS, output, heap and
whole-worker deadline bounds still apply. Browser component probes cover Chromium
with JavaScript on/off and positive attack controls; the application acceptance
suite separately owns the actual-route multi-engine matrix.
