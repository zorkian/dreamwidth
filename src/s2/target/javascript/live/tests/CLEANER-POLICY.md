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
and the other maintained defenses remain enabled. DOMPurify's generated body
wrapper is admitted internally so it is not mistaken for a removed source node;
source body tags are absent from the serialized input. Tests cover multiple
visible siblings, form descendants, empty output and actual browser reparse.

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
