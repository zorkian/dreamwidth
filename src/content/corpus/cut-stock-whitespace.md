<!--
cut-stock-whitespace.md

Stock-style qualification for leading-whitespace cleaner differences.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Leading whitespace under the unchanged stock style

The HTML5 full-document parse used by the shared cleaner can drop leading
whitespace that retained Perl emits. This is a general transform, not a cut
special case: examples include `LFHello`, `LFLFspacesHello`,
`spaces<b>x</b>` and `LF<p>`. Raw bytes and SHA-256 remain distinct in the
per-case ledger. The measured visual equivalence below is limited to the
actual stock recent-page style, whose `.entry-content` computes
`white-space: normal`; it is not an API guarantee for another stylesheet.

The two source IDs are `t/cleaner-event.t#call-0020:html_raw0` and
`t/cleaner-event.t#call-0021:html_raw0`. For each, retained output is exactly
one LF followed by TypeScript output. The native digest is
`23d217f3f1a3d9299d2d9ba6d9c2a87cfc7b11fd8b16690a17d6003b3cafff4a`;
the TypeScript digest is
`0ce494a583ec076963e4ca7f097217b120c5ed04eaffb462928ec006b2e2f1ba`.
The actual unchanged compiled core2/core2base-layout `Page.print` was run
with each exact fragment and retained CSS, JS and images. Chromium 153 with
JavaScript off/on loaded three CSS sheets (175, 326 and 116 rules) and all
14 exact public resources. Stock stylesheet SHA-256 was
`f5dacd16a70588f64d38ceafa553699c56a797f05a615d15efd14c26fb1d9552`.
Visible text, cut labels, entry rectangle and three following stock target
rectangles agreed; the retained LF remained a zero-rectangle DOM text node.

As a negative control, changing only `.entry-content` to `white-space: pre`
or `pre-wrap` made the retained page 18 px taller and moved the first cut
label and all three following targets 18 px lower in both JavaScript modes.
The classification therefore retains the byte difference and this scope
limit. The read-only source report and full-page/resource observations were
archived as `/tmp/s2-slice4-cut-stock-whitespace.md` and
`/tmp/s2-slice4-cut-stock-evidence/report.json` (report SHA-256
`8a805d41546e28544bb9239c55ee868d7fc08c799ee15574bdc3d888643693f4`).
