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

| Case | Retained behavior and shared result | Classification and probe |
| --- | --- | --- |
| `target`, `hspace`/`vspace`, `accesskey`, `contenteditable` | Keep the values; preserve classes, ordinary names and legacy formatting. | Source-compatible positive cases; native Perl and actual-library unit tests. |
| `xmp`, `listing`, `plaintext` | Rawtext/parser-state behavior is outside the finite div-flow representation; return Unsupported. | Representation refusal, including when retained Perl preserves visible text. Never report successful empty output. `xmp` has a native positive baseline. |
| Custom element wrappers and unexamined attributes | Return Unsupported instead of using DOMPurify's default unwrapping/removal. | Explicit uncovered representation; `custom-el` has a native positive baseline. Additional names need an examined policy before admission. |
| External `form` association, command/popover targets, custom-element `is`, slot/shadow controls | Return Unsupported. | Named capability boundary: these can associate with or invoke controls outside the entry fragment; source ID stripping does not constrain an external target. |
| Ordinary `name`, versus `name="location"` and other DOM-clobber collisions | Ordinary anchors survive; DOMPurify `SANITIZE_DOM` removes colliding names. | Narrow security difference; unit test distinguishes an ordinary anchor from a collision. No blanket prefixing or removal of names. |
| Source eat/remove tags and leading head-hoisted elements | Source eat tags lose contents; source remove tags lose wrappers. Leading head-hoisted style/script/title/meta/link are absent from the body. | Retained context transformation; explicit sets, not incidental sanitizer defaults. |
| Foreign SVG/MathML, active event attributes, `srcdoc`, `ping`, foreign namespace attributes | Remove the foreign subtree or named active attribute. | Security differences constrain executable/foreign markup and automatic ancillary navigation. No browser fetch occurs in the cleaner. |
| `gopher`, `magnet`, `spotify`, FTP and IRC navigation | Preserve existing absolute scheme bytes. | Native Perl and unit positives. Maintained DOMPurify unknown-protocol handling remains enabled after the source dangerous-scheme removal. |
| `jscript`, `livescript`, `javascript`, `vbscript`, `about`, `data` attribute values | Remove the attribute through the source screen. | Native source denylist, including whitespace/case variants; no small navigation protocol allowlist. Form, image and CSS resource policies remain distinct. |
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
