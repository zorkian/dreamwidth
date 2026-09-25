<!--
CLEANER-POLICY.md

Focused entry-cleaner compatibility decisions and executable probes.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Entry body component checks

These checks exercise the actual shared cleaner and retained Perl `html_raw0`
entry context. They do not replace the source-indexed corpus, assembled-page
browser matrix, isolated worker tests or live-route privacy tests. Subjects keep
their separate plain-text policy.

From the checkout root inside the development container:

```sh
/opt/dw-node24/bin/node src/content/node_modules/typescript/bin/tsc -p src/content/tsconfig.json
/opt/dw-node24/bin/node src/content/node_modules/typescript/bin/tsc -p src/s2/target/javascript/live/tests/cleaner.tsconfig.json
/opt/dw-node24/bin/node --test src/s2/target/javascript/dist/live/tests/cleaner.test.js
/opt/dw-node24/bin/node --test src/s2/target/javascript/live/tests/cleaner-browser.test.mjs
```

The browser test uses the package's pinned Playwright Chromium installation and
its required OS libraries. It intercepts every browser request; no external
resource is fetched. Both JavaScript modes inspect actual computed styles and
reparse the emitted fragment inside an entry container. Raw negative controls
must demonstrate working fixed/absolute escapes, custom-property substitution
and an intercepted escaped resource URL. A browser that never exercised those
capabilities cannot pass the test.

## Applicable source policy

`LJ::CleanHTML::clean_event` supplies entry allow mode, `cleancss`, and the
`event_eat`/`event_remove` lists. Its attribute loop is in
`cgi-bin/LJ/CleanHTML.pm:714`; it does not provide a small positive HTML or CSS
property list. `src/content/src/policy/inventory.ts` explicitly enumerates the
ordinary HTML elements and attributes covered by this body implementation,
including legacy presentation attributes. DOMPurify receives this inventory
directly with explicit content retention, rather than determining coverage from
its default profile. Uncovered representations return a typed failure with no
fragment; they are not silently unwrapped or erased.

After sanitation, the component audits `purify.removed` for compatibility loss.
Any additional source element/text or attribute removal returns Unsupported,
except the exact maintained `SANITIZE_DOM` name-collision predicate against a
fresh inert document/form. This audit never confers safety on unsanitized input
and never overrides a sanitizer decision. `SAFE_FOR_XML`, protocol screening
and the other maintained defenses remain enabled. Final sanitation receives the
cleaner's private BODY node through DOMPurify's non-IN_PLACE cloning path. Source
body-wrapper attributes are cleared according to the retained remove-tag rule;
no caller DOM or post-sanitation markup modification is allowed. This avoids
reinterpreting the transformed tree as a new full document. `basefont` itself
refuses explicitly in this finite representation, as detailed below. Tests cover multiple visible siblings, form descendants, empty output and actual
browser reparse.

| Case | Retained behavior and shared result | Classification and probe |
| --- | --- | --- |
| `target`, `hspace`/`vspace`, `accesskey`, `contenteditable` | Keep the values; preserve classes, ordinary names and legacy formatting. | Source-compatible positive cases; native Perl and actual-library unit tests. |
| `xmp`, `listing`, `plaintext`, `noframes` | Rawtext/parser-state behavior is outside the finite div-flow representation; return Unsupported, including when hoisted into the head. | Representation refusal, including when retained Perl preserves visible text or unwraps `noframes` into live bold markup. Never report successful empty output or escaped markup as parity. Native positive baselines cover `xmp` and both leading/body `noframes`. |
| Leading or body `template` | Return Unsupported in both positions. | Representation refusal; head inventory prevents a leading template from disappearing before the ordinary body check. |
| Custom element wrappers and unexamined attributes | Return Unsupported instead of using DOMPurify's default unwrapping/removal. | Explicit uncovered representation; `custom-el` has a native positive baseline. Additional names need an examined policy before admission. |
| External `form` association, command/popover targets, custom-element `is`, slot/shadow controls | Return Unsupported. | Named capability boundary: these can associate with or invoke controls outside the entry fragment; source ID stripping does not constrain an external target. |
| Ordinary `name`, versus DOM-clobber collisions | Ordinary anchors survive; DOMPurify `SANITIZE_DOM` removes names found on its inert document or form, including `location`, `cookie`, `body`, `submit`, `title`, `attributes` and `nodeName`. | Security difference broader than a few global names: it includes form controls such as `input name="submit"`. Only the colliding name is exempt from the removal audit; visible descendants, input values and ordinary names must survive. Unit/native and JS-on/off browser reparse probes cover the form case. No blanket prefixing or removal of names. |
| Source eat/remove tags and leading head-hoisted elements | Source eat tags lose contents; source remove tags lose wrappers. Head inventory permits only source-discarded base/link/meta/style/title/script and recursively checked noscript metadata/whitespace. Visible noscript body content remains. | Retained context transformation; explicit inventory, not incidental sanitizer defaults. All other head contexts refuse instead of disappearing. |
| Source comments | Remove before final sanitation. | `clean_event` does not enable `keepcomments`; native/unit tests verify surrounding visible text remains. Parser diagnostics do not log author markup. |
| Foreign SVG/MathML, active event attributes, `srcdoc`, `ping`, foreign namespace attributes | Remove the foreign subtree or named active attribute. | Security differences constrain executable/foreign markup and automatic ancillary navigation. No browser fetch occurs in the cleaner. |
| `gopher`, `magnet`, `spotify`, FTP and IRC navigation | Preserve existing absolute scheme bytes. | Native Perl and unit positives. Maintained DOMPurify unknown-protocol handling remains enabled after the source dangerous-scheme removal. |
| `jscript`, `livescript`, `javascript`, `vbscript`, `about`, `data` attribute values | Remove the attribute through the source screen. | Native source denylist, including whitespace/case variants; no small navigation protocol allowlist. Form, image and CSS resource policies remain distinct. |
| Additional `applescript`, `ecmascript`, `xscript` attribute values | Return Unsupported when maintained DOMPurify rejects the attribute, even for non-navigation text such as `td abbr`. | Named sanitizer compatibility boundary; Perl preserves these examples. Do not override the maintained broader script-protocol defense or silently drop visible text. Native and unit cases cover each example. |
| XML/mutation-sensitive attribute text: title `a]>b`, `x --> y`, `</textarea>`, image alt `-->` | Return Unsupported when `SAFE_FOR_XML` removes the attribute. | Maintained representation/security boundary, including otherwise inert visible tooltip/alternative text. Native/unit probes document that Perl keeps the escaped values. Never disable this defense or report successful text loss. |
| Escaped `</textarea>` in textarea text | Preserve the escaped text and following visible sibling when the sanitizer preserves them. | Positive actual second-pass case; the attribute-text refusal above is not a blanket ban on text containing markup-shaped bytes. The removal audit still covers unexpected whole-element removal. |
| `data-x:y`, `aria-x:y`, `aria-x.y` | Return Unsupported before sanitation. | Attribute-name domain matches DOMPurify's separate DATA_ATTR/ARIA_ATTR expressions. Perl retains the colon cases and reports a parse failure for dotted aria; tests retain that distinction instead of claiming identical behavior. |
| `position:\66 ixed`, `position:\61 bsolute`, and `--p:\66 ixed;position:var(--p)` | Strip backslashes from the actual value before screening, AST parsing and emission. Literal `66 ixed`/`61 bsolute` remain inert, as in Perl. | Exact native byte comparisons, actual second cleaning, Chromium computed static positions in both JavaScript modes. |
| `posit\69 on:fixed`, `width:expres\sion(1)` | Removing backslashes exposes the source-denied keyword; remove the style. | Native byte comparisons and browser cases. |
| `background:u\72l(/x)`, `width:e\78pression(1)` | Emit source-transformed inert `u72l`/`e78pression`, never the original escapes. | Native byte comparisons and browser negative controls. If transformed CSS cannot be parsed without opaque Raw tokens, return Unsupported. |

The CSS transformation is `CleanHTML.pm:769`, before the secondary
`CSS::Cleaner` screening and modern AST/resource inspection. It is not a new
property allowlist. Ordinary relative positioning, font/color styling,
transforms, grid, custom properties and `var()` remain supported. Image proxy
policy does not apply to inline CSS URLs.

Actual output-as-input idempotence is tested for ordinary flow, CSS and links.
Two retained transforms deliberately are not idempotent: generated cut IDs lose
their trusted-generation provenance when submitted as new raw input, and the
extract-images reader option extracts the generated placeholder again. The
separate native second-pass probe demonstrates both transformations. Source IDs
are never trusted merely because their spelling resembles a generated cut ID.


## Formatting reconstruction boundary

`formatting-cases.ts` records all 98 raw inputs, unnormalized retained Perl
outputs and individual expected classifications. The unit probe reruns Perl for
every row. Of those rows, 75 require exact bytes; seven explicitly record different
serialization (nested anchors, five table cases, and an ordinary omitted paragraph
end). Chromium checks retained visible text, font family/size/weight/style, color,
link scopes and text-node positions after actual stock page assembly. The ordinary
paragraph case retains Perl's extra empty-p reparse difference in the ledger while
requiring equal visible text and layout. The 16 remaining implicit-formatting,
adoption and foster cases require Unsupported with no fragment, followed by
successful recovery. Unsupported cases are not parity.

The repair follows the explicit-close stack behavior at
`cgi-bin/LJ/CleanHTML.pm:1175`: outside tables, an explicit ancestor end tag closes
intervening formatting. The parser copies original start-tag locations when it
reconstructs formatting. Only later nodes with the same tag and exact start-tag
span can be candidates; the first node remains intact. Repair requires matching
original DOM/source ancestry, the original implicit end exactly at that explicit
ancestor end tag, and source-located contents after its complete boundary. All
proofs are checked before any node is unwrapped. Ordinary outer formatting and
properly closed formatting remain unchanged.

Table scope has a separate retained exception: it does not pop intervening tags.
Reconstructed formatting stays intact only within the same source/DOM table,
with contents bounded by its source range. Fostered formatting outside that
source table refuses. Source-less adoption nodes and unproved reconstruction or
implicit formatting boundaries refuse instead of changing visible formatting.
Ordinary omitted paragraph/list ends without that unproved formatting stay
supported; native/browser tests retain any raw serialization difference and check
actual text-node positions. This is a finite representation boundary, not a
replacement legacy parser.

For assembled formatting browser tests, first build the adapter test project and
compile the stock artifact using the commands in `COMPONENT.md`. Set
`S2_LIVE_TEST_ARTIFACT` to that artifact path (default `/tmp/slice3-stock.json`).
The browser probe uses actual stock layer initialization/printing offline;
credential-free worker execution remains a separate test. It intercepts every
resource request and runs both JavaScript modes. Negative controls verify the
raw malformed input actually spreads bold/color before the repair.


`basefont` is an explicit narrow representation refusal in any source position:
leading, inside the body, after an eaten/removed predecessor, or in an explicit
head. Retained Perl emits `<basefont size="3">text` for the leading and removed-
predecessor probes, `<p>before</p><basefont size="3">text` after a paragraph, and
`<basefont size="3"><p>after</p>` after an eaten iframe; the explicit-head probe
retains only `text`. The native/unit test preserves these exact outputs. A first
successful modern body result could become head-hoisted on raw re-entry, so this
finite cleaner returns Unsupported instead of silently dropping the element,
inventing source relocation, or adding an idempotence exception. This refusal
does not apply to ordinary inline `font` formatting.


## Source consumption and explicit close tokens

`source-cases.ts` records raw native outputs and the finite supported/refused
source-context probes. Before transformations create nodes, `policy/source.ts`
checks parser start/end-tag spans and text/comment/doctype spans. Whole element
ranges are not treated as proof of visible token consumption. Both uncovered
ranges and text ranges are inspected: a merged `xy` text node can span the lost
`</table>` in `x</table>y`. The narrow prefix/name detector rejects lost starts,
table-part ends and form closes. It does not rewrite HTML or replace the parser.
Plain less-than text and entities remain text. Rawtext, comments and independently
eaten/foreign content are excluded from visible-loss classification.

Source-less author nodes refuse, including implied `tr`, stray-end-tag `br`, and
an empty paragraph created by a stray `</p>`. Parser document scaffolding and
harmless implied `tbody`/`colgroup` remain. Orphan `tr`/`td` and other dropped table
parts refuse instead of returning successful `hellobye` or empty output where
retained Perl displayed literal escaped tag tokens. Normal tables remain supported.
Equivalent stray `b`, `div`, `span` and `ul` closes remain supported.

An already identified document-wrapper start inside a gap/text range gets narrow
maintained-JSDOM assistance: parse only the remaining range, require the first
explicit html/head/body token at offset zero, obtain its exact quote-aware start
span, then continue detecting after that span. Do not exempt the whole gap. Thus a
quoted `<td>` in a pasted BODY attribute is ignored, but a following real orphan
`td` refuses. Helper documents use no scripts/resources and close in `finally`.
The per-entry work ceiling is 32 helper parses and cumulative helper UTF8 bytes
at most four times `maxInputBytes` (normally 256KiB). Exceeding either ceiling
returns Unsupported before the next parse. The real-worker test supplies 48KiB
of 8,000 BODY starts and requires typed Unsupported, not a timeout, then recovery.
Original whole-worker deadline, output, heap and credential denials remain.

Source-removed tags and document wrappers cannot prove formatting closure.
Outside table scope, descendant source extents crossing an explicit retained
ancestor close refuse, even when merged text starts before that boundary. This
covers form-close scope loss. Outside a form, select/option replacement preserves
literal escaped closing tokens only when the parser records an actual source
endTag. No implicit parser closing token is invented. Native and browser tests
verify both complete and incomplete control sequences.
