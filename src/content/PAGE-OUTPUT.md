<!--
PAGE-OUTPUT.md

Native generated-page output channels, lexical policy, and independent tests.

Authors:
      Dreamwidth contributors

 Copyright (c) 2026 by Dreamwidth Studios, LLC.

 This program is free software; you may redistribute it and/or modify it under
 the same terms as Perl itself. For a copy of the license, please reference
 'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Native page output

`createPageOutput` implements the generated-page `HTMLCleaner` boundary from
`cgi-bin/HTMLCleaner.pm` and `LJ/S2.pm`. It is distinct from entry-body cleaning.
A single page session owns safe-stream parser state and raw output ordering.
Safe prints can split tags, attributes, entities, and literal closing tags.
A raw print inserts the native `<!-- -->` parser marker before raw output when
safe input is pending. It can become literal attribute data; it is not an
abstract flush or an invitation to clean each print independently.

The neutral scalar interface is `{bytes: Uint8Array, utf8: boolean}`. Inputs and
callback outputs are copied. Raw output preserves the caller's flag. Parser
entry follows the retained byte API: flagged Latin1-range input downgrades to
octets, and wide flagged input raises the native entry error. Attribute entity
results follow `HTML::Parser` 3.85 `utf8_mode(1)` as unflagged UTF8 octets, then
native `ehtml` serialization; raw source attributes are never output authority.
These conversions are source semantics, not UTF8 replacement or a Latin1 HTTP
encoding adapter. The shared runtime supplies scalar chunks and aggregates them
with its reviewed flag-aware sink. This package does not import S2 runtime.

The maintained `htmlparser2` 10.0.0 public `Tokenizer` runs with XML lexical mode
and entity decoding disabled. It preserves ordered duplicate attributes and
original source spans. The native policy lowercases names, uses the first value
of each attribute, and emits it at every source-sequence occurrence. Generic
elements are retained, and handlers/active values are screened after native
entity decoding. The canonical HTML4 entity module is exposed through the pure
`@dreamwidth/content/native-entities` subpath so parent callers do not load DOM
code. Its mapping is retained unchanged from the original qualified module.

Literal `script`, `style`, `xmp`, `textarea`, and `title` spans use the measured
native literal boundary, independently of generic tokenizer quoted-attribute
state. Only a matching completed closing delimiter ends the span; the public
tokenizer validates it. `plaintext` consumes through EOF. Other elements such
as `pre`, `listing`, `noframes`, and `noembed` remain generic native tokens.
Incomplete tags at EOF are not committed. Declaration token whitespace is
joined while preserving quoted tokens. Comments and processing instructions
have no output handler. Eating state is page-local; unlike the native module's
process-global stack, one malformed page cannot suppress a later page.

CSS starts save both printer channels only at the outermost nesting depth.
Both channels then append to one flag-aware buffer. The outermost end restores
the channels and sends screened CSS through the saved raw path, including any
pending HTML flush. Unmatched starts and ends follow the retained behavior.
Native `CSS::Cleaner` screening leaves safe general CSS unchanged; it does not
impose a stylesheet syntax catalog. `LJ::CSS::Cleaner` pre-hook behavior is
separate from ordinary inline/style-element CSS. Stylesheet links follow the
source public host, domain, resource-path, feature, and CSSPROXY rules. This
session never fetches a URL.

`checkDepth`, `transformCss` and `expandEmbed` are named trusted application operations. The
serving coordinator must provide actual source-qualified hook/embed behavior;
identity callbacks used by unit tests are explicitly synthetic, not evidence
that configured hooks have no effect. No stored code selects a module or host
callback. The native eighth-print checkpoint excludes buffered CSS prints.
Input/parser/output counts and deadline apply to the whole session;
all pending token, literal, style and CSS storage remains inside those bounds.

Run in the devcontainer from `src/content`:

```sh
npm run check
npm run build
node --test tests/page-output.test.mjs
```

The fixed native drivers load retained modules and source functions and execute
only maintained action traces, never persisted generated code. Tests compare
raw bytes against independent native base64 output. They cover marker placement,
unsafe split attributes, duplicates, HTML4 entities, literal sets and delimiter
counterexamples, generic tags/CSS, nested printers, flags, and isolation. Source
and shared-runtime integration, actual custom program rendering, browser safety,
and installed application hooks are additional serving gates; these component
tests do not claim that completion.

The production tokenizer dependency is MIT licensed; its locked transitive
closure retains MIT and BSD notices. The semantic policy ports retain inherited
LiveJournal GPL notices. No expanded matrix, generated oracle output, or built
JavaScript is tracked.
