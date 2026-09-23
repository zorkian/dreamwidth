# Native configured spellcheck

Captured by the isolated in-process checker fixture in `t/browser/entry-spellcheck.js`
at 2ddb24000c418769626f24595364fbd2a3e0bb06 (production c95084daa).
The fixture runs an owned loopback server, uses a disposable account/entry and
local checker stub, and leaves entry and saved draft state unchanged. It invokes
no external checker and changes no normal server configuration.

The four captures show the configured control and returned suggestion in a real
FCK editor at 1280px and 390px. The returned body retains the current RTE content.
The subsequent f8bbe2413 correction changes only posted journal-selection
precedence and adds HTTP evidence; it does not alter this rendering.

Worker final evidence: `/tmp/entry-spellcheck-final-browser.log`,
`/tmp/spellcheck-final-tidy.log`, and `/tmp/spellcheck-final-compile.log`, all exit0.
